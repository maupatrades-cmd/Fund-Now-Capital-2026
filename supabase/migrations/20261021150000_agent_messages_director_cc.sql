-- Launch priority 4: the Director is copied automatically on every Sales Coordinator internal message (already so
-- since Batch 3) and on every message from a sub-agent, an agent or a Team Leader. docs/FNC-LAUNCH-PLAN-2026-11-09.md
-- section 2; CRM Build Spec "Internal mail" row. Forward-only.
--
-- Who may write to whom now:
--   * staff (Director, Office Administrator, Sales Coordinator, Reception, HR, Field Supervisor): staff, sub-agents,
--     agents, Team Leaders and field consultants;
--   * sub-agents, agents and Team Leaders: the Sales Coordinator only (their single contact point), Director copied;
--   * field consultants: their Field Supervisor (any enabled Field Supervisor until the field team structure exists).
-- Replies go to everyone in the conversation, as before. The field roles take part once their logins exist (#316);
-- until then those branches simply match nobody.

-- Kinds of correspondent. Staff must have staff access switched on.
create or replace function public.comms_kind(p_profile uuid)
returns text
language sql stable security definer set search_path = '' as $$
  select case
    when p.role::text = 'owner' then 'staff'
    when p.role::text in ('administrator', 'coordinator', 'switchboard', 'hr', 'field_supervisor', 'field_consultant')
         and exists (select 1 from public.staff_access s where s.profile_id = p.id and s.staff_role = p.role and s.access_enabled)
      then case when p.role::text = 'field_consultant' then 'field_consultant' else 'staff' end
    when p.role::text = 'lead_referrer' then 'sub_agent'
    when p.role::text = 'contractor' then 'agent'
    when p.role::text = 'partner' then 'team_leader'
  end
  from public.profiles p where p.id = p_profile and p.is_active;
$$;
revoke all on function public.comms_kind(uuid) from public, anon, authenticated;

create or replace function public.comms_can_address(p_sender uuid, p_recipient uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select p_sender <> p_recipient and case public.comms_kind(p_sender)
    when 'staff' then public.comms_kind(p_recipient) in ('staff', 'sub_agent', 'agent', 'team_leader', 'field_consultant')
    when 'field_consultant' then public.comms_kind(p_recipient) = 'staff'
                                 and exists (select 1 from public.profiles p where p.id = p_recipient and p.role::text = 'field_supervisor')
    when 'sub_agent' then public.comms_kind(p_recipient) = 'staff'
                          and exists (select 1 from public.profiles p where p.id = p_recipient and p.role::text = 'coordinator')
    when 'agent' then public.comms_kind(p_recipient) = 'staff'
                      and exists (select 1 from public.profiles p where p.id = p_recipient and p.role::text = 'coordinator')
    when 'team_leader' then public.comms_kind(p_recipient) = 'staff'
                            and exists (select 1 from public.profiles p where p.id = p_recipient and p.role::text = 'coordinator')
    else false end;
$$;
revoke all on function public.comms_can_address(uuid, uuid) from public, anon, authenticated;

create or replace function public.msg_contacts()
returns table (profile_id uuid, full_name text, role_label text)
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if public.comms_kind(v_uid) is null then raise exception 'You do not have permission for this action' using errcode = '42501'; end if;
  return query
    select p.id, p.full_name,
           case p.role::text when 'owner' then 'Director' when 'administrator' then 'Administrator'
                when 'coordinator' then 'Sales Coordinator' when 'switchboard' then 'Reception' when 'hr' then 'HR'
                when 'field_supervisor' then 'Field Supervisor' when 'field_consultant' then 'Field consultant'
                when 'contractor' then 'Agent' when 'partner' then 'Team Leader / partner' else 'Sub-agent' end
      from public.profiles p
     where public.comms_can_address(v_uid, p.id)
     order by case p.role::text when 'owner' then 0 when 'administrator' then 1 when 'coordinator' then 2 when 'switchboard' then 3 when 'hr' then 4 when 'field_supervisor' then 5 when 'field_consultant' then 6
                       when 'partner' then 7 when 'contractor' then 8 else 9 end,
              p.full_name
     limit 500;
end;
$$;

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
  -- Owner rules: everything the Sales Coordinator sends or receives copies the Director, and so does every message from
  -- a sub-agent, an agent or a Team Leader (launch plan, priority 4).
  select exists (select 1 from public.profiles p where p.id = v_uid and p.role::text = 'coordinator')
      or public.comms_kind(v_uid) in ('sub_agent', 'agent', 'team_leader') into v_sender_coord;
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
