-- C0.1 — Money Operations Foundations: per-funder commission structures.
-- Reference: SPEC S7A (Commission Lifecycle Amounts) + ROADMAP Phase C0.
--
-- What FNC earns FROM each funder per signed broker agreement. The existing
-- commission engine (calculate_commission(gross, is_purchase_order)) only splits
-- an FNC gross 40/60-tiered — it doesn't know the gross. This migration adds the
-- per-funder rate substrate that PRODUCES that gross (wired into the engine in
-- C2, not here). C0 is substrate only: table + effective-dated lookup + the
-- deal_funder_submissions lifecycle columns. No trigger consumes it yet.
--
-- Owner-locked decisions (2026-07-20): A enum deal_type (6 values) · B decimal
-- fraction in numeric(10,4) (Postgres numeric is exact — no float drift) ·
-- C percent_of_mdr enum ships, MDR capture + math deferred to first MCA funder ·
-- D no backfill (owner enters going forward) · E approval pins the rate ·
-- F is_purchase_order (tier engine) and deal_type (rate lookup) coexist ·
-- G quote_amount/offered_commission legacy-deprecated (data intact, stop writing).

-- ===========================================================================
-- 1. btree_gist — required so the scalar (=) columns can sit in the same GiST
--    exclusion constraint as the daterange (&&) that enforces non-overlap.
-- ===========================================================================
create extension if not exists btree_gist;

-- ===========================================================================
-- 2. Enums (decision A + the rate_type set). CREATE TYPE (not ALTER ... ADD
--    VALUE), so they're usable in this same transaction.
-- ===========================================================================
do $$ begin
  if not exists (select 1 from pg_type where typname = 'deal_type') then
    create type public.deal_type as enum
      ('non_po', 'po', 'invoice_discounting', 'term_loan', 'bridging', 'other');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'funder_rate_type') then
    create type public.funder_rate_type as enum
      ('percent_of_gross_funded', 'percent_of_mdr', 'flat_rand_per_deal');
  end if;
end $$;

-- ===========================================================================
-- 3. funder_commission_structures — new empty table, so inline FKs/constraints
--    are safe (the NOT VALID + CONCURRENTLY dance is only for FK COLUMNS added
--    to populated tables).
--
--    Rate storage is SPLIT by kind (decision 1A): rate_fraction (numeric(10,4))
--    holds a 0..1 decimal fraction for the percent types (0.0800 = 8%);
--    flat_amount (numeric(14,2) — money per rule 6) holds the rand for
--    flat_rand_per_deal. Exactly one is set per rate_type (fcs_rate_bounds_ck).
--    numeric is exact decimal — 0.0800 has no float drift on multiplication
--    (decision B: always store as fraction, display as %).
-- ===========================================================================
create table if not exists public.funder_commission_structures (
  id                  uuid primary key default gen_random_uuid(),
  funder_id           uuid not null references public.funders(id) on delete restrict,
  deal_type           public.deal_type not null,
  rate_type           public.funder_rate_type not null,
  rate_fraction       numeric(10,4),      -- 0..1 fraction for percent_of_* types (null for flat)
  flat_amount         numeric(14,2),      -- rand for flat_rand_per_deal (null for percent); money rule 6
  effective_from      date not null,
  effective_to        date,               -- null = still active (open-ended)
  contract_clause_ref text,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid default auth.uid() references public.profiles(id),
  updated_by          uuid references public.profiles(id),
  -- effective_to, when set, is inclusive and must be after effective_from.
  constraint fcs_effective_range_ck
    check (effective_to is null or effective_to > effective_from),
  -- Rate shape + bounds keyed on rate_type (decision 1A): percent types carry a
  -- 0..1 rate_fraction and NO flat_amount; flat_rand_per_deal carries a
  -- non-negative flat_amount (money) and NO rate_fraction. Exactly one is set.
  constraint fcs_rate_bounds_ck check (
    case rate_type
      when 'flat_rand_per_deal'
        then flat_amount is not null and flat_amount >= 0 and rate_fraction is null
      else
        rate_fraction is not null and rate_fraction >= 0 and rate_fraction <= 1 and flat_amount is null
    end
  ),
  -- Non-overlap: at most one active structure per (funder, deal_type) on any
  -- date. daterange(from, to, '[]') is inclusive-both; a NULL upper bound makes
  -- it unbounded-above, so an open-ended rate blocks any later rate until it's
  -- closed ("close the open entry first" — item 4/7). Needs btree_gist for the
  -- uuid/enum '=' columns.
  constraint fcs_no_overlap exclude using gist (
    funder_id with =,
    deal_type with =,
    daterange(effective_from, effective_to, '[]') with &&
  )
);

comment on table public.funder_commission_structures is
  'Per-funder commission rate structures (what FNC earns from each funder per signed broker agreement). Owner-only. C0.1 / SPEC S7A.';

-- ===========================================================================
-- 4. RLS — owner-only, full CRUD. NO partner policy at all (funder rates are
--    FNC-internal commercial data — never shared, now or in Phase D).
-- ===========================================================================
alter table public.funder_commission_structures enable row level security;

drop policy if exists fcs_owner_all on public.funder_commission_structures;
create policy fcs_owner_all on public.funder_commission_structures
  for all to authenticated using (public.is_owner()) with check (public.is_owner());

-- ===========================================================================
-- 5. updated_at trigger (reuse the existing set_updated_at()).
-- ===========================================================================
drop trigger if exists set_updated_at on public.funder_commission_structures;
create trigger set_updated_at before update on public.funder_commission_structures
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- 6. Activity logging (A10) — re-declare log_activity() in full (from
--    20260720120100) with ONLY a new funder_commission_structure branch added
--    (linked to its funder_id). Every other branch is byte-for-byte unchanged.
-- ===========================================================================
create or replace function public.log_activity()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid     uuid := (select auth.uid());
  v_email   text;
  v_role    text;
  v_event   public.activity_event_type;
  v_etype   text;
  v_eid     uuid;
  v_verb    text := case tg_op when 'INSERT' then 'created' when 'UPDATE' then 'updated' else 'deleted' end;
  v_desc    text;
  v_changed jsonb;
  v_before  jsonb;
  v_after   jsonb;
  v_related jsonb;
  ov        jsonb;
  nv        jsonb;
begin
  if v_uid is not null then
    select p.email, p.role into v_email, v_role from public.profiles p where p.id = v_uid;
  end if;

  if tg_op = 'DELETE' then
    ov := to_jsonb(old); nv := null;
    v_eid := (ov->>'id')::uuid;
  elsif tg_op = 'INSERT' then
    ov := null; nv := to_jsonb(new);
    v_eid := (nv->>'id')::uuid;
  else
    ov := to_jsonb(old); nv := to_jsonb(new);
    v_eid := (nv->>'id')::uuid;
  end if;

  if tg_op = 'UPDATE' then
    select jsonb_agg(k), jsonb_object_agg(k, ov->k), jsonb_object_agg(k, nv->k)
      into v_changed, v_before, v_after
    from jsonb_object_keys(nv) as k
    where (nv->k) is distinct from (ov->k)
      and k not in ('updated_at');

    if v_changed is null then
      return null;
    end if;
  end if;

  v_event := case tg_op when 'INSERT' then 'CREATE' when 'UPDATE' then 'UPDATE' else 'DELETE' end::public.activity_event_type;

  if tg_table_name = 'deals' then
    v_etype := 'deal';
    v_related := jsonb_build_array(coalesce(nv->>'client_id', ov->>'client_id'));
    if tg_op = 'UPDATE' and (nv->>'stage') is distinct from (ov->>'stage') then
      v_event := 'STAGE_CHANGE';
      v_desc := 'Deal ' || coalesce(nv->>'reference', '?') || ' moved ' ||
                coalesce(ov->>'stage', '?') || ' → ' || coalesce(nv->>'stage', '?');
    else
      v_desc := 'Deal ' || coalesce(nv->>'reference', ov->>'reference', '?') || ' ' || v_verb;
    end if;

  elsif tg_table_name = 'deal_funder_submissions' then
    v_etype := 'deal_funder_submission';
    v_event := 'SUBMISSION';
    v_related := jsonb_build_array(coalesce(nv->>'deal_id', ov->>'deal_id'));
    if tg_op = 'UPDATE' and (nv->>'status') is distinct from (ov->>'status') then
      v_desc := 'Funder submission status → ' || coalesce(nv->>'status', '?');
    elsif tg_op = 'INSERT' then
      v_desc := 'Funder submission added';
    elsif tg_op = 'DELETE' then
      v_desc := 'Funder submission removed';
    else
      v_desc := 'Funder submission updated';
    end if;

  elsif tg_table_name = 'clients' then
    v_etype := 'client';
    v_desc := 'Client ' || coalesce(nv->>'business_name', ov->>'business_name', '?') || ' ' || v_verb;

  elsif tg_table_name = 'client_contacts' then
    v_etype := 'client_contact';
    v_related := jsonb_build_array(coalesce(nv->>'client_id', ov->>'client_id'));
    v_desc := 'Contact ' || coalesce(nv->>'full_name', ov->>'full_name', '?') || ' ' || v_verb;

  elsif tg_table_name = 'commission_records' then
    v_etype := 'commission_record';
    v_related := jsonb_build_array(coalesce(nv->>'deal_id', ov->>'deal_id'));
    v_desc := 'Commission record ' || v_verb;

  elsif tg_table_name = 'leads' then
    v_etype := 'lead';
    if tg_op = 'UPDATE' and (nv->>'qualification_stage') is distinct from (ov->>'qualification_stage') then
      v_event := 'QUALIFICATION';
      v_desc := 'Lead ' || coalesce(nv->>'business_name', '?') || ' qualification ' ||
                coalesce(ov->>'qualification_stage', '?') || ' → ' || coalesce(nv->>'qualification_stage', '?');
      if (nv->>'qualification_stage') = 'qualified' then
        v_related := (select jsonb_build_array(d.id) from public.deals d where d.lead_id = v_eid limit 1);
      end if;
    else
      v_desc := 'Lead ' || coalesce(nv->>'business_name', ov->>'business_name', '?') || ' ' || v_verb;
    end if;

  elsif tg_table_name = 'client_stories' then
    v_etype := 'client_story';
    -- Link to whichever entity owns the story (client OR lead) so a
    -- pre-qualification story surfaces on the lead's Activity tab too (B4.1 XOR).
    v_related := jsonb_build_array(coalesce(nv->>'client_id', ov->>'client_id', nv->>'lead_id', ov->>'lead_id'));
    v_desc := 'Client story ' || v_verb;

  elsif tg_table_name = 'call_logs' then
    v_etype := 'call_log';
    v_related := jsonb_build_array(coalesce(nv->>'client_id', ov->>'client_id'));
    v_desc := 'Call log ' || v_verb;

  elsif tg_table_name = 'client_stakeholders' then
    v_etype := 'client_stakeholder';
    -- Link to whichever entity owns the stakeholder so it shows on that tab.
    v_related := jsonb_build_array(coalesce(nv->>'client_id', ov->>'client_id', nv->>'lead_id', ov->>'lead_id'));
    v_desc := 'Stakeholder ' || coalesce(nv->>'full_name', ov->>'full_name', '?') || ' ' || v_verb;

  elsif tg_table_name = 'funder_commission_structures' then
    v_etype := 'funder_commission_structure';
    -- Link to the funder so the event surfaces on the funder's Activity view.
    v_related := jsonb_build_array(coalesce(nv->>'funder_id', ov->>'funder_id'));
    v_desc := 'Funder commission structure ' || v_verb;

  else
    v_etype := tg_table_name;
    v_desc := v_etype || ' ' || v_verb;
  end if;

  insert into public.activity_logs (
    occurred_at, user_id, user_email, user_role, event_type, entity_type, entity_id,
    description, changed_fields, before_values, after_values, related_entity_ids
  ) values (
    now(), v_uid, v_email, v_role, v_event, v_etype, v_eid,
    v_desc, v_changed, v_before, v_after, v_related
  );

  return null;
end;
$function$;

drop trigger if exists log_activity_funder_commission_structures on public.funder_commission_structures;
create trigger log_activity_funder_commission_structures
  after insert or update or delete on public.funder_commission_structures
  for each row execute function public.log_activity();

-- ===========================================================================
-- 7. funder_rate_at() — the effective-dated rate lookup (decision E: the rate in
--    force AS-OF a date; C2 calls it with the approval date so approval pins the
--    rate). Read-only. is_owner()-gated (funder rates never reach a partner) and
--    SECURITY DEFINER so it can read past the owner-only RLS from an owner-fired
--    C2 trigger. The exclusion constraint guarantees <= 1 active row; limit 1 is
--    belt-and-braces. Returns a NULL composite if no rate is effective.
-- ===========================================================================
create or replace function public.funder_rate_at(
  p_funder_id uuid,
  p_deal_type public.deal_type,
  p_as_of     date
)
returns public.funder_commission_structures
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row public.funder_commission_structures;
begin
  if not public.is_owner() then
    raise exception 'Only the owner can look up funder commission rates';
  end if;

  select * into v_row
    from public.funder_commission_structures
   where funder_id = p_funder_id
     and deal_type = p_deal_type
     and daterange(effective_from, effective_to, '[]') @> p_as_of
   order by effective_from desc
   limit 1;

  return v_row;
end;
$$;

revoke all on function public.funder_rate_at(uuid, public.deal_type, date) from public, anon;
grant execute on function public.funder_rate_at(uuid, public.deal_type, date) to authenticated;

-- ===========================================================================
-- 8. deal_funder_submissions — S7A lifecycle columns (verified absent against
--    live 2026-07-20; amount_requested is NOT added here — it lives on
--    deals.amount_requested). Nullable, no FK → metadata-only adds (no NOT VALID
--    / CONCURRENTLY). Money is numeric(14,2) per CLAUDE.md rule 6. Populated in
--    C2 (transition triggers) — nothing writes them here.
-- ===========================================================================
alter table public.deal_funder_submissions
  add column if not exists amount_approved      numeric(14,2),   -- funder's approved facility (State 2 Potential)
  add column if not exists amount_funded        numeric(14,2),   -- actually advanced (State 3 Actual)
  add column if not exists approved_at          timestamptz,     -- approval transition timestamp
  add column if not exists funded_at            timestamptz,     -- funding transition timestamp
  add column if not exists applied_rate_snapshot jsonb;          -- approval-time authoritative rate (immutable audit, decision E)

comment on column public.deal_funder_submissions.applied_rate_snapshot is
  'Immutable snapshot of the funder_commission_structures row in force at approval (decision E: approval pins the rate). Written in C2.';
-- Decision G: quote_amount / offered_commission are LEGACY-DEPRECATED — data
-- intact, no new writes; C2''s rate x amount supersedes offered_commission.
comment on column public.deal_funder_submissions.quote_amount is
  'DEPRECATED (C0/A9.5). Superseded by amount_approved. Legacy data retained; do not write new.';
comment on column public.deal_funder_submissions.offered_commission is
  'DEPRECATED (C0/A9.5). Superseded by C2 computed commission (funder_rate_at x amount). Legacy data retained; do not write new.';

-- ===========================================================================
-- 9. In-migration assertions (RAISE → roll the whole migration back). Uses a
--    real funder for the FK; every synthetic row + its activity rows are cleaned
--    up, so the migration commits no test data.
-- ===========================================================================
do $$
declare
  v_funder  uuid;
  v_owner   uuid;
  v_partner uuid;
  v_id1     uuid;
  v_id2     uuid;
  v_rate    numeric;
  v_rls_id  uuid;
  v_seen    int;
  v_def     text := pg_get_functiondef('public.funder_rate_at(uuid, public.deal_type, date)'::regprocedure);
begin
  select id into v_funder from public.funders limit 1;
  if v_funder is null then
    raise notice 'C0.1 assertions skipped (no funders present)';
    return;
  end if;

  -- (a) percent rate_fraction > 1 rejected.
  begin
    insert into public.funder_commission_structures (funder_id, deal_type, rate_type, rate_fraction, effective_from)
    values (v_funder, 'non_po', 'percent_of_gross_funded', 1.5, date '2026-01-01');
    raise exception 'C0.1 assert FAIL: percent rate_fraction > 1 accepted';
  exception when check_violation then null; end;

  -- (a2) percent type must NOT carry a flat_amount (wrong column) — rejected.
  begin
    insert into public.funder_commission_structures (funder_id, deal_type, rate_type, rate_fraction, flat_amount, effective_from)
    values (v_funder, 'non_po', 'percent_of_gross_funded', 0.08, 500, date '2026-01-01');
    raise exception 'C0.1 assert FAIL: percent type accepted a flat_amount';
  exception when check_violation then null; end;

  -- (b) negative flat_amount rejected.
  begin
    insert into public.funder_commission_structures (funder_id, deal_type, rate_type, flat_amount, effective_from)
    values (v_funder, 'non_po', 'flat_rand_per_deal', -1, date '2026-01-01');
    raise exception 'C0.1 assert FAIL: negative flat_amount accepted';
  exception when check_violation then null; end;

  -- (b2) flat type must NOT carry a rate_fraction (wrong column) — rejected.
  begin
    insert into public.funder_commission_structures (funder_id, deal_type, rate_type, flat_amount, rate_fraction, effective_from)
    values (v_funder, 'non_po', 'flat_rand_per_deal', 500, 0.08, date '2026-01-01');
    raise exception 'C0.1 assert FAIL: flat type accepted a rate_fraction';
  exception when check_violation then null; end;

  -- (c) effective_to before/equal effective_from rejected.
  begin
    insert into public.funder_commission_structures (funder_id, deal_type, rate_type, rate_fraction, effective_from, effective_to)
    values (v_funder, 'non_po', 'percent_of_gross_funded', 0.08, date '2026-06-01', date '2026-01-01');
    raise exception 'C0.1 assert FAIL: effective_to before effective_from accepted';
  exception when check_violation then null; end;

  -- Valid open-ended rate.
  insert into public.funder_commission_structures (funder_id, deal_type, rate_type, rate_fraction, effective_from)
  values (v_funder, 'non_po', 'percent_of_gross_funded', 0.08, date '2026-01-01')
  returning id into v_id1;

  -- (d) a second active (overlapping) rate for the same (funder, deal_type) is rejected.
  begin
    insert into public.funder_commission_structures (funder_id, deal_type, rate_type, rate_fraction, effective_from)
    values (v_funder, 'non_po', 'percent_of_gross_funded', 0.10, date '2026-06-01');
    raise exception 'C0.1 assert FAIL: overlapping active rate accepted';
  exception when exclusion_violation then null; end;

  -- (e) close the open rate, add a later one; the effective-dated lookup logic
  --     picks the right row by date (approval pins the rate). Tested via the
  --     same daterange containment funder_rate_at uses (funder_rate_at itself is
  --     is_owner()-gated, so it's asserted by contract below, not called here —
  --     auth.uid() is null during the migration).
  update public.funder_commission_structures set effective_to = date '2026-05-31' where id = v_id1;
  insert into public.funder_commission_structures (funder_id, deal_type, rate_type, rate_fraction, effective_from)
  values (v_funder, 'non_po', 'percent_of_gross_funded', 0.10, date '2026-06-01')
  returning id into v_id2;

  select rate_fraction into v_rate from public.funder_commission_structures
   where funder_id = v_funder and deal_type = 'non_po'
     and daterange(effective_from, effective_to, '[]') @> date '2026-03-01';
  if v_rate is distinct from 0.0800 then
    raise exception 'C0.1 assert FAIL: Feb lookup expected 0.0800 got %', v_rate; end if;

  select rate_fraction into v_rate from public.funder_commission_structures
   where funder_id = v_funder and deal_type = 'non_po'
     and daterange(effective_from, effective_to, '[]') @> date '2026-07-01';
  if v_rate is distinct from 0.1000 then
    raise exception 'C0.1 assert FAIL: Jul lookup expected 0.1000 got %', v_rate; end if;

  if exists (
    select 1 from public.funder_commission_structures
     where funder_id = v_funder and deal_type = 'non_po'
       and daterange(effective_from, effective_to, '[]') @> date '2025-01-01') then
    raise exception 'C0.1 assert FAIL: a rate resolved before any effective_from';
  end if;

  -- (f) funder_rate_at contract: SECURITY DEFINER + is_owner()-gated + search_path.
  if not (select p.prosecdef from pg_proc p
            where p.oid = 'public.funder_rate_at(uuid, public.deal_type, date)'::regprocedure) then
    raise exception 'C0.1 assert FAIL: funder_rate_at is not SECURITY DEFINER'; end if;
  if position('is_owner' in v_def) = 0 then
    raise exception 'C0.1 assert FAIL: funder_rate_at missing is_owner() gate'; end if;
  if not has_function_privilege('authenticated', 'public.funder_rate_at(uuid, public.deal_type, date)', 'execute') then
    raise exception 'C0.1 assert FAIL: authenticated cannot execute funder_rate_at'; end if;
  if has_function_privilege('anon', 'public.funder_rate_at(uuid, public.deal_type, date)', 'execute') then
    raise exception 'C0.1 assert FAIL: anon can execute funder_rate_at (should not)'; end if;

  delete from public.funder_commission_structures where id in (v_id1, v_id2);

  -- (g) RLS matrix — owner sees the row, partner sees zero (role-simulated;
  --     guarded on profile presence, replay-safe).
  select id into v_owner   from public.profiles where role = 'owner'   limit 1;
  select id into v_partner from public.profiles where role = 'partner' limit 1;
  if v_owner is not null then
    insert into public.funder_commission_structures (funder_id, deal_type, rate_type, flat_amount, effective_from)
    values (v_funder, 'bridging', 'flat_rand_per_deal', 500, date '2026-01-01')
    returning id into v_rls_id;

    if v_partner is not null then
      execute 'set local role authenticated';
      perform set_config('request.jwt.claims', json_build_object('sub', v_partner::text, 'role', 'authenticated')::text, true);
      select count(*) into v_seen from public.funder_commission_structures where id = v_rls_id;
      execute 'reset role';
      perform set_config('request.jwt.claims', '', true);
      if v_seen <> 0 then raise exception 'C0.1 assert FAIL: partner can see funder rate structures'; end if;
    end if;

    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
    select count(*) into v_seen from public.funder_commission_structures where id = v_rls_id;
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    if v_seen <> 1 then raise exception 'C0.1 assert FAIL: owner cannot see own funder rate structures'; end if;

    delete from public.funder_commission_structures where id = v_rls_id;
  else
    raise notice 'C0.1 RLS assertion skipped (no owner profile)';
  end if;

  -- Clean up the activity rows the assertion inserts/updates/deletes wrote (the
  -- table is brand new, so all funder_commission_structure activity is synthetic).
  delete from public.activity_logs where entity_type = 'funder_commission_structure';

  raise notice 'C0.1 assertions passed (rate bounds + effective range + overlap exclusion + effective-dated lookup + funder_rate_at contract + RLS matrix)';
end $$;

notify pgrst, 'reload schema';
