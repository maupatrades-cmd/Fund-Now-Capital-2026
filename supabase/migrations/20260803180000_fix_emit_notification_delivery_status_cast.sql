-- Fix-forward: emit_in_app_notification delivery_status enum cast.
-- ============================================================================
-- The notification-preferences rewrite of emit_in_app_notification
-- (20260803160000_notification_preferences_rpcs.sql) inserts delivery_status via
--   case when v_in_app then 'delivered' else 'skipped' end
-- A CASE expression is typed `text`, but public.notification_deliveries.delivery_status
-- is the `notification_delivery_status` ENUM — so the INSERT raises 42804
-- ("column ... is of type notification_delivery_status but expression is of type
-- text") on EVERY emit. Because emit_in_app_notification runs inside AFTER
-- triggers (notify_deal_approved, notify_lead_events, follow-up/invoice sweeps,
-- …), a failing emit aborts the operation that triggered it — a live production
-- break. It was latent only because no notification had fired since the broken
-- version was applied.
--
-- This re-creates the function identically EXCEPT for the missing
-- `::public.notification_delivery_status` cast on the delivery_status CASE. Applied
-- to live out-of-band as an incident hotfix (migration
-- `fix_emit_notification_delivery_status_cast`); this file mirrors that fix into
-- the repo so a fresh apply reproduces the corrected function and the code no
-- longer carries the bug. Idempotent (CREATE OR REPLACE).
-- ============================================================================
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
 set search_path to ''
as $function$
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
     -- FIX: cast the text CASE result to the delivery_status enum.
     case when v_in_app then 'delivered' else 'skipped' end::public.notification_delivery_status,
     case when v_in_app then now() else null end,
     case when v_in_app then now() else null end);

  perform public.invoke_send_notification_email(v_notification_id);
end;
$function$;

-- Assertion: the corrected function must carry the enum cast.
do $$
begin
  if position('::public.notification_delivery_status' in
       pg_get_functiondef('public.emit_in_app_notification(uuid,public.notification_event_type,text,text,text,jsonb)'::regprocedure)) = 0 then
    raise exception 'assert: emit_in_app_notification is missing the delivery_status enum cast';
  end if;
  raise notice 'emit_in_app_notification delivery_status enum cast present.';
end $$;

notify pgrst, 'reload schema';
