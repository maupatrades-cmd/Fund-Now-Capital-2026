-- Notification follow-up for PR #260's evidence-backed client offers (applies after 20260824120000).
-- Reuses the existing notification + delivery ledger and async email invoker.

do $$
begin
  if to_regclass('public.client_funding_offers') is null
     or to_regclass('public.client_funding_offer_decisions') is null then
    raise exception 'Client-offer notification readiness requires PR #260 migrations first';
  end if;
end;
$$;

create or replace function public.notify_client_funding_offer_published()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recipient uuid;
begin
  if new.state = 'published' and old.state is distinct from new.state then
    select p.id
      into v_recipient
    from public.profiles p
    where p.client_id = new.client_id
      and p.role::text = 'client'
      and p.is_active
    order by p.created_at
    limit 1;

    perform public.emit_in_app_notification(
      v_recipient,
      'CLIENT_OFFER_PUBLISHED'::public.notification_event_type,
      'A funding offer is ready',
      'A new evidence-backed funding offer is ready for your review in the secure client portal.',
      '/client/offers',
      jsonb_build_object(
        'offer_id', new.id,
        'deal_id', new.deal_id,
        'client_id', new.client_id
      )
    );
  end if;
  return null;
end;
$$;

create trigger notify_client_funding_offer_published
after update of state on public.client_funding_offers
for each row execute function public.notify_client_funding_offer_published();

create or replace function public.notify_owner_client_funding_offer_decision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_reference text;
  v_event public.notification_event_type;
  v_title text;
  v_body text;
begin
  select p.id into v_owner
  from public.profiles p
  where p.role::text = 'owner' and p.is_active
  order by p.created_at
  limit 1;

  select d.reference into v_reference from public.deals d where d.id = new.deal_id;

  if new.decision = 'accepted' then
    v_event := 'CLIENT_OFFER_ACCEPTED'::public.notification_event_type;
    v_title := 'Client accepted a funding offer';
    v_body := coalesce(v_reference, 'A deal') || ' has an accepted client offer. Continue with KYC and contracting.';
  else
    v_event := 'CLIENT_OFFER_DECLINED'::public.notification_event_type;
    v_title := 'Client declined a funding offer';
    v_body := coalesce(v_reference, 'A deal') || ' has a declined client offer. Review the recorded reason and agree next steps.';
  end if;

  perform public.emit_in_app_notification(
    v_owner,
    v_event,
    v_title,
    v_body,
    '/deals/' || new.deal_id::text,
    jsonb_build_object(
      'offer_id', new.offer_id,
      'decision_id', new.id,
      'deal_id', new.deal_id,
      'client_id', new.client_id,
      'decision', new.decision
    )
  );
  return null;
end;
$$;

create trigger notify_owner_client_funding_offer_decision
after insert on public.client_funding_offer_decisions
for each row execute function public.notify_owner_client_funding_offer_decision();

create or replace function public.owner_client_offer_delivery_evidence(p_offer_id uuid)
returns table (
  channel text,
  delivery_status text,
  sent_at timestamptz,
  delivered_at timestamptz,
  error_message text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not public.is_owner() then
    raise exception 'Owner access required' using errcode = '42501';
  end if;

  if not exists (select 1 from public.client_funding_offers o where o.id = p_offer_id) then
    raise exception 'Offer not found';
  end if;

  return query
  select
    d.channel::text,
    d.delivery_status::text,
    d.sent_at,
    d.delivered_at,
    d.error_message,
    d.created_at
  from public.notifications n
  join public.notification_deliveries d on d.notification_id = n.id
  where n.event_type = 'CLIENT_OFFER_PUBLISHED'::public.notification_event_type
    and n.data ->> 'offer_id' = p_offer_id::text
  order by d.created_at;
end;
$$;

revoke all on function public.notify_client_funding_offer_published() from public, anon, authenticated;
revoke all on function public.notify_owner_client_funding_offer_decision() from public, anon, authenticated;
revoke all on function public.owner_client_offer_delivery_evidence(uuid) from public, anon;
grant execute on function public.owner_client_offer_delivery_evidence(uuid) to authenticated, service_role;

do $$
begin
  if has_function_privilege('anon', 'public.owner_client_offer_delivery_evidence(uuid)', 'execute') then
    raise exception 'Offer delivery evidence must not be available to anon';
  end if;
  if has_function_privilege('authenticated', 'public.notify_client_funding_offer_published()', 'execute') then
    raise exception 'Offer publication trigger function must not be directly executable';
  end if;
  if has_function_privilege('authenticated', 'public.notify_owner_client_funding_offer_decision()', 'execute') then
    raise exception 'Offer decision trigger function must not be directly executable';
  end if;
end;
$$;

notify pgrst, 'reload schema';
