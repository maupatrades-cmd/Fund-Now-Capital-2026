-- ============================================================================
-- GAMIFICATION fix — close the concurrent-settlement badge race (Ito QA finding)
-- ============================================================================
-- award_commission_badges() computes the earner's cumulative SETTLED own-share
-- and awards the R100K/R500K/R1M "Generated" thresholds. The aggregate read was
-- unserialized: under READ COMMITTED, two commission rows settling in concurrent
-- transactions can each see a total that excludes the other's uncommitted row.
-- If the *combined* committed total crosses a threshold (e.g. R98k + R3k = R101k)
-- but neither transaction saw >= R100k, the badge is PERMANENTLY missed —
-- award_badge()'s idempotency doesn't help because no later trigger is
-- guaranteed to fire.
--
-- Fix (mirrors every funder-invoice state RPC in this codebase): take a
-- transaction-scoped advisory lock keyed by the resolved earner BEFORE the
-- aggregate. The lock is held to end-of-transaction, so a second settling
-- transaction blocks until the first commits, then re-runs its SUM against a
-- fresh READ COMMITTED snapshot that now includes the first row — the
-- later-committing transaction therefore always sees the full total and awards
-- the crossed threshold. award_badge() idempotency still prevents any
-- double-award. First-funded-deal is idempotent regardless, but sits inside the
-- lock too so the whole per-earner section is serialized.
--
-- CREATE OR REPLACE only — no schema change, no data change. commission_records
-- is still 0 rows live, so this changes no existing award.

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
  -- Resolve the earner as an auth user id (profiles.id). contractor_id already
  -- IS a profiles.id; a partner is resolved from referral_partner_id.
  if new.contractor_id is not null then
    v_user := new.contractor_id;
  elsif new.referral_partner_id is not null then
    select p.id into v_user
      from public.profiles p
     where p.referral_partner_id = new.referral_partner_id and p.role = 'partner'
     order by p.created_at
     limit 1;
  else
    return null;  -- direct/owner rows have no badge earner
  end if;
  if v_user is null then
    return null;
  end if;

  -- Serialize the aggregate + threshold-award section per earner (see header).
  -- Held until this transaction ends; a concurrent settlement for the same earner
  -- blocks here, then re-aggregates against a snapshot that includes our row.
  perform pg_advisory_xact_lock(hashtext('badge_commission_earner:' || v_user::text));

  -- The existence of a commission row means a deal reached funded. Idempotent.
  perform public.award_badge(v_user, 'first_funded_deal',
    jsonb_build_object('deal_id', new.deal_id, 'commission_record_id', new.id));

  -- Cumulative realised (settled) own-share for this earner. Taken AFTER the lock
  -- so a later-committing concurrent settlement sees the full committed total.
  select coalesce(sum(
           case when cr.contractor_id is not null then cr.contractor_share
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

  return null;  -- AFTER trigger
end;
$$;

-- Trigger definition is unchanged (still AFTER INSERT OR UPDATE OF status);
-- CREATE OR REPLACE keeps the existing trigger bound to the new body.

do $$
begin
  if position('pg_advisory_xact_lock' in
       pg_get_functiondef('public.award_commission_badges()'::regprocedure)) = 0 then
    raise exception 'award_commission_badges is missing the per-earner advisory lock';
  end if;
end $$;
