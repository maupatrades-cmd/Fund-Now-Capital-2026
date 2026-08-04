-- GAMIFICATION (Sprint 5, Lane 5c) — part 2 of 3: catalogue + milestone tables.
-- ============================================================================
-- Reproduces the live objects (see the reconciliation note in part 1):
--   * `badges`              — owner-curated catalogue (definitions only, no PII).
--   * `contractor_milestones` / `partner_milestones` — per-user earned ledger
--     (one row per (user, badge); written ONLY by award_badge() (part 3)).
--
-- POPIA / cross-role isolation (matches live policies):
--   * A contractor reads ONLY their own contractor_milestones — the self-read
--     policy checks BOTH user_id = auth.uid() AND the caller's role = contractor.
--   * A partner reads ONLY their own partner_milestones (role = partner).
--   * The owner reads all (audit).
--   * The two milestone tables are role-separate, so neither role can read the
--     other's achievements.
--   * `badges` is readable by any authenticated user (definitions only).
--
-- Writes: milestone tables have NO INSERT/UPDATE/DELETE policy → the only writer
-- is the SECURITY DEFINER award_badge() RPC. Tables are new + empty at first
-- apply, so inline FKs + plain indexes are safe.
-- ============================================================================

-- Badge tier — four-rung visual progression (bronze → platinum).
do $$ begin
  if not exists (select 1 from pg_type where typname = 'badge_tier') then
    create type public.badge_tier as enum ('bronze', 'silver', 'gold', 'platinum');
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- badges — the catalogue.
-- ----------------------------------------------------------------------------
create table if not exists public.badges (
  id                uuid primary key default gen_random_uuid(),
  code              text not null unique,                 -- stable award key (award_badge takes this)
  name              text not null,
  description       text not null,
  icon_name         text not null,                        -- lucide icon name, resolved client-side
  color_class       text not null,                        -- tailwind accent class
  tier              public.badge_tier not null,
  applies_to_roles  public.user_role[] not null,          -- which roles can earn this badge
  sort_order        integer not null default 100,         -- catalogue display order
  created_at        timestamptz not null default now(),
  constraint badges_applies_to_roles_not_empty check (cardinality(applies_to_roles) > 0)
);

comment on table public.badges is
  'Gamification badge catalogue (Lane 5c). Definitions only — no per-user data. award_badge() references rows by `code`.';

alter table public.badges enable row level security;

-- Any signed-in user may read the catalogue (definitions only, no PII).
drop policy if exists badges_read_all on public.badges;
create policy badges_read_all on public.badges
  for select to authenticated using (true);

-- Catalogue is read-only for the API roles; owner curates via service_role/SQL
-- (no runtime badge-authoring surface this lane). Revoke the default write
-- grants (belt-and-braces; RLS already blocks writes without a write policy).
revoke all on table public.badges from anon, authenticated;
grant select on table public.badges to authenticated;

-- ----------------------------------------------------------------------------
-- contractor_milestones — a contractor's earned badges.
-- ----------------------------------------------------------------------------
create table if not exists public.contractor_milestones (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  badge_id    uuid not null references public.badges(id) on delete cascade,
  earned_at   timestamptz not null default now(),
  context     jsonb not null default '{}'::jsonb,
  constraint contractor_milestones_unique unique (user_id, badge_id)
);
create index if not exists contractor_milestones_user_idx on public.contractor_milestones (user_id);
create index if not exists contractor_milestones_badge_idx on public.contractor_milestones (badge_id);

comment on table public.contractor_milestones is
  'Per-contractor earned badges (Lane 5c). One row per (user, badge). Written only by award_badge() (DEFINER).';

alter table public.contractor_milestones enable row level security;

-- Self-read (own rows AND caller is a contractor) + owner-read. No write policy.
drop policy if exists contractor_milestones_self_read on public.contractor_milestones;
create policy contractor_milestones_self_read on public.contractor_milestones
  for select to authenticated
  using (
    user_id = (select auth.uid())
    and (select p.role from public.profiles p where p.id = (select auth.uid())) = 'contractor'::public.user_role
  );

drop policy if exists contractor_milestones_owner_read on public.contractor_milestones;
create policy contractor_milestones_owner_read on public.contractor_milestones
  for select to authenticated using (public.is_owner());

revoke all on table public.contractor_milestones from anon, authenticated;
grant select on table public.contractor_milestones to authenticated;

-- ----------------------------------------------------------------------------
-- partner_milestones — a partner's earned badges (mirror of the above).
-- ----------------------------------------------------------------------------
create table if not exists public.partner_milestones (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  badge_id    uuid not null references public.badges(id) on delete cascade,
  earned_at   timestamptz not null default now(),
  context     jsonb not null default '{}'::jsonb,
  constraint partner_milestones_unique unique (user_id, badge_id)
);
create index if not exists partner_milestones_user_idx on public.partner_milestones (user_id);
create index if not exists partner_milestones_badge_idx on public.partner_milestones (badge_id);

comment on table public.partner_milestones is
  'Per-partner earned badges (Lane 5c). One row per (user, badge). Written only by award_badge() (DEFINER).';

alter table public.partner_milestones enable row level security;

drop policy if exists partner_milestones_self_read on public.partner_milestones;
create policy partner_milestones_self_read on public.partner_milestones
  for select to authenticated
  using (
    user_id = (select auth.uid())
    and (select p.role from public.profiles p where p.id = (select auth.uid())) = 'partner'::public.user_role
  );

drop policy if exists partner_milestones_owner_read on public.partner_milestones;
create policy partner_milestones_owner_read on public.partner_milestones
  for select to authenticated using (public.is_owner());

revoke all on table public.partner_milestones from anon, authenticated;
grant select on table public.partner_milestones to authenticated;

-- ----------------------------------------------------------------------------
-- Seed the catalogue (matches live). Idempotent on `code`. Money badges + First
-- Lead + First Funded Deal are auto-awarded by part 3's triggers. Certified /
-- Tier N / Annual Refresher are seeded so they exist, but are auto-awarded by
-- their owning lanes (CERTIFICATION / PROGRESSION / TRAINING) calling
-- award_badge() — this lane provides the seam, not their triggers.
-- ----------------------------------------------------------------------------
insert into public.badges (code, name, description, icon_name, color_class, tier, applies_to_roles, sort_order) values
  ('first_lead',        'First Lead',               'Submitted your very first lead to Fund Now Capital.',           'Sprout',        'text-brand-green', 'bronze',   array['contractor','partner']::public.user_role[], 10),
  ('first_funded_deal', 'First Funded Deal',        'A deal you brought in reached funding for the first time.',     'Banknote',      'text-brand-green', 'silver',   array['contractor','partner']::public.user_role[], 20),
  ('generated_100k',    'R100K Generated',          'Generated R100,000 in commission — a strong start.',            'Coins',         'text-brand-teal',  'silver',   array['contractor','partner']::public.user_role[], 30),
  ('generated_500k',    'R500K Generated',          'Generated R500,000 in commission — serious momentum.',          'TrendingUp',    'text-brand-teal',  'gold',     array['contractor','partner']::public.user_role[], 40),
  ('generated_1m',      'R1M Generated',            'Generated R1,000,000 in commission — a million-rand producer.', 'Trophy',        'text-amber-500',   'platinum', array['contractor','partner']::public.user_role[], 50),
  ('tier_1_reached',    'Tier 1 Reached',           'Reached Tier 1 in the contractor progression programme.',       'Medal',         'text-amber-700',   'bronze',   array['contractor']::public.user_role[],           60),
  ('tier_2_reached',    'Tier 2 Reached',           'Reached Tier 2 in the contractor progression programme.',       'Medal',         'text-slate-400',   'silver',   array['contractor']::public.user_role[],           70),
  ('tier_3_reached',    'Tier 3 Reached',           'Reached Tier 3 in the contractor progression programme.',       'Medal',         'text-amber-500',   'gold',     array['contractor']::public.user_role[],           80),
  ('certified',         'Certified FNC Contractor', 'Completed FNC certification — a fully certified contractor.',    'BadgeCheck',    'text-brand-teal',  'gold',     array['contractor']::public.user_role[],           90),
  ('annual_refresher',  'Annual Refresher',         'Completed your annual certification refresher — staying sharp.', 'CalendarCheck', 'text-brand-navy',  'bronze',   array['contractor']::public.user_role[],          100)
on conflict (code) do nothing;

-- Structural assertions (no side-effects; safe on a fresh apply or a dry-run).
do $$
begin
  assert (select relrowsecurity from pg_class where oid = 'public.badges'::regclass), 'badges RLS off';
  assert (select relrowsecurity from pg_class where oid = 'public.contractor_milestones'::regclass), 'contractor_milestones RLS off';
  assert (select relrowsecurity from pg_class where oid = 'public.partner_milestones'::regclass), 'partner_milestones RLS off';
  assert (select count(*) from public.badges) >= 10, 'expected >= 10 seeded badges';
  assert not exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and table_name in ('contractor_milestones','partner_milestones')
      and grantee = 'authenticated' and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')
  ), 'milestone tables must not grant write to authenticated';
  raise notice 'gamification_badges structural assertions passed';
end $$;
