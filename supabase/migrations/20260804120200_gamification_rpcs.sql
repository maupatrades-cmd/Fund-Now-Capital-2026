-- GAMIFICATION (Sprint 5, Lane 5c) — part 3 of 3: RPCs + auto-award triggers.
-- ============================================================================
-- Reproduces the live objects (see the reconciliation note in part 1). Function
-- bodies are transcribed VERBATIM from the live database so the repo matches
-- exactly and a fresh `supabase db reset` reproduces current behaviour.
--
--   * award_badge(user, badge_code, context) RETURNS boolean — the single
--       idempotent writer. Resolves the user's role → the correct milestone
--       table, inserts ON CONFLICT DO NOTHING, and ONLY on a genuinely-new award
--       writes a BADGE_AWARDED activity row + fires a BADGE_EARNED notification.
--       Returns true on a new award, false otherwise (already earned / unknown
--       badge / role-ineligible / unknown user). NOT granted to `authenticated`
--       (it takes an arbitrary user_id); the triggers below + other lanes'
--       DEFINER functions (PROGRESSION / CERTIFICATION / TRAINING) call it as the
--       definer and execute it via ownership.
--   * get_my_badges() — the caller's full collection (every applicable badge,
--       earned or not; earned-first, then sort_order, then name). authenticated.
--   * award_first_lead_badge  — leads AFTER INSERT → First Lead.
--   * award_commission_badges — commission_records AFTER INSERT OR UPDATE OF
--       status → First Funded Deal + the R100K/R500K/R1M generation thresholds
--       (thresholds summed over SETTLED shares).
--
-- The progression-level-change auto-award named in the brief is intentionally
-- NOT a trigger here: the progression tables belong to the PROGRESSION lane. The
-- Tier 1/2/3 badges are seeded (part 2) and PROGRESSION calls award_badge() on
-- level change — this lane owns the seam, not their trigger.
-- ============================================================================

-- ===========================================================================
-- award_badge — the single idempotent award entry point (RETURNS boolean).
-- ===========================================================================
create or replace function public.award_badge(
  p_user_id uuid,
  p_badge_code text,
  p_context jsonb default '{}'::jsonb
) returns boolean
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_badge_id     uuid;
  v_badge_name   text;
  v_badge_desc   text;
  v_badge_tier   public.badge_tier;
  v_badge_roles  public.user_role[];
  v_role         text;
  v_email        text;
  v_rows         integer;
  v_ctx          jsonb := coalesce(p_context, '{}'::jsonb);
begin
  if p_user_id is null or coalesce(btrim(p_badge_code), '') = '' then
    return false;
  end if;

  select id, name, description, tier, applies_to_roles
    into v_badge_id, v_badge_name, v_badge_desc, v_badge_tier, v_badge_roles
    from public.badges where code = p_badge_code;
  if v_badge_id is null then
    return false;
  end if;

  select role, email into v_role, v_email
    from public.profiles where id = p_user_id;
  if v_role is null then
    return false;
  end if;

  if not (v_role::public.user_role = any (v_badge_roles)) then
    return false;
  end if;

  if v_role = 'contractor' then
    insert into public.contractor_milestones (user_id, badge_id, context)
    values (p_user_id, v_badge_id, v_ctx)
    on conflict (user_id, badge_id) do nothing;
  elsif v_role = 'partner' then
    insert into public.partner_milestones (user_id, badge_id, context)
    values (p_user_id, v_badge_id, v_ctx)
    on conflict (user_id, badge_id) do nothing;
  else
    return false;
  end if;

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return false;
  end if;

  insert into public.activity_logs
    (occurred_at, user_id, user_email, user_role, event_type, entity_type, entity_id, description, after_values)
  values (
    now(), p_user_id, v_email, v_role, 'BADGE_AWARDED', 'badge', v_badge_id,
    'Badge earned: ' || v_badge_name,
    jsonb_build_object('badge_code', p_badge_code, 'tier', v_badge_tier, 'context', v_ctx)
  );

  perform public.emit_in_app_notification(
    p_user_id,
    'BADGE_EARNED',
    'New badge earned 🏅',
    'You''ve earned the "' || v_badge_name || '" badge. ' || v_badge_desc,
    '/' || v_role || '/badges',
    jsonb_build_object('badge_id', v_badge_id, 'badge_code', p_badge_code, 'tier', v_badge_tier)
  );

  return true;
end;
$$;

revoke all on function public.award_badge(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.award_badge(uuid, text, jsonb) to postgres, service_role;

-- ===========================================================================
-- get_my_badges — the caller's full collection (applicable badges + earned state).
-- ===========================================================================
create or replace function public.get_my_badges()
returns table (
  badge_id     uuid,
  code         text,
  name         text,
  description  text,
  icon_name    text,
  color_class  text,
  tier         public.badge_tier,
  sort_order   integer,
  earned       boolean,
  earned_at    timestamptz,
  context      jsonb
)
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_role text;
begin
  if v_uid is null then
    return;
  end if;
  select role into v_role from public.profiles where id = v_uid;
  if v_role not in ('contractor', 'partner') then
    return;
  end if;

  return query
  select
    b.id, b.code, b.name, b.description, b.icon_name, b.color_class, b.tier, b.sort_order,
    (m.earned_at is not null) as earned,
    m.earned_at,
    m.context
  from public.badges b
  left join lateral (
    select cm.earned_at, cm.context
      from public.contractor_milestones cm
     where v_role = 'contractor' and cm.badge_id = b.id and cm.user_id = v_uid
    union all
    select pm.earned_at, pm.context
      from public.partner_milestones pm
     where v_role = 'partner' and pm.badge_id = b.id and pm.user_id = v_uid
    limit 1
  ) m on true
  where v_role::public.user_role = any (b.applies_to_roles)
  order by (m.earned_at is null), b.sort_order, b.name;
end;
$$;

revoke all on function public.get_my_badges() from public, anon;
grant execute on function public.get_my_badges() to authenticated, postgres, service_role;

-- ===========================================================================
-- Trigger: First Lead — on lead INSERT, award the submitting partner/contractor.
-- ===========================================================================
create or replace function public.award_first_lead_badge()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if new.attributed_to_contractor_id is not null then
    perform public.award_badge(new.attributed_to_contractor_id, 'first_lead',
      jsonb_build_object('lead_id', new.id, 'source', 'lead_insert'));
  elsif new.attributed_to_partner_id is not null then
    perform public.award_badge(new.attributed_to_partner_id, 'first_lead',
      jsonb_build_object('lead_id', new.id, 'source', 'lead_insert'));
  end if;
  return null;
end;
$$;

drop trigger if exists award_first_lead_badge on public.leads;
create trigger award_first_lead_badge
  after insert on public.leads
  for each row execute function public.award_first_lead_badge();

-- ===========================================================================
-- Trigger: First Funded Deal + R100K/R500K/R1M — on commission_records insert /
-- status change. Thresholds sum the earner's SETTLED share.
-- ===========================================================================
create or replace function public.award_commission_badges()
returns trigger
language plpgsql
security definer
set search_path to ''
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

  perform public.award_badge(v_user, 'first_funded_deal',
    jsonb_build_object('deal_id', new.deal_id, 'commission_record_id', new.id));

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

  return null;
end;
$$;

drop trigger if exists award_commission_badges on public.commission_records;
create trigger award_commission_badges
  after insert or update of status on public.commission_records
  for each row execute function public.award_commission_badges();

-- Structural assertions (no genuine award → no notification/email side-effects).
do $$
begin
  assert exists (select 1 from pg_trigger where tgname = 'award_first_lead_badge'), 'lead trigger missing';
  assert exists (select 1 from pg_trigger where tgname = 'award_commission_badges'), 'commission trigger missing';
  assert not exists (
    select 1 from information_schema.role_routine_grants
    where routine_schema = 'public' and routine_name = 'award_badge' and grantee in ('anon','authenticated')
  ), 'award_badge must not be granted to anon/authenticated';
  assert exists (
    select 1 from information_schema.role_routine_grants
    where routine_schema = 'public' and routine_name = 'get_my_badges' and grantee = 'authenticated'
  ), 'get_my_badges must be executable by authenticated';
  raise notice 'gamification_rpcs structural assertions passed';
end $$;
