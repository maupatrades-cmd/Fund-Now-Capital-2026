-- B2.2 Lead Qualification Workflow (SPEC S2 / Roadmap B2). Builds on B2.1 leads.
--
-- Adds: the lead↔deal link + funding fields deals needs, a qualification guard
-- trigger, the atomic qualify_lead() RPC, and the not_qualified_reason exposure
-- on the partner view. Activity logging + notifications on qualification events
-- are B2.3 (out of scope here).
--
-- Zero-downtime FK pattern: deals.lead_id (FK on the POPULATED deals table) is
-- added NOT VALID; its supporting/unique index is built CONCURRENTLY and the
-- constraint VALIDATEd in the follow-up migration 20260716091000. The two plain
-- funding columns are nullable metadata-only adds (no rewrite, no lock).

-- ---------------------------------------------------------------------------
-- deals: carry the funding context copied from the lead + link back to the lead
-- ---------------------------------------------------------------------------
alter table public.deals add column if not exists funding_purpose  jsonb not null default '[]'::jsonb;
alter table public.deals add column if not exists funding_timeline public.lead_funding_timeline;
alter table public.deals add column if not exists lead_id          uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'deals_lead_id_fkey') then
    alter table public.deals add constraint deals_lead_id_fkey
      foreign key (lead_id) references public.leads(id) on delete set null not valid;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Qualification guard: `qualified` is terminal, `not_qualified` needs a reason,
-- and audit stamps are set server-side on any transition into either stage.
-- ---------------------------------------------------------------------------
create or replace function public.leads_qualification_guard()
returns trigger
language plpgsql
as $$
begin
  -- `qualified` is terminal on the qualification path (reopening = new lead).
  if old.qualification_stage = 'qualified' and new.qualification_stage <> 'qualified' then
    raise exception 'A qualified lead cannot be moved to another qualification stage';
  end if;

  -- `not_qualified` must carry a reason.
  if new.qualification_stage = 'not_qualified' and new.not_qualified_reason is null then
    raise exception 'not_qualified_reason is required when a lead is marked not qualified';
  end if;

  -- Stamp audit fields on any transition INTO qualified / not_qualified. Set
  -- server-side so the client can't backdate or misattribute them.
  if new.qualification_stage in ('qualified','not_qualified')
     and new.qualification_stage is distinct from old.qualification_stage then
    new.qualified_at := now();
    new.qualified_by := auth.uid();
  end if;

  return new;
end;
$$;

create trigger leads_qualification_guard
  before update on public.leads
  for each row execute function public.leads_qualification_guard();

-- ---------------------------------------------------------------------------
-- qualify_lead(): atomic qualify → client → deal. SECURITY INVOKER so RLS
-- enforces owner-only naturally (each insert/update passes the owner policies).
-- Idempotent: a re-qualify returns the existing linked deal instead of a dup.
-- ---------------------------------------------------------------------------
create or replace function public.qualify_lead(p_lead_id uuid)
returns uuid
language plpgsql
security invoker
as $$
declare
  v_lead      public.leads;
  v_client_id uuid;
  v_deal_id   uuid;
begin
  if not public.is_owner() then
    raise exception 'Only the owner can qualify leads';
  end if;

  -- Lock the lead row so concurrent qualifies serialise (no duplicate deals).
  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then
    raise exception 'Lead not found';
  end if;

  -- Idempotency: already qualified → return the deal we created before.
  if v_lead.qualification_stage = 'qualified' then
    select id into v_deal_id from public.deals where lead_id = p_lead_id limit 1;
    return v_deal_id;
  end if;

  -- Attach to an existing client by case-insensitive business name, else create
  -- one (+ its primary contact) from the lead's captured details.
  select id into v_client_id
  from public.clients
  where lower(business_name) = lower(v_lead.business_name)
  limit 1;

  if v_client_id is null then
    insert into public.clients
      (business_name, cipc_number, industry_id, sub_industry_id, sector_notes,
       address, referral_partner_id, created_by)
    values
      (v_lead.business_name, v_lead.cipc_number, v_lead.industry_id, v_lead.sub_industry_id,
       v_lead.sector_notes, v_lead.physical_address, v_lead.referral_partner_id, auth.uid())
    returning id into v_client_id;

    insert into public.client_contacts
      (client_id, full_name, email, phone, position, id_number, is_primary_director)
    values
      (v_client_id, v_lead.contact_name, v_lead.contact_email, v_lead.contact_cell,
       v_lead.contact_role, v_lead.contact_id_number, true);
  end if;

  -- Create the deal at 'qualifying', linked to the originating lead. The
  -- deals_before_write trigger assigns the DEAL-xxx reference.
  insert into public.deals
    (client_id, lead_id, referral_partner_id, stage, amount_requested,
     funding_purpose, funding_timeline, created_by)
  values
    (v_client_id, p_lead_id, v_lead.referral_partner_id, 'qualifying', v_lead.funding_amount,
     v_lead.funding_purpose, v_lead.funding_timeline, auth.uid())
  returning id into v_deal_id;

  -- Mark the lead qualified (guard trigger stamps qualified_at / qualified_by).
  update public.leads set qualification_stage = 'qualified' where id = p_lead_id;

  return v_deal_id;
end;
$$;

grant execute on function public.qualify_lead(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Partner view: expose the qualification outcome + the generic reason (for
-- partner coaching, per S11), but NEVER not_qualified_notes (owner-internal).
-- qualification_stage was already exposed in B2.1; add not_qualified_reason.
-- ---------------------------------------------------------------------------
create or replace view public.partner_leads_view
with (security_barrier = true) as
  select
    l.id,
    l.business_name,
    l.industry_id,
    l.sub_industry_id,
    l.sector_notes,
    l.funding_amount,
    l.funding_purpose,
    l.funding_timeline,
    l.qualification_stage,
    l.referred_by,
    l.referral_partner_id,
    l.original_referrer_id,
    l.created_at,
    l.updated_at,
    l.not_qualified_reason
  from public.leads l
  where public.is_owner()
     or l.referral_partner_id = public.current_partner_id()
     or l.original_referrer_id = public.current_partner_id();

comment on view public.partner_leads_view is
  'Partner-safe projection of leads: non-PII business/funding fields + qualification outcome (qualification_stage, not_qualified_reason) for the partner''s own referred leads only. Excludes all contact PII, addresses, entered_by, initial_notes, turnover detail, and not_qualified_notes (owner-internal).';
