-- Build 57 — Doctor's "My Network" read-only view (Path B only).
-- ============================================================================
-- A READ-ONLY aggregate surface for Doctor (Bright Destiny): his attributed
-- Lead Referrers, their lead volume, and HIS OWN pool growth from their deals.
-- Governed by docs/lead-referrer-role.md ("Doctor's My Network view") + the
-- consolidation §2.3–2.5 (LOCKED).
--
-- PRIVACY (S7C + the locked doc — ABSOLUTE): Doctor sees ONLY
--   * which Lead Referrers are attributed to him (name) + their lead volume, and
--   * his OWN earning growth (partner_share) from deals his LRs sourced.
-- Doctor does NOT see, and this view NEVER exposes: the LR's compensation /
-- lr_earning, tier %, payment profile, banking, contract/NDA, or any client PII.
-- (The LR's money lives in lead_referrer_commission_records — NOT joined here.)
-- Doctor cannot manage/deactivate/reassign LRs (this is a view — read only).
--
-- Depends on Build 56 (20260810240000): profiles.sourced_via_partner_id +
-- leads.sourced_by_lead_refer_id attribution. Additive; no money is written.
--
-- Attribution chain used:
--   profiles(LR).sourced_via_partner_id = referral_partners(id)  -> the Doctor
--   leads.sourced_by_lead_refer_id       = profiles(id)          -> the LR
--   deals.lead_id -> leads.id            (deal traces back to its lead)
--   commission_records.partner_share      = Doctor's earning (READ, never written)
-- ============================================================================

-- Apply-order guard: fail loud if Build 56's attribution column is absent.
do $$
begin
  if not exists (select 1 from information_schema.columns
      where table_schema='public' and table_name='profiles' and column_name='sourced_via_partner_id')
     or not exists (select 1 from information_schema.columns
      where table_schema='public' and table_name='leads' and column_name='sourced_by_lead_refer_id') then
    raise exception 'Build 57 requires Build 56 first (profiles.sourced_via_partner_id / leads.sourced_by_lead_refer_id, migration 20260810240000).';
  end if;
end $$;

-- SECURITY DEFINER + security_barrier partner surface (same hardened pattern as
-- the other partner_* views, Build 19): a current_partner_id() row filter +
-- column-safe projection; partners have no base-table access. One row per LR
-- attributed to the calling Doctor (or every LR, for the owner).
create or replace view public.doctor_my_network
  with (security_barrier = true) as
select
  lr.id                                             as lead_refer_id,
  lr.full_name                                      as lead_refer_name,
  lr.sourced_via_partner_id                         as doctor_partner_id,
  count(distinct l.id)                              as lead_count,
  count(distinct d.id)                              as deal_count,
  coalesce(sum(cr.partner_share), 0)::numeric(14,2) as doctor_pool_growth
from public.profiles lr
  left join public.leads l
    on l.sourced_by_lead_refer_id = lr.id
  left join public.deals d
    on d.lead_id = l.id
  left join public.commission_records cr
    on cr.deal_id = d.id
   and cr.referral_partner_id = lr.sourced_via_partner_id  -- Doctor's own rows only
   and cr.status <> 'void'
where lr.sourced_via_partner_id is not null               -- Path-B LRs only
  and (public.is_owner() or lr.sourced_via_partner_id = public.current_partner_id())
group by lr.id, lr.full_name, lr.sourced_via_partner_id;

comment on view public.doctor_my_network is
  'Doctor''s read-only "My Network" (Build 57, Path B). SECURITY DEFINER + security_barrier by the same owner decision as the other partner_* views (Build 19). Per LR attributed to the calling Doctor: name + lead_count + deal_count + Doctor''s OWN pool growth (partner_share). NEVER exposes the LR''s lr_earning/tier/payment/banking/contract or client PII. current_partner_id() row filter; owner sees all.';

-- Definer view is the partner path; scope is the WHERE clause. No anon.
revoke all on public.doctor_my_network from anon;
grant select on public.doctor_my_network to authenticated;

-- ===========================================================================
-- Assertions — structural + column-safety tripwire (no LR-comp / owner-residual
-- / PII column may ever appear on this Doctor-facing surface).
-- ===========================================================================
do $$
declare v_cols text[];
begin
  if to_regclass('public.doctor_my_network') is null then
    raise exception 'assert FAIL: doctor_my_network view missing'; end if;
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname='doctor_my_network'
        and c.reloptions is not null and 'security_barrier=true' = any(c.reloptions)) then
    raise exception 'assert FAIL: doctor_my_network must be security_barrier'; end if;
  if exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname='doctor_my_network'
        and c.reloptions is not null and 'security_invoker=true' = any(c.reloptions)) then
    raise exception 'assert FAIL: doctor_my_network must stay SECURITY DEFINER'; end if;

  select array_agg(column_name) into v_cols from information_schema.columns
    where table_schema='public' and table_name='doctor_my_network';
  if v_cols && array['lr_earning','tier','tier_pct','owner_share','owner_share_snapshot',
                     'owner_net_after_lr','doctor_earning','email','phone','contact_number',
                     'id_number','account_number','bank_account_number'] then
    raise exception 'assert FAIL: doctor_my_network exposes a forbidden LR-comp / owner-residual / PII column';
  end if;
  -- must expose the intended safe columns.
  if not (v_cols @> array['lead_refer_id','lead_refer_name','lead_count','deal_count','doctor_pool_growth']) then
    raise exception 'assert FAIL: doctor_my_network missing an expected safe column';
  end if;

  raise notice 'Build 57: doctor_my_network view created (security_barrier, LR-privacy-safe); asserts passed.';
end $$;

notify pgrst, 'reload schema';
