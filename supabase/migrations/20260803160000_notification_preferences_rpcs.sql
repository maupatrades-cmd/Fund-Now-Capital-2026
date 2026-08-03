-- Notification Preferences — per-event, per-channel control (Sprint 4 Lane 4d)
-- =============================================================================
-- Real goal: every user (owner / partner / contractor) controls which events
-- reach them per channel (email vs in-app), from their own portal.
--
-- DATA-MODEL DECISION (verified against live 2026-08-03):
--   The wide `notification_preferences` table ALREADY EXISTS and is wired into
--   the send-notification-email Edge Function (email_enabled + quiet-hours +
--   digest) and the A11 in-app path. Its shape is one row per (user, event)
--   with a boolean column per channel (email/in_app/whatsapp/sms) — verified
--   live. The lane brief sketched a *new narrow* table (user, event, channel,
--   enabled); creating a second table with the same name is impossible, and a
--   separately-named parallel table would split the source of truth for
--   "email on/off" away from the quiet-hours/digest columns the Edge Function
--   also reads. So we deliver the brief's channel-based CONTRACT as RPCs over
--   the existing wide table — the physical storage is invisible behind the RPC
--   surface, and every acceptance criterion (channel toggles, default-ON,
--   Edge-Function + emit filters, cross-role isolation) is met. No new table.
--
-- This migration is purely additive over the live table:
--   1. owner-read RLS policy (POPIA: user controls own; owner audits all)
--   2. set_notification_preference(event, channel, enabled)   — user self-write
--   3. get_my_notification_preferences()                      — user self-read
--   4. check_notification_channel_enabled(user, event, chan)  — used by emit +
--        the Edge Function; default ON when no row exists
--   5. emit_in_app_notification() gated on the in-app channel preference
--   6. grants matrix (authenticated / postgres / service_role; no anon/PUBLIC)
--   7. DO-block structural + behavioural assertions
-- =============================================================================

-- 1. Owner-read RLS policy ----------------------------------------------------
-- The existing `notification_preferences_own` policy (ALL, user_id = auth.uid())
-- already lets each user read+write only their own rows. We ADD an owner-only
-- SELECT policy so the owner can audit everyone's preferences (POPIA: the data
-- subject controls their own settings; the owner has read oversight). Policies
-- are OR'd, so this widens SELECT for the owner only and changes nothing for
-- partners/contractors.
drop policy if exists notification_preferences_owner_read on public.notification_preferences;
create policy notification_preferences_owner_read
  on public.notification_preferences
  for select
  to authenticated
  using (public.is_owner());

-- 2. set_notification_preference ---------------------------------------------
-- User self-writes a single channel for a single event. auth.uid() is the only
-- writable user_id (never client-supplied), so a caller can only edit their own
-- preferences regardless of the SECURITY DEFINER context. Upsert keeps the row's
-- other channel columns intact. Returns the affected row count and raises if the
-- write was a no-op (silent-RLS rule, CLAUDE.md).
create or replace function public.set_notification_preference(
  p_event_type public.notification_event_type,
  p_channel    text,
  p_enabled    boolean
)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_rows integer;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_channel is null or p_channel not in ('email', 'in_app') then
    raise exception 'unsupported channel: % (only email, in_app are configurable)', p_channel
      using errcode = '22023';
  end if;
  if p_enabled is null then
    raise exception 'p_enabled must not be null' using errcode = '22004';
  end if;

  if p_channel = 'email' then
    insert into public.notification_preferences (user_id, event_type, email_enabled, updated_at)
    values (v_uid, p_event_type, p_enabled, now())
    on conflict (user_id, event_type)
      do update set email_enabled = excluded.email_enabled, updated_at = now();
  else
    insert into public.notification_preferences (user_id, event_type, in_app_enabled, updated_at)
    values (v_uid, p_event_type, p_enabled, now())
    on conflict (user_id, event_type)
      do update set in_app_enabled = excluded.in_app_enabled, updated_at = now();
  end if;

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'notification preference was not saved';
  end if;
end;
$$;

-- 3. get_my_notification_preferences -----------------------------------------
-- Returns the caller's stored preference rows (channel columns projected to the
-- two configurable channels). Missing events simply have no row — the client
-- treats absence as ON, matching check_notification_channel_enabled's default.
create or replace function public.get_my_notification_preferences()
returns table (
  event_type     public.notification_event_type,
  email_enabled  boolean,
  in_app_enabled boolean
)
language sql
security definer
set search_path to ''
as $$
  select np.event_type, np.email_enabled, np.in_app_enabled
  from public.notification_preferences np
  where np.user_id = (select auth.uid());
$$;

-- 4. check_notification_channel_enabled --------------------------------------
-- Single source of truth for "should this channel fire for this user+event".
-- Default ON when no preference row exists (matches the historical Edge-Function
-- and in-app behaviour). Fail-open on an unknown channel — a notification system
-- should never silently swallow a message because of a typo'd channel name.
create or replace function public.check_notification_channel_enabled(
  p_user_id    uuid,
  p_event_type public.notification_event_type,
  p_channel    text
)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select case p_channel
    when 'email' then coalesce(
      (select np.email_enabled
         from public.notification_preferences np
        where np.user_id = p_user_id and np.event_type = p_event_type),
      true)
    when 'in_app' then coalesce(
      (select np.in_app_enabled
         from public.notification_preferences np
        where np.user_id = p_user_id and np.event_type = p_event_type),
      true)
    else true
  end;
$$;

-- 4b. get_notification_event_types -------------------------------------------
-- Returns the notification_event_type enum labels that ACTUALLY exist in this
-- database, in enum order. The preferences matrix intersects its per-role event
-- list against this so it can never render a row whose value is missing from the
-- live enum — which would make set_notification_preference reject the toggle
-- (e.g. CONTRACTOR_APPLICATION_RECEIVED exists in the repo before APPLY-ROUTE's
-- enum migration is applied). Reads only world-readable catalog data.
create or replace function public.get_notification_event_types()
returns setof text
language sql
stable
security definer
set search_path to ''
as $$
  select e.enumlabel::text
  from pg_catalog.pg_enum e
  join pg_catalog.pg_type t on t.oid = e.enumtypid
  where t.typname = 'notification_event_type'
  order by e.enumsortorder;
$$;

-- 5. emit_in_app_notification — gate the in-app channel on preference ---------
-- Unchanged default behaviour: with no preference row (or in_app_enabled=true)
-- this behaves EXACTLY as before — insert the notification, mark the in-app
-- delivery 'delivered', and invoke the email path. When a user has disabled the
-- in-app channel for this event, the canonical notifications row is still
-- written (it is the email Edge Function's data source and the audit record) but
-- created already-read so it never pings the bell's unread badge, and the in-app
-- delivery is recorded 'skipped'. Email is a SEPARATE channel: the
-- send-notification-email Edge Function is the authority on the email
-- preference, so we always invoke it and let it decide — disabling in-app never
-- silently disables email.
create or replace function public.emit_in_app_notification(
  p_user_id uuid,
  p_event   public.notification_event_type,
  p_title   text,
  p_body    text,
  p_link    text,
  p_data    jsonb
)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_notification_id uuid;
  v_in_app          boolean;
begin
  if p_user_id is null then
    return;
  end if;

  v_in_app := public.check_notification_channel_enabled(p_user_id, p_event, 'in_app');

  insert into public.notifications
    (user_id, event_type, title, body_text, link_url, data, read_status, read_at)
  values
    (p_user_id, p_event, p_title, p_body, p_link, p_data,
     not v_in_app,
     case when v_in_app then null else now() end)
  returning id into v_notification_id;

  insert into public.notification_deliveries
    (notification_id, channel, delivery_status, sent_at, delivered_at)
  values
    (v_notification_id, 'in_app',
     case when v_in_app then 'delivered' else 'skipped' end,
     case when v_in_app then now() else null end,
     case when v_in_app then now() else null end);

  perform public.invoke_send_notification_email(v_notification_id);
end;
$$;

-- 6. Grants matrix ------------------------------------------------------------
-- User-facing self-scoped RPCs: authenticated + postgres + service_role.
-- check_notification_channel_enabled takes an arbitrary p_user_id, so it is
-- deliberately NOT granted to authenticated (that would let any signed-in user
-- probe another user's channel booleans); it is called by emit (DEFINER, runs
-- as owner) and by the Edge Function (service_role). No anon / PUBLIC anywhere
-- (FIX-A grants-hardening posture).
--
-- NOTE: Supabase's ALTER DEFAULT PRIVILEGES auto-grants EXECUTE to anon +
-- authenticated on every new public function, so we must revoke from those two
-- roles explicitly (revoking from PUBLIC alone leaves the auto-grants intact —
-- confirmed by dry-run) before re-granting only the intended roles.
revoke all on function public.set_notification_preference(public.notification_event_type, text, boolean) from public, anon, authenticated;
revoke all on function public.get_my_notification_preferences() from public, anon, authenticated;
revoke all on function public.check_notification_channel_enabled(uuid, public.notification_event_type, text) from public, anon, authenticated;
revoke all on function public.get_notification_event_types() from public, anon, authenticated;

grant execute on function public.set_notification_preference(public.notification_event_type, text, boolean)
  to authenticated, postgres, service_role;
grant execute on function public.get_my_notification_preferences()
  to authenticated, postgres, service_role;
grant execute on function public.check_notification_channel_enabled(uuid, public.notification_event_type, text)
  to postgres, service_role;
-- The matrix needs the live enum list for every signed-in role.
grant execute on function public.get_notification_event_types()
  to authenticated, postgres, service_role;

-- 7. Assertions ---------------------------------------------------------------
do $$
declare
  v_secdef boolean;
  v_search text;
begin
  -- functions exist, are SECURITY DEFINER, and pin search_path=''
  for v_secdef, v_search in
    select p.prosecdef, array_to_string(p.proconfig, ',')
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('set_notification_preference',
                        'get_my_notification_preferences',
                        'check_notification_channel_enabled',
                        'emit_in_app_notification')
  loop
    if not v_secdef then
      raise exception 'assertion failed: a notification-prefs function is not SECURITY DEFINER';
    end if;
    if v_search is null or v_search not like '%search_path=%' then
      raise exception 'assertion failed: a notification-prefs function does not pin search_path';
    end if;
  end loop;

  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('set_notification_preference',
                            'get_my_notification_preferences',
                            'check_notification_channel_enabled')) <> 3 then
    raise exception 'assertion failed: expected all 3 new notification-prefs RPCs to exist';
  end if;

  -- owner-read policy present
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'notification_preferences'
      and policyname = 'notification_preferences_owner_read'
  ) then
    raise exception 'assertion failed: notification_preferences_owner_read policy missing';
  end if;

  -- grants matrix
  if not has_function_privilege('authenticated',
        'public.set_notification_preference(public.notification_event_type, text, boolean)', 'EXECUTE') then
    raise exception 'assertion failed: authenticated must EXECUTE set_notification_preference';
  end if;
  if not has_function_privilege('authenticated',
        'public.get_my_notification_preferences()', 'EXECUTE') then
    raise exception 'assertion failed: authenticated must EXECUTE get_my_notification_preferences';
  end if;
  if has_function_privilege('anon',
        'public.set_notification_preference(public.notification_event_type, text, boolean)', 'EXECUTE') then
    raise exception 'assertion failed: anon must NOT EXECUTE set_notification_preference';
  end if;
  if has_function_privilege('authenticated',
        'public.check_notification_channel_enabled(uuid, public.notification_event_type, text)', 'EXECUTE') then
    raise exception 'assertion failed: authenticated must NOT EXECUTE check_notification_channel_enabled';
  end if;

  -- behavioural: default ON when no preference row exists
  if public.check_notification_channel_enabled(gen_random_uuid(), 'DEAL_APPROVED', 'email') is not true then
    raise exception 'assertion failed: email must default ON with no preference row';
  end if;
  if public.check_notification_channel_enabled(gen_random_uuid(), 'DEAL_APPROVED', 'in_app') is not true then
    raise exception 'assertion failed: in_app must default ON with no preference row';
  end if;
  if public.check_notification_channel_enabled(gen_random_uuid(), 'DEAL_APPROVED', 'whatsapp') is not true then
    raise exception 'assertion failed: unknown channel must fail-open (true)';
  end if;

  -- get_notification_event_types returns the live enum (DEAL_APPROVED always exists)
  if not exists (select 1 from public.get_notification_event_types() t(v) where t.v = 'DEAL_APPROVED') then
    raise exception 'assertion failed: get_notification_event_types did not return the live enum';
  end if;
  if not has_function_privilege('authenticated', 'public.get_notification_event_types()', 'EXECUTE') then
    raise exception 'assertion failed: authenticated must EXECUTE get_notification_event_types';
  end if;

  raise notice 'notification_preferences_rpcs: all assertions passed';
end;
$$;
