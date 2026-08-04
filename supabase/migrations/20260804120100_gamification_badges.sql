-- ============================================================================
-- GAMIFICATION (Sprint 5 Lane 5c) — badges, milestones, award engine, triggers
-- ============================================================================
-- Real motivational infrastructure for contractors + partners: a version-free
-- badge CATALOG, per-user MILESTONE ledgers (one per role, POPIA-isolated), a
-- single idempotent award engine, and auto-award triggers on the events this
-- lane owns (first lead submitted, first funded deal / commission generated).
--
-- Deliberately OUT of scope (other lanes / later PRs): points, leaderboard,
-- owner-side badge admin UI, certification badges (CERTIFICATION lane awards
-- 'certified'/'annual_refresher' by calling award_badge()), progression tier
-- badges (PROGRESSION lane awards 'tier_1/2/3_reached' the same way). This lane
-- SEEDS those badges and exposes award_badge() as the single cross-lane entry
-- point; it does NOT touch progression/training/certification tables.
--
-- Belt-and-braces posture (CLAUDE.md standing rules):
--   * All writes go through SECURITY DEFINER functions; the milestone tables
--     have NO insert/update/delete grant to authenticated/anon (award_badge is
--     the only writer). award_badge itself is NOT granted to authenticated —
--     only internal DEFINER callers (this lane's triggers + other lanes'
--     DEFINER RPCs) may award, so a user can never self-award.
--   * RLS: owner sees all; a contractor sees ONLY their own contractor_milestones;
--     a partner sees ONLY their own partner_milestones (cross-role isolation is
--     structural — a contractor row can never appear in the partner table).
--   * Idempotent via unique(user_id, badge_id); a duplicate event is a no-op
--     (no double notification, no double audit row).
--   * Structural + behavioural assertions at the tail fail the migration loudly.

-- ---------------------------------------------------------------------------
-- 0. badge_tier enum (brand-new type → safe to create + use in one migration)
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'badge_tier') then
    create type public.badge_tier as enum ('bronze', 'silver', 'gold', 'platinum');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. badges — the catalog. Not user data (no PII); the collection view renders
--    both earned + locked badges, so every authenticated user may read the
--    catalog. Writes happen only via this seed (owner edits later via SQL /
--    Dashboard — no admin UI this lane), so there is no write policy.
-- ---------------------------------------------------------------------------
create table if not exists public.badges (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique,
  name             text not null,
  description      text not null,
  icon_name        text not null,        -- lucide icon name, mirrored in src/lib/badges.ts
  color_class      text not null,        -- tailwind accent class for the medallion
  tier             public.badge_tier not null,
  applies_to_roles public.user_role[] not null,
  sort_order       int not null default 0,  -- deterministic display order in the collection view
  created_at       timestamptz not null default now()
);

comment on table public.badges is
  'GAMIFICATION badge catalog (Sprint 5 Lane 5c). Seeded, immutable via API. applies_to_roles gates which roles can earn/see a badge; award_badge() enforces it.';

alter table public.badges enable row level security;

drop policy if exists badges_read_all on public.badges;
create policy badges_read_all on public.badges
  for select to authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- 2. Milestone ledgers — one per role. Two tables (per the lane brief) keep
--    cross-role isolation structural: a contractor's earned badges physically
--    live in contractor_milestones, a partner's in partner_milestones, so no
--    policy mistake can ever leak one role's badges into the other's surface.
-- ---------------------------------------------------------------------------
create table if not exists public.contractor_milestones (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references public.profiles(id) on delete cascade,
  badge_id  uuid not null references public.badges(id)  on delete cascade,
  earned_at timestamptz not null default now(),
  context   jsonb not null default '{}'::jsonb,
  unique (user_id, badge_id)
);

create table if not exists public.partner_milestones (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references public.profiles(id) on delete cascade,
  badge_id  uuid not null references public.badges(id)  on delete cascade,
  earned_at timestamptz not null default now(),
  context   jsonb not null default '{}'::jsonb,
  unique (user_id, badge_id)
);

comment on table public.contractor_milestones is
  'Badges earned by contractors. Owner reads all; a contractor reads only their own (POPIA). Written only by award_badge() (SECURITY DEFINER); no API write grant.';
comment on table public.partner_milestones is
  'Badges earned by referral partners. Owner reads all; a partner reads only their own (POPIA). Written only by award_badge() (SECURITY DEFINER); no API write grant.';

-- Indexes back the RLS predicates + the per-user reads. Tables start empty, so
-- plain CREATE INDEX (no CONCURRENTLY) is fine and runs inside the migration.
create index if not exists contractor_milestones_user_idx on public.contractor_milestones (user_id);
create index if not exists partner_milestones_user_idx     on public.partner_milestones (user_id);

alter table public.contractor_milestones enable row level security;
alter table public.partner_milestones     enable row level security;

-- Owner: full read. Self: own rows AND the caller's CURRENT role must match the
-- ledger (mirrors current_partner_id()'s role guard + the leads submitter
-- policies) — so if the owner ever re-roles a user, stale visibility is revoked
-- immediately, not just hidden by the empty column.
drop policy if exists contractor_milestones_owner_read on public.contractor_milestones;
create policy contractor_milestones_owner_read on public.contractor_milestones
  for select to authenticated using (public.is_owner());

drop policy if exists contractor_milestones_self_read on public.contractor_milestones;
create policy contractor_milestones_self_read on public.contractor_milestones
  for select to authenticated
  using (
    user_id = (select auth.uid())
    and (select p.role from public.profiles p where p.id = (select auth.uid())) = 'contractor'
  );

drop policy if exists partner_milestones_owner_read on public.partner_milestones;
create policy partner_milestones_owner_read on public.partner_milestones
  for select to authenticated using (public.is_owner());

drop policy if exists partner_milestones_self_read on public.partner_milestones;
create policy partner_milestones_self_read on public.partner_milestones
  for select to authenticated
  using (
    user_id = (select auth.uid())
    and (select p.role from public.profiles p where p.id = (select auth.uid())) = 'partner'
  );

-- No insert/update/delete grants: award_badge() (DEFINER) is the only writer.
revoke insert, update, delete, truncate on table public.contractor_milestones from authenticated, anon;
revoke insert, update, delete, truncate on table public.partner_milestones     from authenticated, anon;

-- ---------------------------------------------------------------------------
-- 3. Seed the initial catalog (~10). ON CONFLICT keeps the migration re-runnable
--    and lets the owner tweak copy later without this clobbering it.
--    Role scoping is honest so the collection view never dangles an
--    un-earnable "locked" badge in front of a role:
--      * lead + commission badges → contractor + partner (both submit leads,
--        both earn a commission share);
--      * tier + certification badges → contractor only (the progression +
--        certification programmes are contractor programmes).
-- ---------------------------------------------------------------------------
insert into public.badges (code, name, description, icon_name, color_class, tier, applies_to_roles, sort_order) values
  ('first_lead',        'First Lead',            'Submitted your very first lead to Fund Now Capital.',                 'Sprout',        'text-brand-green', 'bronze',   array['contractor','partner']::public.user_role[], 10),
  ('first_funded_deal', 'First Funded Deal',     'A deal you brought in reached funding for the first time.',           'Banknote',      'text-brand-green', 'silver',   array['contractor','partner']::public.user_role[], 20),
  ('generated_100k',    'R100K Generated',       'Generated R100,000 in commission — a strong start.',                  'Coins',         'text-brand-teal',  'silver',   array['contractor','partner']::public.user_role[], 30),
  ('generated_500k',    'R500K Generated',       'Generated R500,000 in commission — serious momentum.',                'TrendingUp',    'text-brand-teal',  'gold',     array['contractor','partner']::public.user_role[], 40),
  ('generated_1m',      'R1M Generated',         'Generated R1,000,000 in commission — a million-rand producer.',       'Trophy',        'text-amber-500',   'platinum', array['contractor','partner']::public.user_role[], 50),
  ('tier_1_reached',    'Tier 1 Reached',        'Reached Tier 1 in the contractor progression programme.',             'Medal',         'text-amber-700',   'bronze',   array['contractor']::public.user_role[],           60),
  ('tier_2_reached',    'Tier 2 Reached',        'Reached Tier 2 in the contractor progression programme.',             'Medal',         'text-slate-400',   'silver',   array['contractor']::public.user_role[],           70),
  ('tier_3_reached',    'Tier 3 Reached',        'Reached Tier 3 in the contractor progression programme.',             'Medal',         'text-amber-500',   'gold',     array['contractor']::public.user_role[],           80),
  ('certified',         'Certified FNC Contractor', 'Completed FNC certification — a fully certified contractor.',       'BadgeCheck',    'text-brand-teal',  'gold',     array['contractor']::public.user_role[],           90),
  ('annual_refresher',  'Annual Refresher',      'Completed your annual certification refresher — staying sharp.',      'CalendarCheck', 'text-brand-navy',  'bronze',   array['contractor']::public.user_role[],           100)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- 4. award_badge — the single, idempotent award engine.
--    SECURITY DEFINER. Resolves the badge by code + the target user's role,
--    enforces applies_to_roles eligibility, routes to the role's ledger, and on
--    a genuine (first-time) award writes a BADGE_AWARDED activity row + fires a
--    BADGE_EARNED notification exactly once. Returns true only when a new badge
--    was granted (false on unknown code/user, ineligible role, or duplicate).
--    NOT granted to authenticated: only DEFINER callers award (this lane's
--    triggers + other lanes' DEFINER RPCs). A user can never self-award.
-- ---------------------------------------------------------------------------
create or replace function public.award_badge(
  p_user_id    uuid,
  p_badge_code text,
  p_context    jsonb default '{}'::jsonb
) returns boolean
language plpgsql
security definer
set search_path = ''
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
    return false;  -- unknown badge code → no-op
  end if;

  select role, email into v_role, v_email
    from public.profiles where id = p_user_id;
  if v_role is null then
    return false;  -- no such profile
  end if;

  -- Eligibility: the badge must apply to this user's role. Cast the text role to
  -- the enum so the = ANY(user_role[]) comparison type-checks.
  if not (v_role::public.user_role = any (v_badge_roles)) then
    return false;
  end if;

  -- Route to the role-appropriate ledger; idempotent via unique(user_id, badge_id).
  if v_role = 'contractor' then
    insert into public.contractor_milestones (user_id, badge_id, context)
    values (p_user_id, v_badge_id, v_ctx)
    on conflict (user_id, badge_id) do nothing;
  elsif v_role = 'partner' then
    insert into public.partner_milestones (user_id, badge_id, context)
    values (p_user_id, v_badge_id, v_ctx)
    on conflict (user_id, badge_id) do nothing;
  else
    return false;  -- owner (or any future non-badge-bearing role): nothing to award
  end if;

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return false;  -- already earned → silent, no double notify/log
  end if;

  -- Audit row (CLAUDE.md rule 8). user_id = the earner (not necessarily the
  -- session actor, since triggers fire from other users' actions).
  insert into public.activity_logs
    (occurred_at, user_id, user_email, user_role, event_type, entity_type, entity_id, description, after_values)
  values (
    now(), p_user_id, v_email, v_role, 'BADGE_AWARDED', 'badge', v_badge_id,
    'Badge earned: ' || v_badge_name,
    jsonb_build_object('badge_code', p_badge_code, 'tier', v_badge_tier, 'context', v_ctx)
  );

  -- In-app (+ email) notification to the earner. Link lands on their own
  -- collection view (/contractor/badges or /partner/badges).
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

-- ---------------------------------------------------------------------------
-- 5. get_my_badges — read RPC for the caller's collection view + home card.
--    Returns EVERY badge applicable to the caller's role, left-joined to the
--    caller's own earned row (earned_at NULL ⇒ locked). SECURITY DEFINER but
--    strictly scoped to auth.uid(), so it can never surface another user's
--    milestones. Owner gets an empty set (owner earns no badges). Granted to
--    authenticated (a pure read of the caller's own data).
-- ---------------------------------------------------------------------------
create or replace function public.get_my_badges()
returns table (
  badge_id    uuid,
  code        text,
  name        text,
  description text,
  icon_name   text,
  color_class text,
  tier        public.badge_tier,
  sort_order  int,
  earned      boolean,
  earned_at   timestamptz,
  context     jsonb
)
language plpgsql
stable
security definer
set search_path = ''
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
    return;  -- owner / unknown: no badge surface
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
  order by (m.earned_at is null), b.sort_order, b.name;  -- earned first, then catalog order
end;
$$;

revoke all on function public.get_my_badges() from public, anon;
grant execute on function public.get_my_badges() to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Auto-award trigger: FIRST LEAD (this lane owns the leads-insert badge hook).
--    A lead carries the submitter's auth user id in exactly one attribution
--    column (LEAD-SUBMIT lane). award_badge is idempotent, so firing on every
--    insert is correct — only the first lead ever grants the badge.
-- ---------------------------------------------------------------------------
create or replace function public.award_first_lead_badge()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.attributed_to_contractor_id is not null then
    perform public.award_badge(new.attributed_to_contractor_id, 'first_lead',
      jsonb_build_object('lead_id', new.id, 'source', 'lead_insert'));
  elsif new.attributed_to_partner_id is not null then
    perform public.award_badge(new.attributed_to_partner_id, 'first_lead',
      jsonb_build_object('lead_id', new.id, 'source', 'lead_insert'));
  end if;
  return null;  -- AFTER trigger
end;
$$;

drop trigger if exists award_first_lead_badge on public.leads;
create trigger award_first_lead_badge
  after insert on public.leads
  for each row execute function public.award_first_lead_badge();

-- ---------------------------------------------------------------------------
-- 7. Auto-award trigger: FIRST FUNDED DEAL + R100K/R500K/R1M GENERATED.
--    Fires on commission_records insert (a row = a funded deal wrote a
--    commission) and on status transitions (→ settled realises the amount).
--    "Generated" = the earner's OWN settled share summed across their records —
--    contractor_share for contractors, partner_share for partners. This never
--    exposes FNC gross, the pool, or the tier %, so it is safe under the
--    commission-presentation lock (SPEC S7C / CLAUDE.md). commission_records is
--    0 rows live, so no badge fires until the first genuine funding event.
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

  -- The existence of a commission row means a deal reached funded. Idempotent.
  perform public.award_badge(v_user, 'first_funded_deal',
    jsonb_build_object('deal_id', new.deal_id, 'commission_record_id', new.id));

  -- Cumulative realised (settled) own-share for this earner.
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

drop trigger if exists award_commission_badges on public.commission_records;
create trigger award_commission_badges
  after insert or update of status on public.commission_records
  for each row execute function public.award_commission_badges();

-- ---------------------------------------------------------------------------
-- 8. Assertions — fail the migration loudly if anything is off.
-- ---------------------------------------------------------------------------
do $$
declare
  v_int integer;
begin
  -- tables
  if to_regclass('public.badges') is null then raise exception 'badges table missing'; end if;
  if to_regclass('public.contractor_milestones') is null then raise exception 'contractor_milestones table missing'; end if;
  if to_regclass('public.partner_milestones') is null then raise exception 'partner_milestones table missing'; end if;

  -- RLS enabled on all three
  if (select count(*) from pg_class where oid in (
        'public.badges'::regclass,
        'public.contractor_milestones'::regclass,
        'public.partner_milestones'::regclass) and relrowsecurity) <> 3 then
    raise exception 'RLS not enabled on all badge tables';
  end if;

  -- self-read + owner-read policies present
  if (select count(*) from pg_policies where schemaname='public' and tablename='contractor_milestones'
        and policyname in ('contractor_milestones_owner_read','contractor_milestones_self_read')) <> 2 then
    raise exception 'contractor_milestones policies missing';
  end if;
  if (select count(*) from pg_policies where schemaname='public' and tablename='partner_milestones'
        and policyname in ('partner_milestones_owner_read','partner_milestones_self_read')) <> 2 then
    raise exception 'partner_milestones policies missing';
  end if;

  -- unique constraints (idempotency backbone)
  if not exists (select 1 from pg_constraint where conrelid='public.contractor_milestones'::regclass and contype='u') then
    raise exception 'contractor_milestones unique(user,badge) missing';
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.partner_milestones'::regclass and contype='u') then
    raise exception 'partner_milestones unique(user,badge) missing';
  end if;

  -- seed present (10 badges)
  select count(*) into v_int from public.badges;
  if v_int < 10 then raise exception 'expected >=10 seeded badges, found %', v_int; end if;

  -- functions exist
  if to_regprocedure('public.award_badge(uuid,text,jsonb)') is null then raise exception 'award_badge missing'; end if;
  if to_regprocedure('public.get_my_badges()') is null then raise exception 'get_my_badges missing'; end if;

  -- grants: award_badge NOT executable by authenticated (no self-award); anon no
  if has_function_privilege('authenticated', 'public.award_badge(uuid,text,jsonb)', 'execute') then
    raise exception 'award_badge must NOT be executable by authenticated (self-award risk)';
  end if;
  if has_function_privilege('anon', 'public.award_badge(uuid,text,jsonb)', 'execute') then
    raise exception 'award_badge must NOT be executable by anon';
  end if;
  -- get_my_badges: authenticated yes, anon no
  if not has_function_privilege('authenticated', 'public.get_my_badges()', 'execute') then
    raise exception 'get_my_badges must be executable by authenticated';
  end if;
  if has_function_privilege('anon', 'public.get_my_badges()', 'execute') then
    raise exception 'get_my_badges must NOT be executable by anon';
  end if;

  -- triggers wired
  if not exists (select 1 from pg_trigger where tgrelid='public.leads'::regclass and tgname='award_first_lead_badge') then
    raise exception 'award_first_lead_badge trigger missing on leads';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid='public.commission_records'::regclass and tgname='award_commission_badges') then
    raise exception 'award_commission_badges trigger missing on commission_records';
  end if;
end $$;
