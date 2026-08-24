-- Owner notification delivery command centre with bounded, auditable email retry.

alter type public.notification_delivery_status add value if not exists 'dead_letter';

alter table public.notification_deliveries
  add column if not exists attempt_number integer not null default 1,
  add column if not exists retry_of uuid references public.notification_deliveries(id) on delete restrict,
  add column if not exists requested_by uuid references public.profiles(id) on delete set null,
  add column if not exists request_key uuid,
  add column if not exists updated_at timestamptz not null default now();

alter table public.notification_deliveries
  drop constraint if exists notification_deliveries_attempt_positive,
  add constraint notification_deliveries_attempt_positive check (attempt_number between 1 and 3);

drop index if exists public.notification_deliveries_one_email;
create unique index if not exists notification_deliveries_attempt_unique
  on public.notification_deliveries (notification_id, channel, attempt_number);
create unique index if not exists notification_deliveries_request_key_unique
  on public.notification_deliveries (request_key)
  where request_key is not null;
create index if not exists notification_deliveries_status_created_idx
  on public.notification_deliveries (delivery_status, created_at desc);

create or replace function public.invoke_retry_notification_email(
  p_notification_id uuid,
  p_delivery_id uuid
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base_url text;
  v_secret text;
begin
  select decrypted_secret into v_base_url
    from vault.decrypted_secrets where name = 'edge_base_url';
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'webhook_secret';

  if v_base_url is null or v_secret is null then
    return false;
  end if;

  begin
    perform net.http_post(
      url := v_base_url || '/functions/v1/send-notification-email',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'X-Webhook-Secret', v_secret
      ),
      body := jsonb_build_object(
        'notification_id', p_notification_id,
        'delivery_id', p_delivery_id
      )
    );
    return true;
  exception when others then
    raise warning 'invoke_retry_notification_email failed for delivery %: %', p_delivery_id, sqlerrm;
    return false;
  end;
end;
$$;

revoke execute on function public.invoke_retry_notification_email(uuid, uuid)
  from public, anon, authenticated;

create or replace function public.owner_retry_notification_email(p_delivery_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_notification_id uuid;
  v_attempt integer;
  v_new_id uuid;
  v_enqueued boolean;
begin
  if (select auth.uid()) is null or not exists (
    select 1 from public.profiles p
     where p.id = (select auth.uid()) and p.role = 'owner'
  ) then
    raise exception 'Owner access required' using errcode = '42501';
  end if;

  select d.notification_id, d.attempt_number
    into v_notification_id, v_attempt
    from public.notification_deliveries d
   where d.id = p_delivery_id
     and d.channel = 'email'
     and d.delivery_status = 'failed'
   for update;

  if v_notification_id is null then
    raise exception 'Only a failed email delivery can be retried' using errcode = '22023';
  end if;
  if v_attempt >= 3 then
    raise exception 'Maximum email attempts reached' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.notification_deliveries d
     where d.notification_id = v_notification_id
       and d.channel = 'email'
       and d.delivery_status = 'pending'
  ) then
    raise exception 'An email attempt is already pending' using errcode = '55000';
  end if;
  if v_attempt <> (
    select max(d.attempt_number) from public.notification_deliveries d
     where d.notification_id = v_notification_id and d.channel = 'email'
  ) then
    raise exception 'Only the latest failed attempt can be retried' using errcode = '22023';
  end if;

  insert into public.notification_deliveries (
    notification_id, channel, delivery_status, attempt_number,
    retry_of, requested_by, request_key
  ) values (
    v_notification_id, 'email', 'pending', v_attempt + 1,
    p_delivery_id, (select auth.uid()), gen_random_uuid()
  ) returning id into v_new_id;

  v_enqueued := public.invoke_retry_notification_email(v_notification_id, v_new_id);
  if not v_enqueued then
    update public.notification_deliveries
       set delivery_status = 'failed',
           error_message = 'Email delivery is not configured or could not be queued',
           updated_at = now()
     where id = v_new_id and delivery_status = 'pending';
  end if;

  return v_new_id;
end;
$$;

revoke execute on function public.owner_retry_notification_email(uuid) from public, anon;
grant execute on function public.owner_retry_notification_email(uuid) to authenticated;

create or replace function public.owner_notification_delivery_workspace()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when (select auth.uid()) is null or not exists (
      select 1 from public.profiles p
       where p.id = (select auth.uid()) and p.role = 'owner'
    ) then null
    else coalesce((
      select jsonb_agg(to_jsonb(w) order by w.created_at desc)
      from (
        select
          n.id as notification_id,
          n.event_type::text as event_type,
          n.title,
          n.body_text,
          n.link_url,
          n.created_at,
          p.full_name as recipient_name,
          p.email as recipient_email,
          coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', d.id,
              'status', d.delivery_status::text,
              'attemptNumber', d.attempt_number,
              'createdAt', d.created_at,
              'sentAt', d.sent_at,
              'errorMessage', d.error_message,
              'externalId', d.external_id,
              'retryOf', d.retry_of
            ) order by d.attempt_number desc)
            from public.notification_deliveries d
            where d.notification_id = n.id and d.channel = 'email'
          ), '[]'::jsonb) as attempts
        from public.notifications n
        join public.profiles p on p.id = n.user_id
        where exists (
          select 1 from public.notification_deliveries d
           where d.notification_id = n.id and d.channel = 'email'
        )
        order by n.created_at desc
        limit 300
      ) w
    ), '[]'::jsonb)
  end;
$$;

revoke execute on function public.owner_notification_delivery_workspace() from public, anon;
grant execute on function public.owner_notification_delivery_workspace() to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and indexname = 'notification_deliveries_attempt_unique'
  ) then
    raise exception 'notification delivery attempt uniqueness was not installed';
  end if;
end $$;
