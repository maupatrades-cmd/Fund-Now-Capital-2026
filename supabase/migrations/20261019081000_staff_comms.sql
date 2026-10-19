-- Administrator Batch 3 (Communication) (2/2). Owner specification 17 Oct 2026 (docs/FNC-ADMINISTRATOR-SPEC-2026-10-17.md,
-- sections 8 and 9). Forward-only.
--
--   1. Notices: the Administrator or the Founder posts a notice to internal staff, sub-agents and/or Team Leaders.
--      A notice can be marked "Needs attention"; then each recipient must acknowledge it. The Administrator and
--      the Founder see who has and has not acknowledged.
--   2. Internal messages:
--        * staff (Founder, Administrator, Sales Coordinator, Switchboard) message each other;
--        * sub-agents can message the Sales Coordinator;
--        * every message the Sales Coordinator sends or receives automatically copies (CC) the Director.
--      HR is not a role yet; it joins this when it exists (Batch 5).
-- Messages and notices are append-only. Text is checked for ID / account-length numbers. All access is through
-- SECURITY DEFINER functions; the tables have RLS on and no grants.

-- 0. Helpers ----------------------------------------------------------------------------------------------------
-- 'staff' (enabled Founder / Administrator / Coordinator / Switchboard), 'sub_agent', or null.
create or replace function public.comms_kind(p_profile uuid)
returns text
language sql stable security definer set search_path = '' as $$
  select case
    when p.role::text = 'owner' then 'staff'
    when p.role::text in ('administrator', 'coordinator', 'switchboard')
         and exists (select 1 from public.staff_access s where s.profile_id = p.id and s.staff_role = p.role and s.access_enabled)
      then 'staff'
    when p.role::text = 'lead_referrer' then 'sub_agent'
  end
  from public.profiles p where p.id = p_profile and p.is_active;
$$;
revoke all on function public.comms_kind(uuid) from public, anon, authenticated;

-- Where a person opens their messages / notices.
create or replace function public.comms_home(p_profile uuid, p_page text)
returns text
language sql stable security definer set search_path = '' as $$
  select case p.role::text
    when 'lead_referrer' then '/lead-referrer/' || p_page
    when 'partner' then '/partner/' || p_page
    when 'contractor' then '/contractor/' || p_page
    else '/staff/' || p_page end
  from public.profiles p where p.id = p_profile;
$$;
revoke all on function public.comms_home(uuid, text) from public, anon, authenticated;

-- 1. Notices ----------------------------------------------------------------------------------------------------
create table if not exists public.staff_notices (
  id              uuid primary key default gen_random_uuid(),
  title           text not null check (length(btrim(title)) between 3 and 160),
  body            text not null check (length(btrim(body)) between 3 and 4000),
  needs_attention boolean not null default false,
  audience        text[] not null check (cardinality(audience) >= 1 and audience <@ array['staff', 'sub_agents', 'team_leaders']),
  created_by      uuid not null references public.profiles(id) on delete restrict,
  created_role    text not null,
  created_at      timestamptz not null default now()
);
create table if not exists public.staff_notice_recipients (
  notice_id       uuid not null references public.staff_notices(id) on delete restrict,
  recipient_id    uuid not null references public.profiles(id) on delete restrict,
  acknowledged_at timestamptz,
  primary key (notice_id, recipient_id)
);
create index if not exists staff_notice_recipients_recipient_idx on public.staff_notice_recipients (recipient_id, notice_id);
alter table public.staff_notices enable row level security;
alter table public.staff_notice_recipients enable row level security;
revoke all on table public.staff_notices from public, anon, authenticated;
revoke all on table public.staff_notice_recipients from public, anon, authenticated;
create trigger staff_notices_append_only before update or delete on public.staff_notices
  for each row execute function public.intake_append_only_guard();

-- A recipient row only ever gains an acknowledgement, once.
create or replace function public.staff_notice_recipient_guard()
returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'Notice recipients cannot be removed'; end if;
  if new.notice_id <> old.notice_id or new.recipient_id <> old.recipient_id or old.acknowledged_at is not null
     or new.acknowledged_at is null then
    raise exception 'A notice can only be acknowledged, once';
  end if;
  return new;
end;
$$;
create trigger staff_notice_recipients_guard before update or delete on public.staff_notice_recipients
  for each row execute function public.staff_notice_recipient_guard();

create or replace function public.staff_post_notice(p_title text, p_body text, p_needs_attention boolean, p_audience text[])
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_uid uuid := (select auth.uid()); v_n integer; r record;
begin
  if not public.staff_is_founder_or_administrator() then
    raise exception 'Only the Administrator or the Founder posts notices' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_title, ''))) not between 3 and 160 then raise exception 'Give the notice a title (3 to 160 characters)'; end if;
  if length(btrim(coalesce(p_body, ''))) not between 3 and 4000 then raise exception 'Write the notice (3 to 4000 characters)'; end if;
  if not public.staff_text_is_safe(p_title) or not public.staff_text_is_safe(p_body) then
    raise exception 'Notices cannot contain ID or account-length numbers';
  end if;
  if p_audience is null or cardinality(p_audience) = 0 or not (p_audience <@ array['staff', 'sub_agents', 'team_leaders']) then
    raise exception 'Choose who the notice is for: staff, sub-agents and/or Team Leaders';
  end if;
  insert into public.staff_notices (title, body, needs_attention, audience, created_by, created_role)
  values (btrim(p_title), btrim(p_body), coalesce(p_needs_attention, false), p_audience, v_uid, public.staff_actor_role())
  returning id into v_id;
  insert into public.staff_notice_recipients (notice_id, recipient_id)
  select distinct v_id, x.id from (
    select p.id from public.profiles p
      join public.staff_access s on s.profile_id = p.id and s.staff_role = p.role and s.access_enabled
     where 'staff' = any (p_audience) and p.is_active and p.role::text in ('administrator', 'coordinator', 'switchboard')
    union
    select p.id from public.profiles p
     where 'sub_agents' = any (p_audience) and p.is_active and p.role::text = 'lead_referrer'
    union
    select m.profile_id from public.referral_team_memberships m join public.profiles p on p.id = m.profile_id
     where 'team_leaders' = any (p_audience) and p.is_active and m.membership_role = 'team_leader'
       and m.effective_from <= public.current_sast_date()
       and (m.effective_to is null or m.effective_to >= public.current_sast_date())
  ) x where x.id <> v_uid;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'Nobody is in that group yet, so the notice was not posted'; end if;
  for r in select recipient_id from public.staff_notice_recipients where notice_id = v_id loop
    perform public.staff_notify(r.recipient_id, 'STAFF_NOTICE_POSTED',
      case when coalesce(p_needs_attention, false) then 'Needs attention: ' else 'Notice: ' end || btrim(p_title),
      case when coalesce(p_needs_attention, false) then 'Open it and acknowledge it.' else left(btrim(p_body), 160) end,
      public.comms_home(r.recipient_id, 'notices'), jsonb_build_object('notice_id', v_id));
  end loop;
  perform public.staff_audit_write('staff_notice', v_id, 'notice_posted', null,
    jsonb_build_object('audience', p_audience, 'needs_attention', coalesce(p_needs_attention, false), 'recipients', v_n));
  return v_id;
end;
$$;

-- The caller's own notices (anyone a notice was sent to).
create or replace function public.my_notices()
returns table (notice_id uuid, title text, body text, needs_attention boolean, posted_by text, created_at timestamptz,
               acknowledged_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select n.id, n.title, n.body, n.needs_attention, p.full_name, n.created_at, r.acknowledged_at
    from public.staff_notice_recipients r
    join public.staff_notices n on n.id = r.notice_id
    join public.profiles p on p.id = n.created_by
   where r.recipient_id = (select auth.uid())
   order by (n.needs_attention and r.acknowledged_at is null) desc, n.created_at desc
   limit 100;
$$;

create or replace function public.acknowledge_notice(p_notice_id uuid)
returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare v_at timestamptz;
begin
  update public.staff_notice_recipients set acknowledged_at = now()
   where notice_id = p_notice_id and recipient_id = (select auth.uid()) and acknowledged_at is null
  returning acknowledged_at into v_at;
  if v_at is null then
    if not exists (select 1 from public.staff_notice_recipients where notice_id = p_notice_id and recipient_id = (select auth.uid())) then
      raise exception 'Notice not found';
    end if;
    select acknowledged_at into v_at from public.staff_notice_recipients where notice_id = p_notice_id and recipient_id = (select auth.uid());
  end if;
  return v_at;
end;
$$;

-- For the Administrator and the Founder: every notice, how many acknowledged, and who is still outstanding.
create or replace function public.staff_notice_board()
returns table (notice_id uuid, title text, needs_attention boolean, audience text[], posted_by text, created_at timestamptz,
               recipients integer, acknowledged integer, outstanding jsonb)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.staff_is_founder_or_administrator() then
    raise exception 'Only the Administrator or the Founder sees the notice board' using errcode = '42501';
  end if;
  return query
    select n.id, n.title, n.needs_attention, n.audience, cp.full_name, n.created_at,
           (select count(*)::int from public.staff_notice_recipients r where r.notice_id = n.id),
           (select count(*)::int from public.staff_notice_recipients r where r.notice_id = n.id and r.acknowledged_at is not null),
           (select coalesce(jsonb_agg(rp.full_name order by rp.full_name), '[]'::jsonb)
              from public.staff_notice_recipients r join public.profiles rp on rp.id = r.recipient_id
             where r.notice_id = n.id and r.acknowledged_at is null)
      from public.staff_notices n join public.profiles cp on cp.id = n.created_by
     order by n.created_at desc
     limit 100;
end;
$$;

-- 2. Internal messages -----------------------------------------------------------------------------------------------
create table if not exists public.internal_messages (
  id          uuid primary key default gen_random_uuid(),
  thread_id   uuid not null,
  sender_id   uuid not null references public.profiles(id) on delete restrict,
  sender_role text not null,
  subject     text check (subject is null or length(btrim(subject)) between 2 and 160),
  body        text not null check (length(btrim(body)) between 1 and 4000),
  created_at  timestamptz not null default now()
);
create index if not exists internal_messages_thread_idx on public.internal_messages (thread_id, created_at);
create table if not exists public.internal_message_recipients (
  message_id   uuid not null references public.internal_messages(id) on delete restrict,
  recipient_id uuid not null references public.profiles(id) on delete restrict,
  kind         text not null check (kind in ('to', 'cc')),
  auto_cc      boolean not null default false,
  read_at      timestamptz,
  primary key (message_id, recipient_id)
);
create index if not exists internal_message_recipients_recipient_idx on public.internal_message_recipients (recipient_id, message_id);
alter table public.internal_messages enable row level security;
alter table public.internal_message_recipients enable row level security;
revoke all on table public.internal_messages from public, anon, authenticated;
revoke all on table public.internal_message_recipients from public, anon, authenticated;
create trigger internal_messages_append_only before update or delete on public.internal_messages
  for each row execute function public.intake_append_only_guard();

-- A recipient row only ever gains a read time, once.
create or replace function public.internal_message_recipient_guard()
returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'Message recipients cannot be removed'; end if;
  if (new.message_id, new.recipient_id, new.kind, new.auto_cc) is distinct from (old.message_id, old.recipient_id, old.kind, old.auto_cc)
     or old.read_at is not null or new.read_at is null then
    raise exception 'A message can only be marked read, once';
  end if;
  return new;
end;
$$;
create trigger internal_message_recipients_guard before update or delete on public.internal_message_recipients
  for each row execute function public.internal_message_recipient_guard();

-- May this sender address this person directly? Staff reach all staff and sub-agents; a sub-agent reaches the
-- Sales Coordinator only (the Director is CC'd automatically).
create or replace function public.comms_can_address(p_sender uuid, p_recipient uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select p_sender <> p_recipient and case public.comms_kind(p_sender)
    when 'staff' then public.comms_kind(p_recipient) in ('staff', 'sub_agent')
    when 'sub_agent' then public.comms_kind(p_recipient) = 'staff'
                          and exists (select 1 from public.profiles p where p.id = p_recipient and p.role::text = 'coordinator')
    else false end;
$$;
revoke all on function public.comms_can_address(uuid, uuid) from public, anon, authenticated;

-- People the caller can start a message with.
create or replace function public.msg_contacts()
returns table (profile_id uuid, full_name text, role_label text)
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if public.comms_kind(v_uid) is null then raise exception 'You do not have permission for this action' using errcode = '42501'; end if;
  return query
    select p.id, p.full_name,
           case p.role::text when 'owner' then 'Director' when 'administrator' then 'Administrator'
                when 'coordinator' then 'Sales Coordinator' when 'switchboard' then 'Reception' else 'Sub-agent' end
      from public.profiles p
     where public.comms_can_address(v_uid, p.id)
     order by case p.role::text when 'owner' then 0 when 'administrator' then 1 when 'coordinator' then 2 when 'switchboard' then 3 else 4 end,
              p.full_name
     limit 500;
end;
$$;

-- Shared body: store one message, its recipients, the automatic Director CC, and the notices.
create or replace function public.msg_deliver(p_thread uuid, p_subject text, p_body text, p_to uuid[])
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid()); v_id uuid; v_sender_coord boolean; r record; v_subject text;
begin
  insert into public.internal_messages (thread_id, sender_id, sender_role, subject, body)
  values (p_thread, v_uid,
          coalesce(public.staff_actor_role(), (select p.role::text from public.profiles p where p.id = v_uid)),
          nullif(btrim(p_subject), ''), btrim(p_body))
  returning id into v_id;
  insert into public.internal_message_recipients (message_id, recipient_id, kind)
  select distinct v_id, t, 'to' from unnest(p_to) t where t <> v_uid;
  -- Owner rule: everything the Sales Coordinator sends or receives copies the Director.
  select exists (select 1 from public.profiles p where p.id = v_uid and p.role::text = 'coordinator') into v_sender_coord;
  if v_sender_coord or exists (select 1 from unnest(p_to) t join public.profiles p on p.id = t where p.role::text = 'coordinator') then
    insert into public.internal_message_recipients (message_id, recipient_id, kind, auto_cc)
    select v_id, o.id, 'cc', true from public.profiles o
     where o.role::text = 'owner' and o.is_active and o.id <> v_uid
       and not exists (select 1 from public.internal_message_recipients x where x.message_id = v_id and x.recipient_id = o.id);
  end if;
  select coalesce(m.subject, '(no subject)') into v_subject from public.internal_messages m
   where m.thread_id = (select thread_id from public.internal_messages where id = v_id) and m.subject is not null
   order by m.created_at limit 1;
  for r in select recipient_id, kind from public.internal_message_recipients where message_id = v_id loop
    perform public.staff_notify(r.recipient_id, 'INTERNAL_MESSAGE_RECEIVED',
      'Message from ' || coalesce((select full_name from public.profiles where id = v_uid), 'a colleague')
        || case when r.kind = 'cc' then ' (copy)' else '' end,
      coalesce(v_subject, '(no subject)'), public.comms_home(r.recipient_id, 'messages'),
      jsonb_build_object('message_id', v_id));
  end loop;
  return v_id;
end;
$$;
revoke all on function public.msg_deliver(uuid, text, text, uuid[]) from public, anon, authenticated;

-- Start a conversation. Returns the thread id.
create or replace function public.msg_send(p_to uuid[], p_subject text, p_body text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_bad integer; v_msg uuid; v_thread uuid;
begin
  if public.comms_kind(v_uid) is null then raise exception 'You do not have permission for this action' using errcode = '42501'; end if;
  if p_to is null or cardinality(p_to) = 0 or cardinality(p_to) > 20 then raise exception 'Choose 1 to 20 people to send to'; end if;
  select count(*) into v_bad from unnest(p_to) t where not public.comms_can_address(v_uid, t);
  if v_bad > 0 then raise exception 'You can not message one or more of those people' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_subject, ''))) not between 2 and 160 then raise exception 'Give the message a subject (2 to 160 characters)'; end if;
  if length(btrim(coalesce(p_body, ''))) not between 1 and 4000 then raise exception 'Write the message (up to 4000 characters)'; end if;
  if not public.staff_text_is_safe(p_subject) or not public.staff_text_is_safe(p_body) then
    raise exception 'Messages cannot contain ID or account-length numbers';
  end if;
  v_thread := gen_random_uuid();
  v_msg := public.msg_deliver(v_thread, p_subject, p_body, p_to);
  return v_thread;
end;
$$;

-- Reply to everyone in the conversation.
create or replace function public.msg_reply(p_thread uuid, p_body text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_to uuid[];
begin
  if public.comms_kind(v_uid) is null then raise exception 'You do not have permission for this action' using errcode = '42501'; end if;
  if not exists (select 1 from public.internal_messages m
                  where m.thread_id = p_thread
                    and (m.sender_id = v_uid or exists (select 1 from public.internal_message_recipients r
                                                         where r.message_id = m.id and r.recipient_id = v_uid))) then
    raise exception 'Conversation not found';
  end if;
  if length(btrim(coalesce(p_body, ''))) not between 1 and 4000 then raise exception 'Write the reply (up to 4000 characters)'; end if;
  if not public.staff_text_is_safe(p_body) then raise exception 'Messages cannot contain ID or account-length numbers'; end if;
  -- Everyone who has taken part, except the Director's automatic copy (the rule re-adds it when it applies).
  select array_agg(distinct x) into v_to from (
    select m.sender_id as x from public.internal_messages m where m.thread_id = p_thread
    union
    select r.recipient_id from public.internal_messages m join public.internal_message_recipients r on r.message_id = m.id
     where m.thread_id = p_thread and not r.auto_cc
  ) s where x <> v_uid and public.comms_kind(x) is not null;
  if v_to is null then raise exception 'Nobody else is left in this conversation'; end if;
  return public.msg_deliver(p_thread, null, p_body, v_to);
end;
$$;

-- The caller's conversations.
create or replace function public.msg_threads()
returns table (thread_id uuid, subject text, last_at timestamptz, last_from text, unread integer, people text)
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if public.comms_kind(v_uid) is null then raise exception 'You do not have permission for this action' using errcode = '42501'; end if;
  return query
    with mine as (
      select distinct m.thread_id from public.internal_messages m
       where m.sender_id = v_uid
          or exists (select 1 from public.internal_message_recipients r where r.message_id = m.id and r.recipient_id = v_uid)
    )
    select t.thread_id,
           (select m.subject from public.internal_messages m where m.thread_id = t.thread_id and m.subject is not null order by m.created_at limit 1),
           (select max(m.created_at) from public.internal_messages m where m.thread_id = t.thread_id),
           (select p.full_name from public.internal_messages m join public.profiles p on p.id = m.sender_id
             where m.thread_id = t.thread_id order by m.created_at desc limit 1),
           (select count(*)::int from public.internal_messages m join public.internal_message_recipients r on r.message_id = m.id
             where m.thread_id = t.thread_id and r.recipient_id = v_uid and r.read_at is null),
           (select string_agg(distinct p.full_name, ', ') from (
               select m.sender_id as pid from public.internal_messages m where m.thread_id = t.thread_id
               union select r.recipient_id from public.internal_messages m join public.internal_message_recipients r on r.message_id = m.id
                where m.thread_id = t.thread_id) x join public.profiles p on p.id = x.pid where x.pid <> v_uid)
      from mine t
     order by 3 desc
     limit 100;
end;
$$;

-- One conversation; opening it marks the caller's copies read.
create or replace function public.msg_thread(p_thread uuid)
returns table (message_id uuid, sender_name text, sender_role text, subject text, body text, created_at timestamptz,
               recipients jsonb, mine boolean)
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if public.comms_kind(v_uid) is null then raise exception 'You do not have permission for this action' using errcode = '42501'; end if;
  if not exists (select 1 from public.internal_messages m
                  where m.thread_id = p_thread
                    and (m.sender_id = v_uid or exists (select 1 from public.internal_message_recipients r
                                                         where r.message_id = m.id and r.recipient_id = v_uid))) then
    raise exception 'Conversation not found';
  end if;
  update public.internal_message_recipients r set read_at = now()
    from public.internal_messages m
   where m.id = r.message_id and m.thread_id = p_thread and r.recipient_id = v_uid and r.read_at is null;
  return query
    select m.id, p.full_name, m.sender_role, m.subject, m.body, m.created_at,
           (select coalesce(jsonb_agg(jsonb_build_object('name', rp.full_name, 'kind', r.kind, 'auto', r.auto_cc) order by r.kind desc, rp.full_name), '[]'::jsonb)
              from public.internal_message_recipients r join public.profiles rp on rp.id = r.recipient_id where r.message_id = m.id),
           m.sender_id = v_uid
      from public.internal_messages m join public.profiles p on p.id = m.sender_id
     where m.thread_id = p_thread
     order by m.created_at
     limit 300;
end;
$$;

-- Grants ----------------------------------------------------------------------------------------------------------
revoke all on function public.staff_post_notice(text, text, boolean, text[]) from public, anon;
revoke all on function public.my_notices() from public, anon;
revoke all on function public.acknowledge_notice(uuid) from public, anon;
revoke all on function public.staff_notice_board() from public, anon;
revoke all on function public.msg_contacts() from public, anon;
revoke all on function public.msg_send(uuid[], text, text) from public, anon;
revoke all on function public.msg_reply(uuid, text) from public, anon;
revoke all on function public.msg_threads() from public, anon;
revoke all on function public.msg_thread(uuid) from public, anon;
grant execute on function public.staff_post_notice(text, text, boolean, text[]) to authenticated;
grant execute on function public.my_notices() to authenticated;
grant execute on function public.acknowledge_notice(uuid) to authenticated;
grant execute on function public.staff_notice_board() to authenticated;
grant execute on function public.msg_contacts() to authenticated;
grant execute on function public.msg_send(uuid[], text, text) to authenticated;
grant execute on function public.msg_reply(uuid, text) to authenticated;
grant execute on function public.msg_threads() to authenticated;
grant execute on function public.msg_thread(uuid) to authenticated;

notify pgrst, 'reload schema';
