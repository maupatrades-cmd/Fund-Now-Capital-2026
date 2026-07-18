-- Document expiry alerts — part 2 of 3: sweep logic (SPEC S6 / brief item 9).
--
-- B3.1 made the substrate live (documents.expiry_date defaulted per type, the
-- documents_expiry_date_idx partial index, the period-scoped pack model). This
-- migration adds the engine that fires the alerts: a daily-swept detection that
-- emits DOCUMENT_EXPIRING_30D / _7D / _EXPIRED to the owner (in-app + email via
-- the existing emit_in_app_notification path), pack-aware bodies for
-- period-scoped types, once-per-(document,threshold) dedup, and auto-marking
-- current docs 'expired' once past their date.
--
-- The pg_cron schedule + extension enable live in part 3 (20260718100200) so the
-- novel pg_cron activation is isolated from this well-asserted logic.

-- ===========================================================================
-- 1. document_type_label() — human label for a document_type (SQL mirror of
--    src/lib/documents.ts). IMMUTABLE; used in notification/email bodies.
-- ===========================================================================
create or replace function public.document_type_label(p_type public.document_type)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_type
    when 'cipc_cert' then 'CIPC certificate'
    when 'company_profile' then 'Company profile'
    when 'tax_clearance' then 'Tax clearance'
    when 'bee_cert' then 'BEE certificate'
    when 'moi' then 'MOI'
    when 'trading_license' then 'Trading license'
    when 'shareholder_register' then 'Shareholder register'
    when 'director_appointment' then 'Director appointment letter'
    when 'bank_statement' then 'Bank statement'
    when 'financial_statements' then 'Financial statements'
    when 'mgmt_accounts' then 'Management accounts'
    when 'debtors_ageing' then 'Debtors ageing'
    when 'creditors_ageing' then 'Creditors ageing'
    when 'cashflow_projection' then 'Cash flow projection'
    when 'budget' then 'Budget'
    when 'id_copy' then 'ID copy'
    when 'proof_of_address' then 'Proof of address'
    when 'anc_contract' then 'ANC contract'
    when 'personal_financials' then 'Personal financials'
    when 'spousal_consent' then 'Spousal consent'
    when 'marriage_cert' then 'Marriage certificate'
    when 'application_form' then 'Application form'
    when 'credit_consent' then 'Credit consent'
    when 'purchase_order' then 'Purchase order'
    when 'cession' then 'Cession'
    when 'suretyship' then 'Suretyship'
    when 'personal_guarantee' then 'Personal guarantee'
    when 'business_plan' then 'Business plan'
    when 'quotation' then 'Quotation'
    when 'invoice_doc' then 'Invoice'
    when 'natis' then 'NATIS'
    when 'vehicle_license' then 'Vehicle license'
    when 'title_deed' then 'Title deed'
    when 'valuation_report' then 'Valuation report'
    when 'equipment_schedule' then 'Equipment schedule'
    when 'livestock_inventory' then 'Livestock inventory'
    when 'fica_pack' then 'FICA pack'
    when 'popia_consent' then 'POPIA consent'
    when 'source_of_funds' then 'Source of funds declaration'
    when 'tax_residency' then 'Tax residency'
    when 'approval_letter' then 'Approval letter'
    when 'decline_letter' then 'Decline letter'
    when 'offer_letter' then 'Offer letter'
    when 'term_sheet' then 'Term sheet'
    when 'funder_agreement' then 'Funder agreement'
    when 'submission_cover' then 'Submission cover'
    when 'invoice_sent' then 'Invoice sent'
    when 'commission_agreement' then 'Commission agreement'
    when 'referral_agreement' then 'Referral agreement'
    when 'msa' then 'MSA'
    when 'welcome_pack' then 'Welcome pack'
    else 'Document'
  end;
$$;

-- ===========================================================================
-- 2. document_expiry_alerts — once-per-(document, threshold) dedup ledger.
--    New empty table, so the FK is added inline VALID (no rows to lock/scan;
--    the NOT VALID + CONCURRENTLY dance is only for populated tables). The
--    unique(document_id, alert_type) index also supports the FK's cascade.
-- ===========================================================================
create table if not exists public.document_expiry_alerts (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  alert_type  public.notification_event_type not null,
  sent_at     timestamptz not null default now(),
  constraint document_expiry_alerts_uniq unique (document_id, alert_type)
);

alter table public.document_expiry_alerts enable row level security;

-- RLS: owner-only SELECT, no INSERT/UPDATE/DELETE policies. This mirrors activity_logs (SPEC.md S5) — a SECURITY DEFINER-written audit/dedup ledger that is intentionally immutable through the API. Partner read is deliberately excluded per CLAUDE.md rule 7 (extended in SPEC.md S6): this table references documents including bank statements and other PII-excluded types, so exposing alert metadata to partners would leak information about documents they cannot see.
drop policy if exists "document_expiry_alerts_owner_read" on public.document_expiry_alerts;
create policy "document_expiry_alerts_owner_read" on public.document_expiry_alerts
  for select to authenticated using (public.is_owner());

-- ===========================================================================
-- 3. document_expiry_due() — detection. For each CURRENT + ACTIVE document with
--    an expiry_date, the single most-urgent threshold it has reached (compared
--    in whole calendar days via date - date) that hasn't already been alerted.
--    As a doc ages it progresses 30D → 7D → EXPIRED, each firing once (dedup).
-- ===========================================================================
create or replace function public.document_expiry_due(p_as_of date default current_date)
returns table (
  document_id      uuid,
  alert_type       public.notification_event_type,
  document_type    public.document_type,
  is_period_scoped boolean,
  period_start     date,
  period_end       date,
  expiry_date      date,
  client_id        uuid,
  lead_id          uuid,
  entity_name      text
)
language sql
stable
security definer
set search_path = ''
as $$
  with due as (
    select
      d.id,
      case
        when d.expiry_date < p_as_of              then 'DOCUMENT_EXPIRED'::public.notification_event_type
        when (d.expiry_date - p_as_of) <= 7       then 'DOCUMENT_EXPIRING_7D'::public.notification_event_type
        when (d.expiry_date - p_as_of) <= 30      then 'DOCUMENT_EXPIRING_30D'::public.notification_event_type
        else null
      end as alert_type,
      d.document_type, d.is_period_scoped, d.period_start, d.period_end,
      d.expiry_date, d.client_id, d.lead_id
    from public.documents d
    where d.is_current_version
      and d.status = 'active'
      and d.expiry_date is not null
  )
  select
    due.id, due.alert_type, due.document_type, due.is_period_scoped,
    due.period_start, due.period_end, due.expiry_date, due.client_id, due.lead_id,
    coalesce(c.business_name, l.business_name, 'the client') as entity_name
  from due
  left join public.clients c on c.id = due.client_id
  left join public.leads   l on l.id = due.lead_id
  where due.alert_type is not null
    and not exists (
      select 1 from public.document_expiry_alerts a
      where a.document_id = due.id and a.alert_type = due.alert_type
    );
$$;

-- ===========================================================================
-- 4. mark_expired_documents() — flip CURRENT docs whose expiry has passed to
--    status='expired'. Idempotent; ONLY 'active' → 'expired' (never touches a
--    terminal 'archived'/'rejected' status). Keeps the lifecycle column truthful
--    for the future E3 "block expired docs from submission" rule.
-- ===========================================================================
create or replace function public.mark_expired_documents()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.documents
     set status = 'expired'
   where is_current_version
     and status = 'active'
     and expiry_date is not null
     and expiry_date < current_date;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ===========================================================================
-- 5. check_document_expiries() — the cron entry point. Emits one owner
--    notification (in-app + email) per due alert with a pack-aware body, records
--    the dedup row, then marks past-expiry docs. Returns the alert count.
-- ===========================================================================
create or replace function public.check_document_expiries()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := public.notify_owner();
  r       record;
  v_title text;
  v_body  text;
  v_label text;
  v_link  text;
  v_when  text;
  v_claimed boolean;
  v_count integer := 0;
begin
  if v_owner is null then
    -- No owner to notify, but still keep the lifecycle column truthful:
    -- past-expiry docs must flip active → expired regardless of notification.
    perform public.mark_expired_documents();
    return 0;
  end if;

  for r in select * from public.document_expiry_due(current_date) loop
    -- Claim the (document, threshold) alert BEFORE composing/emitting so two
    -- concurrent sweeps can't both pass document_expiry_due() and double-send.
    -- ON CONFLICT DO NOTHING returns no row on a lost race → v_claimed is NULL;
    -- only the sweep that actually inserts the ledger row emits (claim-then-act).
    insert into public.document_expiry_alerts (document_id, alert_type)
    values (r.document_id, r.alert_type)
    on conflict (document_id, alert_type) do nothing
    returning true into v_claimed;

    if not coalesce(v_claimed, false) then
      continue;  -- another sweep already claimed this alert; skip emission
    end if;

    v_label := public.document_type_label(r.document_type);
    v_link  := case when r.client_id is not null
                    then '/clients/' || r.client_id::text
                    else '/leads/'   || r.lead_id::text end;
    v_when  := case when r.alert_type = 'DOCUMENT_EXPIRED'
                    then 'expired on '  || to_char(r.expiry_date, 'DD Mon YYYY')
                    else 'expires on '  || to_char(r.expiry_date, 'DD Mon YYYY') end;

    v_title := case r.alert_type
                 when 'DOCUMENT_EXPIRED'      then 'Document expired'
                 when 'DOCUMENT_EXPIRING_7D'  then 'Document expiring soon'
                 else                              'Document expiring within 30 days'
               end;

    if r.is_period_scoped then
      -- Pack-aware body for period-scoped types (bank statements etc.).
      v_body := r.entity_name || '''s ' || v_label || ' pack — the '
        || coalesce(to_char(r.period_start, 'DD Mon YYYY'), '?') || ' – '
        || coalesce(to_char(r.period_end,   'DD Mon YYYY'), '?') || ' statement '
        || v_when || '. Upload the next period to keep a current 12-month pack.';
    else
      v_body := r.entity_name || '''s ' || v_label || ' ' || v_when || '.';
    end if;

    -- emit_in_app_notification fans out to in-app + email automatically.
    perform public.emit_in_app_notification(
      v_owner, r.alert_type, v_title, v_body, v_link,
      jsonb_build_object(
        'document_id',   r.document_id,
        'document_type', r.document_type,
        'client_id',     r.client_id,
        'lead_id',       r.lead_id,
        'expiry_date',   r.expiry_date
      )
    );

    v_count := v_count + 1;
  end loop;

  perform public.mark_expired_documents();
  return v_count;
end;
$$;

-- Emit-capable functions are owner/trigger internals only.
revoke execute on function public.document_expiry_due(date)       from public, anon, authenticated;
revoke execute on function public.mark_expired_documents()        from public, anon, authenticated;
revoke execute on function public.check_document_expiries()       from public, anon, authenticated;

-- ===========================================================================
-- 6. Owner notification preferences for the three events (email ON by default;
--    the owner can mute the 30-day heads-up in the prefs page if noisy). Seeds
--    only missing rows — never overwrites an opt-out.
-- ===========================================================================
insert into public.notification_preferences (user_id, event_type, in_app_enabled, email_enabled)
select p.id, v.event_type, true, v.email_enabled
  from public.profiles p
  cross join (values
    ('DOCUMENT_EXPIRING_30D'::public.notification_event_type, true),
    ('DOCUMENT_EXPIRING_7D'::public.notification_event_type,  true),
    ('DOCUMENT_EXPIRED'::public.notification_event_type,      true)
  ) as v(event_type, email_enabled)
 where p.role = 'owner'
on conflict (user_id, event_type) do nothing;

do $$
declare
  v_missing integer;
begin
  select count(*) into v_missing
  from public.profiles p
  cross join (values ('DOCUMENT_EXPIRING_30D'),('DOCUMENT_EXPIRING_7D'),('DOCUMENT_EXPIRED')) as e(evt)
  where p.role = 'owner'
    and not exists (
      select 1 from public.notification_preferences np
      where np.user_id = p.id and np.event_type = e.evt::public.notification_event_type
    );
  if v_missing > 0 then
    raise exception 'document expiry prefs backfill incomplete: % owner rows missing', v_missing;
  end if;
end $$;

-- ===========================================================================
-- 7. In-migration assertions (production check — rolls back on failure).
--    Uses a client with NO existing documents so synthetic rows can't supersede
--    real docs, sets explicit expiry_date (bypassing the default), and never
--    calls the GLOBAL mark_expired_documents (which would touch real data) — the
--    active-vs-terminal flip predicate is tested with a scoped UPDATE instead.
-- ===========================================================================
do $$
declare
  v_client uuid;
  v_owner  uuid;
  v_d33 uuid; v_d30 uuid; v_d7 uuid; v_d0 uuid; v_dexp uuid; v_darch uuid;
begin
  select c.id into v_client
    from public.clients c
   where not exists (select 1 from public.documents d where d.client_id = c.id)
   limit 1;
  select id into v_owner from public.profiles where role = 'owner' limit 1;
  if v_client is null or v_owner is null then
    raise notice 'document expiry assertions skipped (no doc-free client / no owner)';
    return;
  end if;

  insert into public.documents (client_id, document_type, filename, storage_path, uploaded_by, upload_source, expiry_date)
  values (v_client, 'tax_clearance',   'x33.pdf', 'expchk/'||gen_random_uuid(), v_owner, 'owner', current_date + 33) returning id into v_d33;
  insert into public.documents (client_id, document_type, filename, storage_path, uploaded_by, upload_source, expiry_date)
  values (v_client, 'bee_cert',        'x30.pdf', 'expchk/'||gen_random_uuid(), v_owner, 'owner', current_date + 30) returning id into v_d30;
  insert into public.documents (client_id, document_type, filename, storage_path, uploaded_by, upload_source, expiry_date)
  values (v_client, 'proof_of_address','x7.pdf',  'expchk/'||gen_random_uuid(), v_owner, 'owner', current_date + 7)  returning id into v_d7;
  insert into public.documents (client_id, document_type, filename, storage_path, uploaded_by, upload_source, expiry_date)
  values (v_client, 'fica_pack',       'x0.pdf',  'expchk/'||gen_random_uuid(), v_owner, 'owner', current_date)      returning id into v_d0;
  insert into public.documents (client_id, document_type, filename, storage_path, uploaded_by, upload_source, expiry_date)
  values (v_client, 'tax_residency',   'xexp.pdf','expchk/'||gen_random_uuid(), v_owner, 'owner', current_date - 1)  returning id into v_dexp;

  -- (i) buckets
  if (select alert_type from public.document_expiry_due(current_date) where document_id = v_d33) is not null then
    raise exception 'expiry assert FAIL: 33-day doc should not be due'; end if;
  if (select alert_type from public.document_expiry_due(current_date) where document_id = v_d30) is distinct from 'DOCUMENT_EXPIRING_30D' then
    raise exception 'expiry assert FAIL: 30-day bucket'; end if;
  if (select alert_type from public.document_expiry_due(current_date) where document_id = v_d7) is distinct from 'DOCUMENT_EXPIRING_7D' then
    raise exception 'expiry assert FAIL: 7-day bucket'; end if;
  if (select alert_type from public.document_expiry_due(current_date) where document_id = v_d0) is distinct from 'DOCUMENT_EXPIRING_7D' then
    raise exception 'expiry assert FAIL: expires-today should be urgent (7D), not expired'; end if;
  if (select alert_type from public.document_expiry_due(current_date) where document_id = v_dexp) is distinct from 'DOCUMENT_EXPIRED' then
    raise exception 'expiry assert FAIL: past-expiry bucket'; end if;

  -- (ii) dedup: once recorded, the same (doc, threshold) is no longer due
  insert into public.document_expiry_alerts (document_id, alert_type) values (v_d30, 'DOCUMENT_EXPIRING_30D');
  if exists (select 1 from public.document_expiry_due(current_date) where document_id = v_d30) then
    raise exception 'expiry assert FAIL: dedup — recorded 30-day alert still due';
  end if;

  -- (iii) mark predicate: only active → expired, never a terminal status.
  --       (scoped to synthetic rows so real production data is untouched.)
  insert into public.documents (client_id, document_type, filename, storage_path, uploaded_by, upload_source, expiry_date, status)
  values (v_client, 'company_profile', 'xarch.pdf', 'expchk/'||gen_random_uuid(), v_owner, 'owner', current_date - 5, 'archived') returning id into v_darch;
  update public.documents set status = 'expired'
   where id in (v_dexp, v_darch) and is_current_version and status = 'active' and expiry_date < current_date;
  if (select status from public.documents where id = v_dexp) <> 'expired' then
    raise exception 'expiry assert FAIL: active past-expiry not marked expired'; end if;
  if (select status from public.documents where id = v_darch) <> 'archived' then
    raise exception 'expiry assert FAIL: archived doc wrongly flipped to expired'; end if;

  -- cleanup (ON DELETE CASCADE clears the dedup row too). Scoped to the six
  -- synthetic IDs created above — never a storage_path prefix, so a real
  -- production doc can't be caught by an incidental path collision.
  delete from public.documents
   where id in (v_d33, v_d30, v_d7, v_d0, v_dexp, v_darch);
  raise notice 'document expiry assertions passed';
end $$;

notify pgrst, 'reload schema';
