-- Staff build, Batch 1 (4/5): secure cross-channel submission intake — tables,
-- guards and RLS. The RPCs that write to these tables are migration 5/5.
--
-- Model (keeps the concepts the handover says must stay separate):
--   leads                          the client enquiry (existing table, reused)
--   submission_intakes             one operational/workflow row per lead:
--                                  channel, organisation/team/leader snapshot,
--                                  claimed agent, assignee, workflow status
--   submission_introducing_parties who introduced the file (no money here)
--   intake_review_flags            duplicate / registration-conflict flags for
--                                  Owner review (never auto-resolved)
--   intake_document_receipts       immutable receipt of a document, metadata only
--   intake_document_flag_events    append-only suspicious-document flags
--
-- Attribution (channel / organisation / team / leader / agent) is fixed at
-- registration. Changing the operational assignee never touches it. Financial
-- splits are NOT stored here — commission stays Owner-only elsewhere.
--
-- All writes happen through SECURITY DEFINER RPCs. No policy grants INSERT /
-- UPDATE / DELETE to any client role.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'submission_channel') then
    create type public.submission_channel as enum ('direct_agent', 'team', 'referral_partner');
  end if;
  if not exists (select 1 from pg_type where typname = 'intake_workflow_status') then
    -- Owner-only decisions (Submitted to funder / Approved / Declined / Closed)
    -- stay on deals and deal_funder_submissions; this workflow ends at Verified.
    create type public.intake_workflow_status as enum
      ('new', 'documents_incomplete', 'complete', 'with_founder', 'verified');
  end if;
  if not exists (select 1 from pg_type where typname = 'intake_archive_reason') then
    create type public.intake_archive_reason as enum ('withdrawn', 'duplicate', 'lapsed');
  end if;
  if not exists (select 1 from pg_type where typname = 'introducing_party_kind') then
    create type public.introducing_party_kind as enum ('agent', 'team_leader', 'organisation', 'external');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- submission_intakes
-- ---------------------------------------------------------------------------
create table if not exists public.submission_intakes (
  lead_id                 uuid primary key references public.leads(id) on delete restrict,
  deal_id                 uuid references public.deals(id) on delete set null,
  channel                 public.submission_channel not null,
  organisation_id         uuid references public.referral_partners(id) on delete restrict,
  team_id                 uuid references public.referral_teams(id) on delete restrict,
  team_leader_profile_id  uuid references public.profiles(id) on delete restrict,
  agent_profile_id        uuid references public.profiles(id) on delete restrict,
  -- What the caller SAID. Unverified; never used to award anything.
  claimed_agent_reference text,
  funding_type            text not null references public.funding_product_catalog(code) on delete restrict,
  workflow_status         public.intake_workflow_status not null default 'new',
  -- Affiliation + agreement-version evidence frozen at registration.
  affiliation_snapshot    jsonb not null default '{}'::jsonb,
  operational_assignee_id uuid references public.profiles(id) on delete set null,
  -- Server-generated, set once on the first transition to Complete, never moved.
  first_complete_at       timestamptz,
  first_complete_by       uuid references public.profiles(id) on delete set null,
  registered_at           timestamptz not null default now(),
  created_by              uuid not null references public.profiles(id) on delete restrict,
  idempotency_key         text not null,
  archived_at             timestamptz,
  archived_by             uuid references public.profiles(id) on delete set null,
  archive_reason_code     public.intake_archive_reason,
  archive_reason          text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint submission_intakes_idem_uq unique (created_by, idempotency_key),
  constraint submission_intakes_idem_len_ck check (length(idempotency_key) between 8 and 100),
  constraint submission_intakes_claimed_len_ck
    check (claimed_agent_reference is null or length(claimed_agent_reference) <= 200),
  constraint submission_intakes_archive_ck check (
    (archived_at is null and archive_reason_code is null and archive_reason is null and archived_by is null)
    or (archived_at is not null and archive_reason_code is not null
        and archive_reason is not null and length(btrim(archive_reason)) >= 10)),
  -- The channel decides which attribution columns must / must not be present.
  constraint submission_intakes_channel_shape_ck check (
    (channel = 'direct_agent'      and organisation_id is null     and team_id is null     and team_leader_profile_id is null)
    or (channel = 'team'           and organisation_id is not null and team_id is not null and team_leader_profile_id is not null)
    or (channel = 'referral_partner' and organisation_id is not null and team_id is null   and team_leader_profile_id is null))
);

create index if not exists submission_intakes_status_idx on public.submission_intakes (workflow_status) where archived_at is null;
create index if not exists submission_intakes_assignee_idx on public.submission_intakes (operational_assignee_id);
create index if not exists submission_intakes_org_idx on public.submission_intakes (organisation_id);
create index if not exists submission_intakes_team_idx on public.submission_intakes (team_id);
create index if not exists submission_intakes_agent_idx on public.submission_intakes (agent_profile_id);
create index if not exists submission_intakes_deal_idx on public.submission_intakes (deal_id);

create or replace function public.submission_intakes_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_transition  boolean := coalesce(current_setting('fnc.intake_transition', true), '') = 'on';
  v_attribution boolean := coalesce(current_setting('fnc.intake_attribution_correction', true), '') = 'on';
begin
  if tg_op = 'DELETE' then
    raise exception 'Submission intakes cannot be deleted; archive instead';
  end if;

  if tg_op = 'INSERT' then
    -- Registration facts are server-generated, never taken from the caller.
    new.first_complete_at := null;
    new.first_complete_by := null;
    new.registered_at := now();
    new.workflow_status := 'new';
    new.archived_at := null;
    return new;
  end if;

  if new.lead_id is distinct from old.lead_id
     or new.registered_at is distinct from old.registered_at
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at
     or new.idempotency_key is distinct from old.idempotency_key then
    raise exception 'Registration facts of a submission intake are immutable';
  end if;

  if (new.channel is distinct from old.channel
      or new.organisation_id is distinct from old.organisation_id
      or new.team_id is distinct from old.team_id
      or new.team_leader_profile_id is distinct from old.team_leader_profile_id
      or new.agent_profile_id is distinct from old.agent_profile_id
      or new.claimed_agent_reference is distinct from old.claimed_agent_reference
      or new.affiliation_snapshot is distinct from old.affiliation_snapshot
      or new.funding_type is distinct from old.funding_type)
     and not v_attribution then
    raise exception 'Attribution is fixed at registration; the Owner corrects it through the audited correction RPC';
  end if;

  if (new.workflow_status is distinct from old.workflow_status
      or new.archived_at is distinct from old.archived_at
      or new.archived_by is distinct from old.archived_by
      or new.archive_reason_code is distinct from old.archive_reason_code
      or new.archive_reason is distinct from old.archive_reason)
     and not v_transition then
    raise exception 'Workflow status changes only through the staff workflow RPCs';
  end if;

  if old.first_complete_at is not null
     and (new.first_complete_at is distinct from old.first_complete_at
          or new.first_complete_by is distinct from old.first_complete_by) then
    raise exception 'The first Complete timestamp is protected and cannot change';
  end if;

  if old.first_complete_at is null then
    if new.workflow_status = 'complete' and old.workflow_status is distinct from 'complete' then
      new.first_complete_at := now();
      new.first_complete_by := (select auth.uid());
    elsif new.first_complete_at is not null or new.first_complete_by is not null then
      raise exception 'first_complete_at is server-generated on the first Complete transition';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists submission_intakes_guard on public.submission_intakes;
create trigger submission_intakes_guard
  before insert or update or delete on public.submission_intakes
  for each row execute function public.submission_intakes_guard();

-- Link the intake to the deal when qualify_lead creates one (deals.lead_id).
-- Runs as definer so it works inside the owner's qualification transaction
-- without touching qualify_lead itself.
create or replace function public.submission_intakes_link_deal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.lead_id is not null then
    update public.submission_intakes si
       set deal_id = new.id
     where si.lead_id = new.lead_id and si.deal_id is distinct from new.id;
  end if;
  return null;
end;
$$;

drop trigger if exists submission_intakes_link_deal on public.deals;
create trigger submission_intakes_link_deal
  after insert or update of lead_id on public.deals
  for each row execute function public.submission_intakes_link_deal();

-- ---------------------------------------------------------------------------
-- submission_introducing_parties
-- ---------------------------------------------------------------------------
create table if not exists public.submission_introducing_parties (
  id              uuid primary key default gen_random_uuid(),
  lead_id         uuid not null references public.submission_intakes(lead_id) on delete restrict,
  party_kind      public.introducing_party_kind not null,
  profile_id      uuid references public.profiles(id) on delete restrict,
  organisation_id uuid references public.referral_partners(id) on delete restrict,
  external_name   text,
  note            text,
  added_by        uuid not null references public.profiles(id) on delete restrict,
  added_at        timestamptz not null default now(),
  removed_at      timestamptz,
  removed_by      uuid references public.profiles(id) on delete set null,
  removed_reason  text,
  constraint submission_introducing_parties_shape_ck check (
    (party_kind in ('agent', 'team_leader') and profile_id is not null and organisation_id is null and external_name is null)
    or (party_kind = 'organisation' and organisation_id is not null and profile_id is null and external_name is null)
    or (party_kind = 'external' and external_name is not null and length(btrim(external_name)) > 0
        and profile_id is null and organisation_id is null)),
  constraint submission_introducing_parties_removal_ck check (
    (removed_at is null and removed_by is null and removed_reason is null)
    or (removed_at is not null and removed_reason is not null and length(btrim(removed_reason)) >= 10)),
  constraint submission_introducing_parties_note_len_ck check (note is null or length(note) <= 500)
);

create unique index if not exists submission_introducing_parties_active_uq
  on public.submission_introducing_parties
  (lead_id, party_kind, coalesce(profile_id::text, ''), coalesce(organisation_id::text, ''), lower(coalesce(external_name, '')))
  where removed_at is null;
create index if not exists submission_introducing_parties_lead_idx on public.submission_introducing_parties (lead_id);

create or replace function public.submission_introducing_parties_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Introducing parties are never deleted; remove with a reason instead';
  end if;
  if old.removed_at is not null then
    raise exception 'A removed introducing party cannot be changed';
  end if;
  if new.lead_id is distinct from old.lead_id
     or new.party_kind is distinct from old.party_kind
     or new.profile_id is distinct from old.profile_id
     or new.organisation_id is distinct from old.organisation_id
     or new.external_name is distinct from old.external_name
     or new.note is distinct from old.note
     or new.added_by is distinct from old.added_by
     or new.added_at is distinct from old.added_at then
    raise exception 'Only the removal fields of an introducing party may change';
  end if;
  return new;
end;
$$;

drop trigger if exists submission_introducing_parties_guard on public.submission_introducing_parties;
create trigger submission_introducing_parties_guard
  before update or delete on public.submission_introducing_parties
  for each row execute function public.submission_introducing_parties_guard();

-- ---------------------------------------------------------------------------
-- intake_review_flags — duplicates / registration conflicts for the Owner.
-- ---------------------------------------------------------------------------
create table if not exists public.intake_review_flags (
  id                       uuid primary key default gen_random_uuid(),
  flag_kind                text not null,
  existing_lead_id         uuid references public.leads(id) on delete set null,
  existing_client_id       uuid references public.clients(id) on delete set null,
  -- The new lead this flag was raised against, when one was created.
  lead_id                  uuid references public.leads(id) on delete set null,
  attempted_business_name  text,
  attempted_cipc           text,
  attempted_channel        public.submission_channel,
  attempted_organisation_id uuid references public.referral_partners(id) on delete set null,
  attempted_team_id        uuid references public.referral_teams(id) on delete set null,
  attempted_agent_profile_id uuid references public.profiles(id) on delete set null,
  claimed_agent_reference  text,
  raised_by                uuid not null references public.profiles(id) on delete restrict,
  raised_at                timestamptz not null default now(),
  status                   text not null default 'open',
  resolved_by              uuid references public.profiles(id) on delete set null,
  resolved_at              timestamptz,
  resolution_note          text,
  constraint intake_review_flags_kind_ck check (flag_kind in
    ('registration_conflict', 'recent_submission', 'duplicate_contact')),
  constraint intake_review_flags_status_ck check (status in ('open', 'dismissed', 'confirmed_conflict')),
  constraint intake_review_flags_resolution_ck check (
    (status = 'open' and resolved_at is null)
    or (status <> 'open' and resolved_at is not null and resolution_note is not null))
);

create index if not exists intake_review_flags_open_idx on public.intake_review_flags (raised_at) where status = 'open';
create index if not exists intake_review_flags_lead_idx on public.intake_review_flags (lead_id);

create or replace function public.intake_review_flags_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Review flags are never deleted; resolve them with a note';
  end if;
  if old.status <> 'open' then
    raise exception 'A resolved review flag cannot be changed';
  end if;
  if row(new.flag_kind, new.existing_lead_id, new.existing_client_id, new.lead_id, new.attempted_business_name,
         new.attempted_cipc, new.attempted_channel, new.attempted_organisation_id, new.attempted_team_id,
         new.attempted_agent_profile_id, new.claimed_agent_reference, new.raised_by, new.raised_at)
     is distinct from
     row(old.flag_kind, old.existing_lead_id, old.existing_client_id, old.lead_id, old.attempted_business_name,
         old.attempted_cipc, old.attempted_channel, old.attempted_organisation_id, old.attempted_team_id,
         old.attempted_agent_profile_id, old.claimed_agent_reference, old.raised_by, old.raised_at) then
    raise exception 'Only the resolution fields of a review flag may change';
  end if;
  return new;
end;
$$;

drop trigger if exists intake_review_flags_guard on public.intake_review_flags;
create trigger intake_review_flags_guard
  before update or delete on public.intake_review_flags
  for each row execute function public.intake_review_flags_guard();

-- ---------------------------------------------------------------------------
-- Document receipts (metadata only) + append-only suspicious flags.
-- The stored file, when there is one, lives in the owner-only documents store
-- (document_id). Staff are never given a read path to it.
-- ---------------------------------------------------------------------------
create table if not exists public.intake_document_receipts (
  id                uuid primary key default gen_random_uuid(),
  lead_id           uuid not null references public.submission_intakes(lead_id) on delete restrict,
  document_type     public.document_type not null,
  received_via      text not null,
  file_label        text,
  original_filename text,
  sha256            text,
  document_id       uuid references public.documents(id) on delete set null,
  received_at       timestamptz not null default now(),
  received_by       uuid not null references public.profiles(id) on delete restrict,
  received_by_role  text not null,
  constraint intake_document_receipts_via_ck
    check (received_via in ('email', 'secure_upload', 'whatsapp_business', 'in_person', 'other')),
  constraint intake_document_receipts_sha_ck check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  constraint intake_document_receipts_label_len_ck check (file_label is null or length(file_label) <= 200),
  constraint intake_document_receipts_filename_len_ck check (original_filename is null or length(original_filename) <= 255)
);

create index if not exists intake_document_receipts_lead_idx on public.intake_document_receipts (lead_id, document_type);

create table if not exists public.intake_document_flag_events (
  id          bigint generated always as identity primary key,
  receipt_id  uuid not null references public.intake_document_receipts(id) on delete restrict,
  event_kind  text not null,
  reason      text not null,
  actor_id    uuid not null references public.profiles(id) on delete restrict,
  actor_role  text not null,
  created_at  timestamptz not null default now(),
  constraint intake_document_flag_events_kind_ck check (event_kind in ('suspicious_flagged', 'flag_cleared')),
  constraint intake_document_flag_events_reason_ck check (length(btrim(reason)) >= 10)
);

create index if not exists intake_document_flag_events_receipt_idx on public.intake_document_flag_events (receipt_id, id);

create or replace function public.intake_append_only_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only: record a new event instead of changing history', tg_table_name;
end;
$$;

drop trigger if exists intake_document_receipts_append_only on public.intake_document_receipts;
create trigger intake_document_receipts_append_only
  before update or delete on public.intake_document_receipts
  for each row execute function public.intake_append_only_guard();

drop trigger if exists intake_document_flag_events_append_only on public.intake_document_flag_events;
create trigger intake_document_flag_events_append_only
  before update or delete on public.intake_document_flag_events
  for each row execute function public.intake_append_only_guard();

-- ---------------------------------------------------------------------------
-- RLS. No INSERT / UPDATE / DELETE policy exists for any client role.
-- ---------------------------------------------------------------------------
alter table public.submission_intakes enable row level security;
alter table public.submission_introducing_parties enable row level security;
alter table public.intake_review_flags enable row level security;
alter table public.intake_document_receipts enable row level security;
alter table public.intake_document_flag_events enable row level security;

drop policy if exists submission_intakes_owner_select on public.submission_intakes;
create policy submission_intakes_owner_select on public.submission_intakes
  for select to authenticated using (public.is_owner());

-- A partner sees the files of their own organisation; a Team Leader sees their
-- own team's files; an agent sees files they are the registered agent on.
-- Nothing else — in particular no other organisation's files.
drop policy if exists submission_intakes_relationship_select on public.submission_intakes;
create policy submission_intakes_relationship_select on public.submission_intakes
  for select to authenticated
  using (
    agent_profile_id = (select auth.uid())
    or (team_id is not null and team_id in (select public.my_team_ids(true)))
    or (organisation_id is not null
        and organisation_id = public.my_organisation_id()
        and exists (select 1 from public.profiles p
                     where p.id = (select auth.uid()) and p.role::text = 'partner'))
  );

drop policy if exists submission_introducing_parties_owner_select on public.submission_introducing_parties;
create policy submission_introducing_parties_owner_select on public.submission_introducing_parties
  for select to authenticated using (public.is_owner());

drop policy if exists intake_review_flags_owner_select on public.intake_review_flags;
create policy intake_review_flags_owner_select on public.intake_review_flags
  for select to authenticated using (public.is_owner());

drop policy if exists intake_document_receipts_owner_select on public.intake_document_receipts;
create policy intake_document_receipts_owner_select on public.intake_document_receipts
  for select to authenticated using (public.is_owner());

drop policy if exists intake_document_flag_events_owner_select on public.intake_document_flag_events;
create policy intake_document_flag_events_owner_select on public.intake_document_flag_events
  for select to authenticated using (public.is_owner());

revoke all on table public.submission_intakes from anon, authenticated;
revoke all on table public.submission_introducing_parties from anon, authenticated;
revoke all on table public.intake_review_flags from anon, authenticated;
revoke all on table public.intake_document_receipts from anon, authenticated;
revoke all on table public.intake_document_flag_events from anon, authenticated;
grant select on table public.submission_intakes to authenticated;
grant select on table public.submission_introducing_parties to authenticated;
grant select on table public.intake_review_flags to authenticated;
grant select on table public.intake_document_receipts to authenticated;
grant select on table public.intake_document_flag_events to authenticated;
