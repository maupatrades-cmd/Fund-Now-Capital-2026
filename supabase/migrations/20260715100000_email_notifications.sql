-- A12 — Email notifications via Resend (SPEC S4).
--
-- In-app notifications (A11) already write a notification + an in_app delivery
-- row through emit_in_app_notification(). This migration adds the EMAIL leg:
--
-- 1. Enables pg_net (async HTTP from Postgres) and adds a 'skipped' value to the
--    notification_delivery_status enum (used when an email is intentionally not
--    sent — email disabled, quiet hours, or digest mode).
-- 2. invoke_send_notification_email(notification_id): fires an async POST to the
--    send-notification-email Edge Function. URL + shared secret come from Vault
--    (names 'edge_base_url' / 'webhook_secret'), so NO secret lives in this file
--    and none is required for the migration to apply. If Vault isn't configured
--    yet the call is a silent no-op — the in-app notification is unaffected.
-- 3. emit_in_app_notification() calls the invoker after writing the in-app rows,
--    so all four A-phase events (DEAL_APPROVED, DEAL_FUNDED, COMMISSION_PAID and
--    the future LEAD_CREATED_FOR_YOU) attempt email through this single path.
--    The Edge Function owns the skip logic (prefs / quiet hours / digest) and
--    writes the channel='email' delivery row.
-- 4. Backfills the owner's notification_preferences with email_enabled = true for
--    every event type (email on by default for the owner).
--
-- The actual send + skip decisions live in the Edge Function; Postgres only fires
-- the async trigger. Email delivery never blocks the writing transaction.

-- ---------------------------------------------------------------------------
-- 1. pg_net + the 'skipped' delivery status.
-- ---------------------------------------------------------------------------
create extension if not exists pg_net;

-- Intentionally-not-sent deliveries (email disabled / quiet hours / digest).
-- New enum value is not used elsewhere in this migration, so adding it here is safe.
alter type public.notification_delivery_status add value if not exists 'skipped';

-- ---------------------------------------------------------------------------
-- 2. Async invoker: POST { notification_id } to the Edge Function.
--    Reads URL + shared secret from Vault; no-ops cleanly if unset.
-- ---------------------------------------------------------------------------
create or replace function public.invoke_send_notification_email(p_notification_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base_url text;
  v_secret   text;
begin
  select decrypted_secret into v_base_url from vault.decrypted_secrets where name = 'edge_base_url';
  select decrypted_secret into v_secret   from vault.decrypted_secrets where name = 'webhook_secret';

  -- Not configured yet: skip silently. The in-app notification already landed;
  -- email simply won't fire until the Vault secrets are set at deploy time.
  if v_base_url is null or v_secret is null then
    return;
  end if;

  -- Isolate the HTTP enqueue: an email-invocation failure must NEVER roll back
  -- the caller's in-app notification write (the stated non-blocking invariant).
  begin
    perform net.http_post(
      url     := v_base_url || '/functions/v1/send-notification-email',
      headers := jsonb_build_object(
                   'Content-Type',    'application/json',
                   'X-Webhook-Secret', v_secret
                 ),
      body    := jsonb_build_object('notification_id', p_notification_id)
    );
  exception when others then
    raise warning 'invoke_send_notification_email failed for %: %', p_notification_id, sqlerrm;
  end;
end;
$$;
revoke execute on function public.invoke_send_notification_email(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. emit_in_app_notification(): unchanged behaviour, plus fire the email leg.
--    (Re-declared from 20260714150000 with the invoker appended.)
-- ---------------------------------------------------------------------------
create or replace function public.emit_in_app_notification(
  p_user_id uuid,
  p_event   public.notification_event_type,
  p_title   text,
  p_body    text,
  p_link    text,
  p_data    jsonb
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_notification_id uuid;
begin
  if p_user_id is null then
    return;  -- no resolvable recipient; skip silently
  end if;
  insert into public.notifications (user_id, event_type, title, body_text, link_url, data)
  values (p_user_id, p_event, p_title, p_body, p_link, p_data)
  returning id into v_notification_id;

  insert into public.notification_deliveries
    (notification_id, channel, delivery_status, sent_at, delivered_at)
  values (v_notification_id, 'in_app', 'delivered', now(), now());

  -- Email leg (async, non-blocking). The Edge Function decides whether to send
  -- based on the recipient's preferences and writes the email delivery row.
  perform public.invoke_send_notification_email(v_notification_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Email is on by default now that it's live: align the column default so a
--    preference row created by toggling any *other* channel doesn't silently
--    turn email off ("no explicit choice ⇒ email on"). Also backstop the email
--    leg against duplicate sends — at most one 'sent' email row per notification.
-- ---------------------------------------------------------------------------
alter table public.notification_preferences alter column email_enabled set default true;

create unique index if not exists notification_deliveries_one_email_sent
  on public.notification_deliveries (notification_id)
  where channel = 'email' and delivery_status = 'sent';

-- Owner email preferences default ON for every event type.
insert into public.notification_preferences (user_id, event_type, in_app_enabled, email_enabled)
select p.id, evt, true, true
  from public.profiles p
  cross join (select unnest(enum_range(null::public.notification_event_type)) as evt) events
 where p.role = 'owner'
on conflict (user_id, event_type)
  do update set email_enabled = excluded.email_enabled;
