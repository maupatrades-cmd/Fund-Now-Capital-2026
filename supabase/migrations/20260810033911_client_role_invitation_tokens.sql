-- Backend wave PR 4: revocable, hash-only invitation links and analytics.

create table public.client_invitation_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  issuer_profile_id uuid not null references public.profiles(id) on delete restrict,
  issuer_role text not null check (issuer_role in ('owner','partner','contractor','lead_referrer')),
  referral_partner_id uuid references public.referral_partners(id) on delete cascade,
  lead_referrer_profile_id uuid references public.profiles(id) on delete set null,
  campaign_name text,
  destination_path text not null default '/apply' check (destination_path like '/%'),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by uuid references public.profiles(id) on delete set null,
  max_uses integer not null default 1 check (max_uses between 1 and 10000),
  use_count integer not null default 0 check (use_count >= 0 and use_count <= max_uses),
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  constraint client_invitation_role_scope_ck check (
    (issuer_role = 'owner')
    or (issuer_role = 'partner' and referral_partner_id is not null)
    or (issuer_role = 'contractor' and referral_partner_id is null and lead_referrer_profile_id is null)
    or (issuer_role = 'lead_referrer' and referral_partner_id is not null and lead_referrer_profile_id is not null)
  ),
  constraint client_invitation_expiry_ck check (expires_at > created_at)
);
create index client_invitation_tokens_issuer_idx on public.client_invitation_tokens (issuer_profile_id, created_at desc);
create index client_invitation_tokens_partner_idx on public.client_invitation_tokens (referral_partner_id, created_at desc)
  where referral_partner_id is not null;

create table public.client_invitation_events (
  id uuid primary key default gen_random_uuid(),
  invitation_id uuid not null references public.client_invitation_tokens(id) on delete cascade,
  event_type text not null check (event_type in ('issued','opened','application_submitted','revoked','expired','blocked')),
  application_id uuid,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  ip_hash text check (ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$'),
  user_agent_hash text check (user_agent_hash is null or user_agent_hash ~ '^[0-9a-f]{64}$'),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz not null default now()
);
create index client_invitation_events_invitation_idx on public.client_invitation_events (invitation_id, occurred_at);

alter table public.client_invitation_tokens enable row level security;
alter table public.client_invitation_events enable row level security;
revoke all on public.client_invitation_tokens, public.client_invitation_events from public, anon, authenticated;
grant select on public.client_invitation_tokens, public.client_invitation_events to authenticated;

create policy "client_invitation_tokens_owner_read" on public.client_invitation_tokens
  for select to authenticated using (public.is_owner());
create policy "client_invitation_tokens_issuer_read" on public.client_invitation_tokens
  for select to authenticated using (issuer_profile_id = (select auth.uid()));
create policy "client_invitation_tokens_partner_read" on public.client_invitation_tokens
  for select to authenticated using (
    referral_partner_id is not null and referral_partner_id = public.current_partner_id()
  );
create policy "client_invitation_events_owner_read" on public.client_invitation_events
  for select to authenticated using (public.is_owner());
create policy "client_invitation_events_issuer_read" on public.client_invitation_events
  for select to authenticated using (exists (
    select 1 from public.client_invitation_tokens t
     where t.id = invitation_id and t.issuer_profile_id = (select auth.uid())
  ));
create policy "client_invitation_events_partner_read" on public.client_invitation_events
  for select to authenticated using (exists (
    select 1 from public.client_invitation_tokens t
     where t.id = invitation_id and t.referral_partner_id = public.current_partner_id()
  ));

create or replace function public.consume_client_invitation(
  p_token_hash text,
  p_application_id uuid,
  p_ip_hash text default null,
  p_user_agent_hash text default null
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_token public.client_invitation_tokens%rowtype;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then return null; end if;
  select * into v_token from public.client_invitation_tokens
   where token_hash = p_token_hash for update;
  if not found or v_token.revoked_at is not null or v_token.expires_at <= now()
     or v_token.use_count >= v_token.max_uses then return null; end if;
  update public.client_invitation_tokens
     set use_count = use_count + 1, last_used_at = now()
   where id = v_token.id;
  insert into public.client_invitation_events
    (invitation_id,event_type,application_id,ip_hash,user_agent_hash)
  values (v_token.id,'application_submitted',p_application_id,p_ip_hash,p_user_agent_hash);
  return jsonb_build_object(
    'invitation_id',v_token.id,'issuer_role',v_token.issuer_role,
    'issuer_profile_id',v_token.issuer_profile_id,'referral_partner_id',v_token.referral_partner_id,
    'lead_referrer_profile_id',v_token.lead_referrer_profile_id
  );
end;
$$;
revoke all on function public.consume_client_invitation(text,uuid,text,text) from public, anon, authenticated;
grant execute on function public.consume_client_invitation(text,uuid,text,text) to service_role;

create or replace function public.revoke_client_invitation(p_invitation_id uuid)
returns boolean
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_uid uuid := auth.uid(); v_token public.client_invitation_tokens%rowtype;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  select * into v_token from public.client_invitation_tokens where id = p_invitation_id for update;
  if not found then return false; end if;
  if not public.is_owner() and v_token.issuer_profile_id <> v_uid then
    raise exception 'Only the owner or invitation issuer can revoke this invitation';
  end if;
  if v_token.revoked_at is null then
    update public.client_invitation_tokens set revoked_at=now(), revoked_by=v_uid where id=p_invitation_id;
    insert into public.client_invitation_events (invitation_id,event_type,actor_profile_id)
    values (p_invitation_id,'revoked',v_uid);
  end if;
  return true;
end;
$$;
revoke all on function public.revoke_client_invitation(uuid) from public, anon;
grant execute on function public.revoke_client_invitation(uuid) to authenticated;

do $$
begin
  if has_table_privilege('anon','public.client_invitation_tokens','SELECT')
     or has_table_privilege('authenticated','public.client_invitation_tokens','INSERT') then
    raise exception 'PR4: invitation token privileges are excessive';
  end if;
  if has_function_privilege('anon','public.consume_client_invitation(text,uuid,text,text)','EXECUTE')
     or has_function_privilege('authenticated','public.consume_client_invitation(text,uuid,text,text)','EXECUTE') then
    raise exception 'PR4: consume function is exposed';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname='consume_client_invitation'
       and p.proconfig @> array['search_path=pg_catalog, public']
  ) then
    raise exception 'PR4: consume function search_path is not pinned';
  end if;
  if has_function_privilege('anon','public.revoke_client_invitation(uuid)','EXECUTE') then
    raise exception 'PR4: revoke function is exposed to anon';
  end if;
end;
$$;