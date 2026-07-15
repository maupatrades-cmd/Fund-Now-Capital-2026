-- A11 — In-app Notification system (SPEC S4).
--
-- Creates three notification tables (notifications, notification_deliveries,
-- notification_preferences), adds four columns to profiles (phone_number,
-- phone_number_verified, whatsapp_opted_in, sms_opted_in), creates trigger
-- functions and attaches triggers on deal_funder_submissions (DEAL_APPROVED),
-- deals (DEAL_FUNDED), and commission_records (COMMISSION_PAID). Includes an
-- inactive stub for LEAD_CREATED_FOR_YOU that activates when the leads table
-- exists (B2).
--
-- In-app notifications are written by SECURITY DEFINER triggers; email/WhatsApp/
-- SMS delivery is A12/D6.

-- ---------------------------------------------------------------------------
-- Enums (full S4 event list; only DEAL_APPROVED/DEAL_FUNDED/COMMISSION_PAID and
-- — once B2 lands — LEAD_CREATED_FOR_YOU are emitted in Phase A).
-- ---------------------------------------------------------------------------
create type public.notification_event_type as enum (
  'LEAD_CREATED_FOR_YOU', 'LEAD_SUBMITTED_BY_PARTNER', 'LEAD_QUALIFICATION_UPDATED',
  'DEAL_SUBMITTED_TO_FUNDER', 'DEAL_APPROVED', 'DEAL_DECLINED', 'DEAL_FUNDED',
  'COMMISSION_PAID', 'FUNDER_RESPONSE_RECEIVED', 'CLIENT_MESSAGE_RECEIVED',
  'FOLLOW_UP_DUE', 'BADGE_EARNED', 'MONTHLY_TARGET_MILESTONE', 'TIER_REVIEW_UPCOMING',
  'FUNDER_RATE_CONFIRMED', 'DOCUMENT_UPLOADED', 'SYSTEM_MAINTENANCE'
);
create type public.notification_channel as enum ('email', 'whatsapp', 'sms', 'in_app');
create type public.notification_delivery_status as enum ('pending', 'sent', 'delivered', 'failed');

-- ---------------------------------------------------------------------------
-- profiles: contact + opt-in columns (used by A12/D6; captured now).
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column phone_number          text,
  add column phone_number_verified boolean not null default false,
  add column whatsapp_opted_in     boolean not null default false,
  add column sms_opted_in          boolean not null default false;

-- commission_records: the payment date that drives COMMISSION_PAID. Nullable;
-- set when FNC records the funder's payment. (Fully wired in C2/C3; added here
-- so the notification trigger has something to fire on — noted in SPEC S4.)
alter table public.commission_records add column payment_received_date date;

-- ---------------------------------------------------------------------------
-- notifications
-- ---------------------------------------------------------------------------
create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  event_type  public.notification_event_type not null,
  title       text not null,
  body_text   text,
  body_html   text,
  link_url    text,
  data        jsonb,
  read_status boolean not null default false,
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);
create index idx_notifications_user on public.notifications (user_id, created_at desc);
create index idx_notifications_user_unread on public.notifications (user_id) where read_status = false;

-- ---------------------------------------------------------------------------
-- notification_deliveries (one row per channel attempt; in_app only for now)
-- ---------------------------------------------------------------------------
create table public.notification_deliveries (
  id              uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  channel         public.notification_channel not null,
  delivery_status public.notification_delivery_status not null default 'pending',
  sent_at         timestamptz,
  delivered_at    timestamptz,
  error_message   text,
  external_id     text,
  created_at      timestamptz not null default now()
);
create index idx_notification_deliveries_notification on public.notification_deliveries (notification_id);

-- ---------------------------------------------------------------------------
-- notification_preferences (one row per user + event)
-- ---------------------------------------------------------------------------
create table public.notification_preferences (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.profiles(id) on delete cascade,
  event_type        public.notification_event_type not null,
  email_enabled     boolean not null default false,
  whatsapp_enabled  boolean not null default false,
  sms_enabled       boolean not null default false,
  in_app_enabled    boolean not null default true,
  quiet_hours_start time,
  quiet_hours_end   time,
  digest_mode       boolean not null default false,
  updated_at        timestamptz not null default now(),
  constraint notification_preferences_user_event_unique unique (user_id, event_type)
);
create index idx_notification_preferences_user on public.notification_preferences (user_id);

-- ---------------------------------------------------------------------------
-- RLS: a user sees only their own rows. Inserts happen only through the
-- SECURITY DEFINER triggers below; marking-read goes through RPCs (also
-- definer, scoped to auth.uid()), so notifications has SELECT-only for users
-- and its bodies can't be tampered with.
-- ---------------------------------------------------------------------------
alter table public.notifications enable row level security;
create policy "notifications_select_own" on public.notifications
  for select to authenticated using (user_id = (select auth.uid()));

alter table public.notification_deliveries enable row level security;
create policy "notification_deliveries_select_own" on public.notification_deliveries
  for select to authenticated using (
    exists (
      select 1 from public.notifications n
      where n.id = notification_deliveries.notification_id
        and n.user_id = (select auth.uid())
    )
  );

alter table public.notification_preferences enable row level security;
create policy "notification_preferences_own" on public.notification_preferences
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Emit helpers (SECURITY DEFINER: system writes on behalf of the recipient).
-- ---------------------------------------------------------------------------

-- Resolve the recipient for a deal/commission: the partner's profile if the row
-- is linked to a referral partner, otherwise the owner.
create or replace function public.notify_recipient(p_referral_partner_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.id from public.profiles p
      where p.referral_partner_id = p_referral_partner_id and p.role = 'partner'
      limit 1),
    (select p.id from public.profiles p where p.role = 'owner' order by p.created_at limit 1)
  );
$$;

-- Create one in-app notification + its delivered in_app delivery row.
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
end;
$$;

revoke execute on function public.notify_recipient(uuid) from public, anon, authenticated;
revoke execute on function public.emit_in_app_notification(uuid, public.notification_event_type, text, text, text, jsonb)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Mark-read RPCs (SECURITY DEFINER, scoped to auth.uid() so a user can only
-- touch their own rows and only the read flags).
-- ---------------------------------------------------------------------------
create or replace function public.mark_notification_read(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.notifications
     set read_status = true, read_at = now()
   where id = p_id and user_id = (select auth.uid()) and read_status = false;
end;
$$;

create or replace function public.mark_notifications_read(p_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.notifications
     set read_status = true, read_at = now()
   where id = any(p_ids) and user_id = (select auth.uid()) and read_status = false;
end;
$$;

create or replace function public.mark_all_notifications_read()
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.notifications
     set read_status = true, read_at = now()
   where user_id = (select auth.uid()) and read_status = false;
end;
$$;

grant execute on function public.mark_notification_read(uuid) to authenticated;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;
grant execute on function public.mark_all_notifications_read() to authenticated;

-- ---------------------------------------------------------------------------
-- Domain-event triggers → in-app notifications. Partner-facing bodies use the
-- FICTIONAL funder name (display_name_for_partner) only — never the real name.
-- ---------------------------------------------------------------------------

-- DEAL_APPROVED: a funder submission moves to 'approved'.
create or replace function public.notify_deal_approved()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_ref text; v_partner uuid; v_client text; v_funder text; v_recipient uuid; v_deal uuid;
begin
  if new.status = 'approved'
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    select d.id, d.reference, d.referral_partner_id, c.business_name
      into v_deal, v_ref, v_partner, v_client
      from public.deals d
      left join public.clients c on c.id = d.client_id
     where d.id = new.deal_id;
    select display_name_for_partner into v_funder from public.funders where id = new.funder_id;
    v_recipient := public.notify_recipient(v_partner);
    perform public.emit_in_app_notification(
      v_recipient, 'DEAL_APPROVED', 'Deal approved',
      coalesce(v_funder, 'A funder') || ' approved ' || coalesce(v_ref, 'a deal')
        || coalesce(' for ' || v_client, '') || '.',
      '/deals/' || v_deal::text,
      jsonb_build_object('deal_id', v_deal, 'submission_id', new.id)
    );
  end if;
  return null;
end;
$$;
create trigger notify_deal_approved
  after insert or update of status on public.deal_funder_submissions
  for each row execute function public.notify_deal_approved();

-- DEAL_FUNDED: a deal reaches the 'funded' stage.
create or replace function public.notify_deal_funded()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_client text; v_recipient uuid;
begin
  if new.stage = 'funded'
     and (tg_op = 'INSERT' or old.stage is distinct from new.stage) then
    select business_name into v_client from public.clients where id = new.client_id;
    v_recipient := public.notify_recipient(new.referral_partner_id);
    perform public.emit_in_app_notification(
      v_recipient, 'DEAL_FUNDED', 'Deal funded 🎉',
      coalesce(new.reference, 'A deal') || coalesce(' for ' || v_client, '') || ' is funded.',
      '/deals/' || new.id::text,
      jsonb_build_object('deal_id', new.id)
    );
  end if;
  return null;
end;
$$;
create trigger notify_deal_funded
  after insert or update of stage on public.deals
  for each row execute function public.notify_deal_funded();

-- COMMISSION_PAID: a commission record gets its payment_received_date set.
create or replace function public.notify_commission_paid()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_ref text; v_recipient uuid;
begin
  if new.payment_received_date is not null
     and (tg_op = 'INSERT' or old.payment_received_date is distinct from new.payment_received_date) then
    select reference into v_ref from public.deals where id = new.deal_id;
    v_recipient := public.notify_recipient(new.referral_partner_id);
    perform public.emit_in_app_notification(
      v_recipient, 'COMMISSION_PAID', 'Commission paid',
      'Your commission of R' || to_char(new.partner_share, 'FM999,999,990')
        || ' for ' || coalesce(v_ref, 'a deal') || ' has been paid.',
      '/deals/' || new.deal_id::text,
      jsonb_build_object('commission_record_id', new.id, 'deal_id', new.deal_id)
    );
  end if;
  return null;
end;
$$;
create trigger notify_commission_paid
  after insert or update of payment_received_date on public.commission_records
  for each row execute function public.notify_commission_paid();

-- LEAD_CREATED_FOR_YOU — PLACEHOLDER (activates in B2 when the leads table
-- exists). B2's migration should add, verbatim in intent:
--
--   create function public.notify_lead_created_for_you() returns trigger ...
--     -- when a lead is created for a partner (referral_partner_id set) or the
--     -- "notify partner now" flag is on, resolve recipient via notify_recipient
--     -- and emit an in-app LEAD_CREATED_FOR_YOU notification linking to the lead.
--   create trigger notify_lead_created_for_you
--     after insert on public.leads for each row
--     execute function public.notify_lead_created_for_you();
--
-- Not created here because public.leads does not exist yet (do not block A11).

-- Notifications broadcast over Supabase Realtime for the live bell badge.
alter publication supabase_realtime add table public.notifications;
