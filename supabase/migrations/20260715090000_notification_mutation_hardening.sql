-- A11 hardening — make notification mutations fail loudly, and target the owner
-- explicitly for the current owner-only phase.
--
-- Two changes, both CREATE OR REPLACE over functions from 20260714150000
-- (triggers keep their existing definitions — only the function bodies change):
--
-- 1. mark-read RPCs now RETURN what they touched (the updated id, or the row
--    count) instead of void. A silent no-op — RLS/ownership mismatch, or an id
--    that isn't the caller's — now returns null / 0 so the client can surface it
--    loudly instead of showing a false success. Marking is also idempotent now
--    (re-marking an already-read row still returns its id, without moving read_at).
--
-- 2. The three active A-phase triggers (DEAL_APPROVED, DEAL_FUNDED,
--    COMMISSION_PAID) now resolve the recipient as the OWNER explicitly via
--    notify_owner(). In the current owner-only phase the owner is the person who
--    needs to know an event happened, regardless of who caused it. notify_recipient
--    is retained for Phase D.
--
--   >>> PHASE D REQUIREMENT <<<
--   When Doctor's (Bright Destiny) partner portal ships, extend DEAL_APPROVED,
--   DEAL_FUNDED, COMMISSION_PAID and the (then-active) LEAD_CREATED_FOR_YOU so
--   that the referring partner is ALSO notified where applicable — in addition to
--   the owner, not instead of. Use notify_recipient(referral_partner_id) for the
--   partner leg. The owner must keep receiving every event.

-- ---------------------------------------------------------------------------
-- 1. Mark-read RPCs return what they touched.
--    Their return type changes (void -> uuid / integer), which CREATE OR REPLACE
--    cannot do, so drop first. Nothing references these but the client RPC calls.
-- ---------------------------------------------------------------------------
drop function if exists public.mark_notification_read(uuid);
drop function if exists public.mark_notifications_read(uuid[]);
drop function if exists public.mark_all_notifications_read();

-- Single: returns the updated id, or null if no row matched the caller.
create or replace function public.mark_notification_read(p_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  update public.notifications
     set read_status = true,
         read_at     = coalesce(read_at, now())
   where id = p_id and user_id = (select auth.uid())
  returning id into v_id;
  return v_id;  -- null => nothing updated (wrong owner / missing id): caller treats as failure
end;
$$;

-- Bulk by id: returns the number of rows actually updated.
create or replace function public.mark_notifications_read(p_ids uuid[])
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  update public.notifications
     set read_status = true,
         read_at     = coalesce(read_at, now())
   where id = any(p_ids) and user_id = (select auth.uid());
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- All unread for the caller: returns the number of rows updated.
create or replace function public.mark_all_notifications_read()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  update public.notifications
     set read_status = true,
         read_at     = coalesce(read_at, now())
   where user_id = (select auth.uid()) and read_status = false;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Signature changed (void -> uuid/integer), so re-grant execute to authenticated.
grant execute on function public.mark_notification_read(uuid) to authenticated;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;
grant execute on function public.mark_all_notifications_read() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Resolve the owner explicitly, and point the A-phase triggers at them.
-- ---------------------------------------------------------------------------

-- The single owner profile (owner-only phase recipient for every A-phase event).
create or replace function public.notify_owner()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id from public.profiles p where p.role = 'owner' order by p.created_at limit 1;
$$;
revoke execute on function public.notify_owner() from public, anon, authenticated;

-- DEAL_APPROVED: a funder submission moves to 'approved'.
create or replace function public.notify_deal_approved()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_ref text; v_client text; v_funder text; v_recipient uuid; v_deal uuid;
begin
  if new.status = 'approved'
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    select d.id, d.reference, c.business_name
      into v_deal, v_ref, v_client
      from public.deals d
      left join public.clients c on c.id = d.client_id
     where d.id = new.deal_id;
    select display_name_for_partner into v_funder from public.funders where id = new.funder_id;
    v_recipient := public.notify_owner();  -- Phase D: also notify referring partner
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

-- DEAL_FUNDED: a deal reaches the 'funded' stage.
create or replace function public.notify_deal_funded()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_client text; v_recipient uuid;
begin
  if new.stage = 'funded'
     and (tg_op = 'INSERT' or old.stage is distinct from new.stage) then
    select business_name into v_client from public.clients where id = new.client_id;
    v_recipient := public.notify_owner();  -- Phase D: also notify referring partner
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

-- COMMISSION_PAID: a commission record gets its payment_received_date set.
create or replace function public.notify_commission_paid()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_ref text; v_recipient uuid;
begin
  if new.payment_received_date is not null
     and (tg_op = 'INSERT' or old.payment_received_date is distinct from new.payment_received_date) then
    select reference into v_ref from public.deals where id = new.deal_id;
    v_recipient := public.notify_owner();  -- Phase D: also notify referring partner
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
