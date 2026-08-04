-- ============================================================================
-- GAMIFICATION review fixes (PR #126 — CodeRabbit) — owner-approved batch
-- ============================================================================
-- Three fixes; the architectural findings (② multi-user-per-referral earner
-- resolution, ③ multi-earner lock ordering) are deliberately DEFERRED (owner
-- decision — documented in .coordination/status.md). Both are non-exploitable
-- in the current single-partner-user / single-earner-per-settlement reality.
--
-- ① (Major) Aggregate summed the wrong share column for a partner earner.
--    `award_commission_badges` keyed its share-column CASE on cr.contractor_id
--    (the aggregated row) rather than the RESOLVED earner branch. Nothing
--    enforces contractor/partner mutual-exclusivity on a commission row
--    (commission_records_attribution_type_ck only validates the attribution_type
--    text — verified live), so a row carrying both a contractor_id and the
--    partner's referral_partner_id could contribute contractor_share to a
--    partner's total and fire the R100K/R500K/R1M thresholds at the wrong time.
--    Fix: key the CASE on new.contractor_id (the earner branch), matching the
--    WHERE filter's own branch logic. CREATE OR REPLACE keeps the advisory lock
--    from the settlement-race fix. commission_records is 0 rows live.
--
-- Nitpick A: harden the migration assertion to require the advisory lock to
--    appear BEFORE the aggregate in the function body (not merely present), so a
--    future edit that moves the lock below the SUM fails loudly.
--
-- Nitpick B: add an owner-scoped write policy on public.badges (CLAUDE.md rule 3
--    "Owner: full" on every table). The catalog was read-only via the API; the
--    owner edited it via service-role/SQL (which bypasses RLS). This makes owner
--    catalog management available through the authenticated API too. Read-all is
--    preserved (permissive policies OR together).

-- ---------------------------------------------------------------------------
-- ① award_commission_badges — earner-keyed share CASE
-- ---------------------------------------------------------------------------
create or replace function public.award_commission_badges()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user  uuid;
  v_total numeric;
begin
  if new.contractor_id is not null then
    v_user := new.contractor_id;
  elsif new.referral_partner_id is not null then
    select p.id into v_user
      from public.profiles p
     where p.referral_partner_id = new.referral_partner_id and p.role = 'partner'
     order by p.created_at
     limit 1;
  else
    return null;
  end if;
  if v_user is null then
    return null;
  end if;

  perform pg_advisory_xact_lock(hashtext('badge_commission_earner:' || v_user::text));

  perform public.award_badge(v_user, 'first_funded_deal',
    jsonb_build_object('deal_id', new.deal_id, 'commission_record_id', new.id));

  -- Share column keyed on the RESOLVED earner branch (new.contractor_id), not on
  -- each aggregated row's cr.contractor_id — so a row that carries both a
  -- contractor_id and the partner's referral_partner_id can never leak
  -- contractor_share into a partner's total (CodeRabbit ① / PR #126).
  select coalesce(sum(
           case when new.contractor_id is not null then cr.contractor_share
                else cr.partner_share end), 0)
    into v_total
    from public.commission_records cr
   where cr.status = 'settled'
     and (
       (new.contractor_id is not null and cr.contractor_id = new.contractor_id)
       or (new.contractor_id is null and new.referral_partner_id is not null
           and cr.referral_partner_id = new.referral_partner_id)
     );

  if v_total >= 1000000 then
    perform public.award_badge(v_user, 'generated_1m',   jsonb_build_object('total_generated', v_total));
  end if;
  if v_total >= 500000 then
    perform public.award_badge(v_user, 'generated_500k', jsonb_build_object('total_generated', v_total));
  end if;
  if v_total >= 100000 then
    perform public.award_badge(v_user, 'generated_100k', jsonb_build_object('total_generated', v_total));
  end if;

  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Nitpick B — owner write policy on public.badges
-- ---------------------------------------------------------------------------
-- Grant the DML privilege to authenticated; RLS confines actual writes to the
-- owner via is_owner(). badges_read_all (SELECT to all authenticated) is kept —
-- permissive policies OR together, so everyone still reads the catalog and only
-- the owner may insert/update/delete.
grant insert, update, delete on table public.badges to authenticated;

drop policy if exists badges_owner_all on public.badges;
create policy badges_owner_all on public.badges
  for all to authenticated
  using (public.is_owner())
  with check (public.is_owner());

-- ---------------------------------------------------------------------------
-- Assertions — ① present + Nitpick A (lock precedes aggregate) + Nitpick B policy
-- ---------------------------------------------------------------------------
do $$
declare
  v_def  text;
  v_lock int;
  v_agg  int;
  v_case int;
begin
  v_def  := pg_get_functiondef('public.award_commission_badges()'::regprocedure);
  v_lock := position('pg_advisory_xact_lock' in v_def);
  v_agg  := position('coalesce(sum(' in v_def);
  v_case := position('case when new.contractor_id is not null then cr.contractor_share' in v_def);

  if v_lock = 0 then
    raise exception 'award_commission_badges missing advisory lock';
  end if;
  if v_agg = 0 then
    raise exception 'award_commission_badges settled-total aggregate not found';
  end if;
  -- Nitpick A: serialization must happen BEFORE aggregation.
  if v_lock > v_agg then
    raise exception 'advisory lock must precede the settled-total aggregate (lock=%, agg=%)', v_lock, v_agg;
  end if;
  -- ①: share column keyed on the resolved earner branch.
  if v_case = 0 then
    raise exception 'aggregate share CASE is not keyed on new.contractor_id (fix ① not applied)';
  end if;
  -- Nitpick B: owner write policy present.
  if not exists (
    select 1 from pg_policies
     where schemaname='public' and tablename='badges' and policyname='badges_owner_all'
  ) then
    raise exception 'badges_owner_all policy missing';
  end if;
end $$;
