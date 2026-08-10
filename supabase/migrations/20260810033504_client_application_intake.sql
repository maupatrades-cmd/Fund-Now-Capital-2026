-- Backend wave PR 3: canonical, owner-governed client application intake.

create table public.client_applications (
  id uuid primary key default gen_random_uuid(),
  idempotency_key uuid not null unique,
  client_id uuid references public.clients(id) on delete set null,
  applicant_profile_id uuid references public.profiles(id) on delete set null,
  business_name text not null check (length(btrim(business_name)) between 2 and 200),
  contact_name text not null check (length(btrim(contact_name)) between 2 and 160),
  contact_email text not null check (contact_email = lower(contact_email) and length(contact_email) <= 254),
  contact_cell text not null check (length(btrim(contact_cell)) between 7 and 32),
  company_registration_number text,
  funding_product text not null check (funding_product in (
    'working_capital','purchase_order','asset_backed','equipment_finance',
    'invoice_discounting','property_finance','investment','private_equity','other'
  )),
  amount_requested numeric(14,2) not null check (amount_requested > 0 and amount_requested <= 100000000),
  product_answers jsonb not null default '{}'::jsonb check (jsonb_typeof(product_answers) = 'object'),
  referral_claim jsonb not null default '{}'::jsonb check (jsonb_typeof(referral_claim) = 'object'),
  referral_claim_status text not null default 'pending'
    check (referral_claim_status in ('pending','verified','invalid','not_supplied')),
  status text not null default 'submitted'
    check (status in ('submitted','owner_review','accepted','rejected','withdrawn')),
  consent_to_process boolean not null,
  consented_at timestamptz not null,
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_applications_consent_ck check (consent_to_process and consented_at <= submitted_at),
  constraint client_applications_review_ck check (
    (status in ('accepted','rejected') and reviewed_at is not null and reviewed_by is not null)
    or status not in ('accepted','rejected')
  )
);

create index client_applications_status_submitted_idx
  on public.client_applications (status, submitted_at desc);
create index client_applications_client_idx
  on public.client_applications (client_id) where client_id is not null;
create trigger client_applications_set_updated_at before update on public.client_applications
  for each row execute function public.set_updated_at();

create table public.client_application_events (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.client_applications(id) on delete cascade,
  event_type text not null check (event_type in (
    'submitted','referral_pending','referral_verified','owner_review','accepted','rejected','withdrawn'
  )),
  actor_id uuid references public.profiles(id) on delete set null,
  event_data jsonb not null default '{}'::jsonb check (jsonb_typeof(event_data) = 'object'),
  occurred_at timestamptz not null default now()
);
create index client_application_events_application_idx
  on public.client_application_events (application_id, occurred_at);

create table public.client_application_attempts (
  id bigint generated always as identity primary key,
  ip_hash text not null check (ip_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);
create index client_application_attempts_ip_created_idx
  on public.client_application_attempts (ip_hash, created_at desc);

alter table public.client_application_attempts enable row level security;
revoke all on public.client_application_attempts from public, anon, authenticated;

create or replace function public.record_client_application_attempt(
  p_ip_hash text,
  p_max_per_window integer default 8,
  p_window_seconds integer default 3600
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  if p_ip_hash !~ '^[0-9a-f]{64}$'
     or p_max_per_window not between 1 and 100
     or p_window_seconds not between 60 and 86400 then
    raise exception 'Invalid rate-limit input';
  end if;

  perform pg_advisory_xact_lock(hashtext('client_application:' || p_ip_hash));
  delete from public.client_application_attempts
   where created_at < now() - interval '24 hours';
  insert into public.client_application_attempts (ip_hash) values (p_ip_hash);
  select count(*) into v_count
    from public.client_application_attempts
   where ip_hash = p_ip_hash
     and created_at >= now() - make_interval(secs => p_window_seconds);
  return v_count > p_max_per_window;
end;
$$;
revoke all on function public.record_client_application_attempt(text,integer,integer) from public, anon, authenticated;
grant execute on function public.record_client_application_attempt(text,integer,integer) to service_role;

alter table public.client_applications enable row level security;
alter table public.client_application_events enable row level security;
revoke all on public.client_applications, public.client_application_events from public, anon, authenticated;
grant select, update on public.client_applications to authenticated;
grant select on public.client_application_events to authenticated;

create policy "client_applications_owner_all" on public.client_applications
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy "client_applications_client_read_own" on public.client_applications
  for select to authenticated using (
    client_id is not null and client_id = public.current_client_id()
  );
create policy "client_application_events_owner_read" on public.client_application_events
  for select to authenticated using (public.is_owner());
create policy "client_application_events_client_read_own" on public.client_application_events
  for select to authenticated using (exists (
    select 1 from public.client_applications a
     where a.id = application_id and a.client_id = public.current_client_id()
  ));

comment on table public.client_applications is
  'Canonical backend intake record. Public callers write only through the hardened Edge Function; no anon table grants.';
comment on column public.client_applications.referral_claim is
  'Untrusted hashed-source claim captured at intake. A later attribution build verifies it before any commission or reward decision.';

do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.client_applications'::regclass) then
    raise exception 'PR3: RLS missing on client_applications';
  end if;
  if has_table_privilege('anon','public.client_applications','SELECT')
     or has_table_privilege('anon','public.client_applications','INSERT') then
    raise exception 'PR3: anon must not access canonical application rows directly';
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.client_applications'::regclass
       and pg_get_constraintdef(oid) like '%100000000%'
  ) then
    raise exception 'PR3: R100 million ceiling assertion failed';
  end if;
end;
$$;
