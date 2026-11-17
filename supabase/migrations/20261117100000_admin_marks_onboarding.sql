-- Agent onboarding checklist: the Office Administrator may tick the four documents and the iFacts date too
-- (owner, 17 Nov 2026), alongside HR and the Director. Same function as 20261102100000; only the role check and its
-- message change. Every tick still records the real actor and role in the append-only event log.
create or replace function public.hr_mark_onboarding_item(
  p_profile uuid, p_item text, p_received boolean, p_ifacts_cleared_on date default null, p_note text default null)
returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid()); v_owner boolean := coalesce(public.is_owner(), false);
  v_staff text := public.staff_role_of(); v_role text; v_name text; v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_was_ready boolean; v_now_ready boolean; v_id bigint; v_current boolean; v_current_date date; v_coord uuid;
begin
  if not (v_owner or coalesce(v_staff in ('hr', 'administrator'), false)) then
    raise exception 'Only HR, the Office Administrator or the Director marks onboarding documents' using errcode = '42501';
  end if;
  if p_item is null or p_item not in ('signed_contract', 'certified_id', 'bank_letter', 'ifacts_consent', 'ifacts_cleared') then
    raise exception 'Unknown onboarding item';
  end if;
  if p_received is null then raise exception 'Say whether the item is received'; end if;
  select p.role::text, p.full_name into v_role, v_name from public.profiles p where p.id = p_profile and p.is_active;
  if v_role is null or v_role not in ('partner', 'contractor', 'lead_referrer') then
    raise exception 'The onboarding checklist is for active agents, sub-agents and Team Leaders';
  end if;
  if p_item = 'ifacts_cleared' and p_received then
    if p_ifacts_cleared_on is null or p_ifacts_cleared_on > public.current_sast_date() then
      raise exception 'Enter the date iFacts cleared (today or earlier)';
    end if;
  elsif p_ifacts_cleared_on is not null then
    raise exception 'A date is only recorded when iFacts has cleared';
  end if;
  if v_note is not null and (length(v_note) > 300 or not public.staff_text_is_safe(v_note)) then
    raise exception 'Keep the note under 300 characters, with no ID, bank or other long numbers';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('agent_onboarding:' || p_profile::text, 0));
  if exists (select 1 from public.agent_onboarding_clearances c where c.profile_id = p_profile) then
    raise exception 'The Agent Code is already issued; the checklist is closed';
  end if;
  select e.received, e.ifacts_cleared_on into v_current, v_current_date
    from public.agent_onboarding_checklist_events e
   where e.profile_id = p_profile and e.item = p_item order by e.id desc limit 1;
  if coalesce(v_current, false) = p_received and v_current_date is not distinct from p_ifacts_cleared_on then
    raise exception 'Nothing to change: the item is already marked that way';
  end if;

  v_was_ready := coalesce((public.agent_onboarding_state(p_profile)->>'ready')::boolean, false);
  insert into public.agent_onboarding_checklist_events (profile_id, item, received, ifacts_cleared_on, note, actor_id, actor_role)
  values (p_profile, p_item, p_received, case when p_received then p_ifacts_cleared_on end, v_note, v_uid,
          case when v_owner then 'owner' else v_staff end)
  returning id into v_id;
  perform public.staff_audit_write('agent_onboarding', p_profile,
    case when p_received then 'onboarding_item_received' else 'onboarding_item_withdrawn' end, v_note,
    jsonb_build_object('item', p_item, 'ifacts_cleared_on', p_ifacts_cleared_on));

  v_now_ready := coalesce((public.agent_onboarding_state(p_profile)->>'ready')::boolean, false);
  if v_now_ready and not v_was_ready then
    for v_coord in
      select p.id from public.profiles p join public.staff_access s on s.profile_id = p.id and s.staff_role = p.role
       where p.role::text in ('coordinator', 'administrator') and p.is_active and s.access_enabled
    loop
      perform public.staff_notify(v_coord, 'AGENT_ONBOARDING_READY', 'Agent Code can be issued',
        coalesce(v_name, 'An agent') || ' has all four onboarding documents and a cleared iFacts check.',
        '/staff/onboarding', jsonb_build_object('profile_id', p_profile));
    end loop;
  end if;
  return v_id;
end;
$$;
revoke all on function public.hr_mark_onboarding_item(uuid, text, boolean, date, text) from public, anon;
grant execute on function public.hr_mark_onboarding_item(uuid, text, boolean, date, text) to authenticated;
