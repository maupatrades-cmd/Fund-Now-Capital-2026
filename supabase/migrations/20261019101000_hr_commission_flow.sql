-- Administrator Batch 5a (HR role and commission flow) (2/2). Owner specification 17 Oct 2026, section 4, and owner
-- decisions of 19 Oct 2026: HR is its own login; the agent's invoice is the one they already create in their portal;
-- the commission flow is built first. Forward-only.
--
-- 1. HR staff role. HR holds NOTHING by default: every staff function names the roles it admits, and none of the
--    existing ones name 'hr'. HR gets internal messages and notices (staff), and the HR steps of the commission flow.
--    The owner switches HR access on the same way as the other staff roles.
-- 2. Commission flow: a routing and status layer over Codex's commission notice (see below).
-- Everything is through SECURITY DEFINER functions; the new tables have RLS on and no grants.

-- 1. HR staff role --------------------------------------------------------------------------------------------------
alter table public.staff_access drop constraint if exists staff_access_role_ck;
alter table public.staff_access add constraint staff_access_role_ck
  check (staff_role::text in ('switchboard', 'coordinator', 'administrator', 'hr'));

create or replace function public.staff_role_of()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.role::text
    from public.profiles p
    join public.staff_access s on s.profile_id = p.id and s.staff_role = p.role
   where p.id = (select auth.uid())
     and p.is_active
     and s.access_enabled
     and p.role::text in ('switchboard', 'coordinator', 'administrator', 'hr');
$$;

create or replace function public.owner_set_staff_access(p_profile_id uuid, p_enabled boolean, p_contract_reference text default null, p_note text default null)
returns uuid language plpgsql security definer set search_path to '' as $function$
declare
  v_role text;
begin
  if not public.is_owner() then
    raise exception 'Only the owner can enable or disable staff access' using errcode = '42501';
  end if;
  select p.role::text into v_role from public.profiles p where p.id = p_profile_id;
  if v_role is null then raise exception 'Profile not found'; end if;
  if v_role not in ('switchboard', 'coordinator', 'administrator', 'hr') then
    raise exception 'Profile is not a staff role (assign Switchboard, Sales Coordinator, Administrator or HR first)';
  end if;

  insert into public.staff_access (profile_id, staff_role, access_enabled, contract_reference, activation_note)
  values (p_profile_id, v_role::public.user_role, coalesce(p_enabled, false),
          nullif(btrim(p_contract_reference), ''), nullif(btrim(p_note), ''))
  on conflict (profile_id) do update
    set staff_role         = excluded.staff_role,
        access_enabled     = excluded.access_enabled,
        contract_reference = coalesce(excluded.contract_reference, public.staff_access.contract_reference),
        activation_note    = coalesce(excluded.activation_note, public.staff_access.activation_note);

  perform public.staff_audit_write(
    'staff_access', p_profile_id,
    case when coalesce(p_enabled, false) then 'staff_access_enabled' else 'staff_access_disabled' end,
    p_note,
    jsonb_build_object('staff_role', v_role, 'contract_reference', nullif(btrim(p_contract_reference), '')));
  return p_profile_id;
end;
$function$;

create or replace function public.comms_kind(p_profile uuid)
returns text
language sql stable security definer set search_path = '' as $$
  select case
    when p.role::text = 'owner' then 'staff'
    when p.role::text in ('administrator', 'coordinator', 'switchboard', 'hr')
         and exists (select 1 from public.staff_access s where s.profile_id = p.id and s.staff_role = p.role and s.access_enabled)
      then 'staff'
    when p.role::text = 'lead_referrer' then 'sub_agent'
  end
  from public.profiles p where p.id = p_profile and p.is_active;
$$;

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
     where 'staff' = any (p_audience) and p.is_active and p.role::text in ('administrator', 'coordinator', 'switchboard', 'hr')
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

create or replace function public.msg_contacts()
returns table (profile_id uuid, full_name text, role_label text)
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if public.comms_kind(v_uid) is null then raise exception 'You do not have permission for this action' using errcode = '42501'; end if;
  return query
    select p.id, p.full_name,
           case p.role::text when 'owner' then 'Director' when 'administrator' then 'Administrator'
                when 'coordinator' then 'Sales Coordinator' when 'switchboard' then 'Reception' when 'hr' then 'HR' else 'Sub-agent' end
      from public.profiles p
     where public.comms_can_address(v_uid, p.id)
     order by case p.role::text when 'owner' then 0 when 'administrator' then 1 when 'coordinator' then 2 when 'switchboard' then 3 when 'hr' then 4 else 5 end,
              p.full_name
     limit 500;
end;
$$;

-- 2. Commission flow (owner spec section 4) -------------------------------------------------------------------------
-- The notice itself is Codex's (commission_notice_snapshots: client name, deal reference, the beneficiary's amount;
-- issued by the Director with owner_issue_commission_notice). This layer only ROUTES it and shows where it is:
--
--   Director → Administrator → Sales Coordinator → agent                      (the notice)
--   agent → HR → Administrator → Director                                     (the agent's portal invoice)
--   Director pays through the existing commission payment (Codex) → Administrator → HR → agent   (proof of payment)
--
-- It never calculates, writes or pays commission, never writes an invoice, and never shows the success fee or the
-- funder. It reads the notice, the beneficiary's own portal invoice and whether the Director has recorded the payment.

-- Enabled staff in one role (for notices).
create or replace function public.staff_enabled_in_role(p_role text)
returns setof uuid
language sql stable security definer set search_path = '' as $$
  select p.id from public.profiles p join public.staff_access s on s.profile_id = p.id and s.staff_role = p.role
   where p.role::text = p_role and p.is_active and s.access_enabled;
$$;
revoke all on function public.staff_enabled_in_role(text) from public, anon, authenticated;

create table if not exists public.commission_notice_routes (
  commission_notice_id uuid primary key references public.commission_notice_snapshots(commission_notice_id) on delete restrict,
  status       text not null check (status in ('with_administrator', 'with_coordinator', 'with_agent', 'invoice_with_hr',
                 'invoice_with_administrator', 'invoice_with_director', 'paid_with_administrator', 'paid_with_hr', 'closed')),
  invoice_kind text check (invoice_kind is null or invoice_kind in ('contractor', 'partner')),
  invoice_id   uuid,
  started_by   uuid not null references public.profiles(id) on delete restrict,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint commission_notice_routes_invoice_ck check ((invoice_kind is null) = (invoice_id is null))
);
create table if not exists public.commission_notice_route_events (
  id                   bigint generated always as identity primary key,
  commission_notice_id uuid not null references public.commission_notice_routes(commission_notice_id) on delete restrict,
  at                   timestamptz not null default now(),
  actor_id             uuid not null references public.profiles(id) on delete restrict,
  actor_role           text not null,
  from_status          text,
  to_status            text not null,
  note                 text check (note is null or (length(note) <= 500 and public.staff_text_is_safe(note)))
);
create index if not exists commission_notice_route_events_notice_idx on public.commission_notice_route_events (commission_notice_id, at);
create index if not exists commission_notice_routes_status_idx on public.commission_notice_routes (status, updated_at);
alter table public.commission_notice_routes enable row level security;
alter table public.commission_notice_route_events enable row level security;
revoke all on table public.commission_notice_routes from public, anon, authenticated;
revoke all on table public.commission_notice_route_events from public, anon, authenticated;
create trigger commission_notice_route_events_append_only before update or delete on public.commission_notice_route_events
  for each row execute function public.intake_append_only_guard();

-- Routes change only through commission_route_move (which sets fnc.commission_route).
create or replace function public.commission_notice_route_guard()
returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'Commission routes cannot be deleted'; end if;
  if coalesce(current_setting('fnc.commission_route', true), '') <> 'on' then
    raise exception 'Commission routes change only through the commission flow';
  end if;
  if new.commission_notice_id <> old.commission_notice_id or new.started_by <> old.started_by or new.created_at <> old.created_at then
    raise exception 'A commission route keeps its notice';
  end if;
  return new;
end;
$$;
create trigger commission_notice_routes_guard before update or delete on public.commission_notice_routes
  for each row execute function public.commission_notice_route_guard();

-- Is p_user the beneficiary of the notice (the agent themself, or a partner user of the beneficiary organisation)?
create or replace function public.commission_route_is_beneficiary(p_notice uuid, p_user uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select n.beneficiary_profile_id = p_user
           or (n.beneficiary_organisation_id is not null and exists (
                 select 1 from public.profiles p where p.id = p_user and p.is_active and p.role::text = 'partner'
                    and p.referral_partner_id = n.beneficiary_organisation_id))
      from public.commission_notice_snapshots n where n.commission_notice_id = p_notice), false);
$$;
revoke all on function public.commission_route_is_beneficiary(uuid, uuid) from public, anon, authenticated;

-- Everyone who receives the notice on the beneficiary's side.
create or replace function public.commission_route_beneficiaries(p_notice uuid)
returns setof uuid
language sql stable security definer set search_path = '' as $$
  select p.id from public.commission_notice_snapshots n join public.profiles p on p.is_active
      and (p.id = n.beneficiary_profile_id
           or (n.beneficiary_organisation_id is not null and p.role::text = 'partner' and p.referral_partner_id = n.beneficiary_organisation_id))
   where n.commission_notice_id = p_notice;
$$;
revoke all on function public.commission_route_beneficiaries(uuid) from public, anon, authenticated;

-- The beneficiary's own portal invoice, if it is theirs and has been submitted (or approved).
create or replace function public.commission_route_invoice(p_notice uuid, p_kind text, p_invoice uuid)
returns table (invoice_number text, total_amount numeric, state text, submitted_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select ci.invoice_number, ci.total_amount, ci.state::text, ci.submitted_at
    from public.contractor_invoices ci join public.commission_notice_snapshots n on n.commission_notice_id = p_notice
   where p_kind = 'contractor' and ci.id = p_invoice and ci.contractor_id = n.beneficiary_profile_id
  union all
  select pi.invoice_number, pi.total_amount, pi.state::text, pi.submitted_at
    from public.partner_invoices pi join public.commission_notice_snapshots n on n.commission_notice_id = p_notice
   where p_kind = 'partner' and pi.id = p_invoice
     and pi.referral_partner_id = coalesce(n.beneficiary_organisation_id,
           (select bp.referral_partner_id from public.profiles bp where bp.id = n.beneficiary_profile_id));
$$;
revoke all on function public.commission_route_invoice(uuid, text, uuid) from public, anon, authenticated;

-- Steps a caller may take from a status. 'with_agent' as a target from an invoice step is a send-back.
create or replace function public.commission_route_next(p_notice uuid, p_status text)
returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare v_role text := public.staff_actor_role(); v_uid uuid := (select auth.uid());
begin
  return case p_status
    when 'with_administrator' then case when v_role in ('administrator', 'owner') then array['with_coordinator'] end
    when 'with_coordinator' then case when v_role in ('coordinator', 'administrator', 'owner') then array['with_agent'] end
    when 'with_agent' then case when public.commission_route_is_beneficiary(p_notice, v_uid) then array['invoice_with_hr'] end
    when 'invoice_with_hr' then case when v_role in ('hr', 'owner') then array['invoice_with_administrator', 'with_agent'] end
    when 'invoice_with_administrator' then case when v_role in ('administrator', 'owner') then array['invoice_with_director', 'with_agent'] end
    when 'invoice_with_director' then case when v_role = 'owner' then array['paid_with_administrator', 'with_agent'] end
    when 'paid_with_administrator' then case when v_role in ('administrator', 'owner') then array['paid_with_hr'] end
    when 'paid_with_hr' then case when v_role in ('hr', 'owner') then array['closed'] end
  end;
end;
$$;
revoke all on function public.commission_route_next(uuid, text) from public, anon, authenticated;

-- The Director sends an issued, current notice into the flow (to the Administrator).
create or replace function public.owner_send_commission_notice(p_notice uuid, p_note text default null)
returns text
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); n record; r uuid;
begin
  if not coalesce(public.is_owner(), false) then
    raise exception 'Only the Director sends a commission notice' using errcode = '42501';
  end if;
  if p_note is not null and (length(p_note) > 500 or not public.staff_text_is_safe(p_note)) then
    raise exception 'Keep the note under 500 characters, without ID or account-length numbers';
  end if;
  select s.* into n from public.staff_commission_notice(p_notice) s;
  if n.commission_notice_id is null then raise exception 'Commission notice not found'; end if;
  if not n.is_current then raise exception 'This notice is out of date; issue a new one from the commission editor'; end if;
  insert into public.commission_notice_routes (commission_notice_id, status, started_by)
  values (p_notice, 'with_administrator', v_uid)
  on conflict (commission_notice_id) do nothing;
  if not found then raise exception 'This notice is already in the flow'; end if;
  insert into public.commission_notice_route_events (commission_notice_id, actor_id, actor_role, from_status, to_status, note)
  values (p_notice, v_uid, 'owner', null, 'with_administrator', nullif(btrim(p_note), ''));
  for r in select public.staff_enabled_in_role('administrator') loop
    perform public.staff_notify(r, 'COMMISSION_NOTICE_ROUTED', 'Commission notice: ' || n.client_name,
      'From the Director. Pass it on to the Sales Coordinator.', '/staff/commissions', jsonb_build_object('commission_notice_id', p_notice));
  end loop;
  perform public.staff_audit_write('commission_notice', p_notice, 'commission_route_started', null, '{}'::jsonb);
  return 'with_administrator';
end;
$$;
revoke all on function public.owner_send_commission_notice(uuid, text) from public, anon;
grant execute on function public.owner_send_commission_notice(uuid, text) to authenticated;

create or replace function public.commission_route_move(
  p_notice uuid, p_to text, p_note text default null, p_invoice_kind text default null, p_invoice_id uuid default null)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_role text := coalesce(public.staff_actor_role(), case when public.commission_route_is_beneficiary(p_notice, (select auth.uid())) then 'beneficiary' end);
  r public.commission_notice_routes; n record; v_paid record; v_back boolean; v_title text; v_body text; v_link text; v_to uuid[];
  u uuid;
begin
  if v_role is null then raise exception 'You do not have permission for this action' using errcode = '42501'; end if;
  select * into r from public.commission_notice_routes where commission_notice_id = p_notice for update;
  if r.commission_notice_id is null then raise exception 'Commission notice not found'; end if;
  if not (p_to = any (coalesce(public.commission_route_next(p_notice, r.status), '{}'::text[]))) then
    raise exception 'You cannot move this notice from "%" to "%"', r.status, p_to using errcode = '42501';
  end if;
  v_back := p_to = 'with_agent' and r.status like 'invoice_%';
  if p_note is not null and (length(p_note) > 500 or not public.staff_text_is_safe(p_note)) then
    raise exception 'Keep the note under 500 characters, without ID or account-length numbers';
  end if;
  if v_back and length(btrim(coalesce(p_note, ''))) < 5 then raise exception 'Say why it is going back to the agent'; end if;
  select s.client_name, s.deal_reference, s.commission_amount, s.entry_id into n
    from public.commission_notice_snapshots s where s.commission_notice_id = p_notice;

  if p_to = 'invoice_with_hr' then
    if p_invoice_kind is null or p_invoice_id is null then raise exception 'Choose the invoice you sent from your portal'; end if;
    if not exists (select 1 from public.commission_route_invoice(p_notice, p_invoice_kind, p_invoice_id) i
                    where i.state in ('submitted', 'approved', 'paid')) then
      raise exception 'Choose one of your own invoices that has been submitted';
    end if;
  end if;
  if p_to = 'paid_with_administrator' then
    -- The Director pays through the existing commission payment (with its proof upload); this step only follows it.
    select pm.payment_reference, pm.recorded_at into v_paid from public.owner_commission_payments pm where pm.entry_id = n.entry_id;
    if v_paid.recorded_at is null then
      raise exception 'Record the payment and upload the proof in the commission editor first';
    end if;
  end if;

  perform set_config('fnc.commission_route', 'on', true);
  update public.commission_notice_routes
     set status = p_to, updated_at = now(),
         invoice_kind = case when p_to = 'invoice_with_hr' then p_invoice_kind when v_back then null else invoice_kind end,
         invoice_id   = case when p_to = 'invoice_with_hr' then p_invoice_id when v_back then null else invoice_id end
   where commission_notice_id = p_notice;
  perform set_config('fnc.commission_route', 'off', true);
  insert into public.commission_notice_route_events (commission_notice_id, actor_id, actor_role, from_status, to_status, note)
  values (p_notice, v_uid, v_role, r.status, p_to, nullif(btrim(p_note), ''));

  -- Tell whoever holds it next.
  v_link := '/staff/commissions';
  v_title := 'Commission notice: ' || n.client_name;
  case p_to
    when 'with_coordinator' then v_to := array(select public.staff_enabled_in_role('coordinator')); v_body := 'From the Administrator. Send it to the agent.';
    when 'with_agent' then
      v_to := array(select public.commission_route_beneficiaries(p_notice));
      v_body := case when v_back then 'Sent back: ' || btrim(p_note) else 'Your commission for ' || n.deal_reference || '. Send your invoice from your portal.' end;
      v_link := null;
    when 'invoice_with_hr' then v_to := array(select public.staff_enabled_in_role('hr')); v_body := 'The agent sent their invoice. Check it and pass it to the Administrator.';
    when 'invoice_with_administrator' then v_to := array(select public.staff_enabled_in_role('administrator')); v_body := 'HR checked the invoice. Pass it to the Director.';
    when 'invoice_with_director' then v_to := array(select public.staff_director_ids()); v_body := 'The invoice is ready for approval and payment.';
    when 'paid_with_administrator' then v_to := array(select public.staff_enabled_in_role('administrator')); v_body := 'Paid. Pass the proof of payment to HR.';
    when 'paid_with_hr' then v_to := array(select public.staff_enabled_in_role('hr')); v_body := 'Paid. Send the proof of payment to the agent.';
    when 'closed' then v_to := array(select public.commission_route_beneficiaries(p_notice)); v_body := 'Your commission for ' || n.deal_reference || ' has been paid.'; v_link := null;
  end case;
  foreach u in array coalesce(v_to, '{}'::uuid[]) loop
    if u <> v_uid then
      perform public.staff_notify(u, 'COMMISSION_NOTICE_ROUTED', v_title, v_body,
        coalesce(v_link, public.commission_route_portal_link(u)), jsonb_build_object('commission_notice_id', p_notice, 'status', p_to));
    end if;
  end loop;
  perform public.staff_audit_write('commission_notice', p_notice, 'commission_route_moved', nullif(btrim(p_note), ''),
    jsonb_build_object('from', r.status, 'to', p_to));
  return p_to;
end;
$$;
revoke all on function public.commission_route_move(uuid, text, text, text, uuid) from public, anon;
grant execute on function public.commission_route_move(uuid, text, text, text, uuid) to authenticated;

-- Where a beneficiary opens their commission notices.
create or replace function public.commission_route_portal_link(p_profile uuid)
returns text
language sql stable security definer set search_path = '' as $$
  select case p.role::text when 'partner' then '/partner/commissions' when 'contractor' then '/contractor/commissions'
              else '/staff/commissions' end
    from public.profiles p where p.id = p_profile;
$$;
revoke all on function public.commission_route_portal_link(uuid) from public, anon, authenticated;

-- Staff board: the Director, the Administrator and the Sales Coordinator see every routed notice; HR sees the
-- invoice and payment steps. The Director also sees issued, current notices not yet sent.
create or replace function public.commission_routes_board()
returns table (commission_notice_id uuid, client_name text, deal_reference text, beneficiary_name text, beneficiary_kind text,
               commission_amount numeric, status text, invoice_number text, invoice_total numeric, invoice_state text,
               amounts_match boolean, paid_reference text, paid_at timestamptz, next_steps text[], history jsonb,
               updated_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare v_role text := public.staff_actor_role();
begin
  if v_role is null or v_role not in ('owner', 'administrator', 'coordinator', 'hr') then
    raise exception 'You do not have permission for this action' using errcode = '42501';
  end if;
  return query
    select n.commission_notice_id, n.client_name, n.deal_reference, n.beneficiary_name, n.beneficiary_kind,
           n.commission_amount, r.status, i.invoice_number, i.total_amount, i.state,
           case when i.total_amount is not null then i.total_amount = n.commission_amount end,
           case when r.status in ('paid_with_administrator', 'paid_with_hr', 'closed') then pm.payment_reference end,
           case when r.status in ('paid_with_administrator', 'paid_with_hr', 'closed') then pm.recorded_at end,
           coalesce(public.commission_route_next(n.commission_notice_id, r.status), '{}'::text[]),
           coalesce((select jsonb_agg(jsonb_build_object('at', ev.at, 'who', ap.full_name, 'role', ev.actor_role,
                       'from', ev.from_status, 'to', ev.to_status, 'note', ev.note) order by ev.at)
                       from public.commission_notice_route_events ev left join public.profiles ap on ap.id = ev.actor_id
                      where ev.commission_notice_id = n.commission_notice_id), '[]'::jsonb),
           r.updated_at
      from public.commission_notice_routes r
      join public.commission_notice_snapshots n on n.commission_notice_id = r.commission_notice_id
      left join lateral public.commission_route_invoice(r.commission_notice_id, r.invoice_kind, r.invoice_id) i on true
      left join public.owner_commission_payments pm on pm.entry_id = n.entry_id
     where v_role <> 'hr' or r.status in ('invoice_with_hr', 'invoice_with_administrator', 'invoice_with_director',
                                          'paid_with_administrator', 'paid_with_hr', 'closed')
    union all
    select n.commission_notice_id, n.client_name, n.deal_reference, n.beneficiary_name, n.beneficiary_kind,
           n.commission_amount, 'not_sent', null, null, null, null, null, null, array['with_administrator'], '[]'::jsonb, n.issued_at
      from public.commission_notice_snapshots n
     where v_role = 'owner'
       and not exists (select 1 from public.commission_notice_routes r where r.commission_notice_id = n.commission_notice_id)
       and (select s.is_current from public.staff_commission_notice(n.commission_notice_id) s)
     order by 16 desc
     limit 300;
end;
$$;
revoke all on function public.commission_routes_board() from public, anon;
grant execute on function public.commission_routes_board() to authenticated;

-- The agent's (or partner's) own notices, once the Sales Coordinator has sent them.
create or replace function public.my_commission_notices()
returns table (commission_notice_id uuid, client_name text, deal_reference text, commission_amount numeric, status text,
               invoice_number text, invoice_state text, sent_back_note text, paid_reference text, paid_at timestamptz,
               updated_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'You do not have permission for this action' using errcode = '42501'; end if;
  return query
    select n.commission_notice_id, n.client_name, n.deal_reference, n.commission_amount, r.status,
           i.invoice_number, i.state,
           case when r.status = 'with_agent' then (select ev.note from public.commission_notice_route_events ev
              where ev.commission_notice_id = r.commission_notice_id and ev.to_status = 'with_agent' and ev.from_status like 'invoice_%'
              order by ev.at desc limit 1) end,
           case when r.status = 'closed' then pm.payment_reference end,
           case when r.status = 'closed' then pm.recorded_at end,
           r.updated_at
      from public.commission_notice_routes r
      join public.commission_notice_snapshots n on n.commission_notice_id = r.commission_notice_id
      left join lateral public.commission_route_invoice(r.commission_notice_id, r.invoice_kind, r.invoice_id) i on true
      left join public.owner_commission_payments pm on pm.entry_id = n.entry_id
     where r.status not in ('with_administrator', 'with_coordinator')
       and public.commission_route_is_beneficiary(r.commission_notice_id, v_uid)
     order by r.updated_at desc
     limit 200;
end;
$$;
revoke all on function public.my_commission_notices() from public, anon;
grant execute on function public.my_commission_notices() to authenticated;

-- The beneficiary's submitted portal invoices they can attach to a notice.
create or replace function public.my_commission_invoice_options(p_notice uuid)
returns table (invoice_kind text, invoice_id uuid, invoice_number text, total_amount numeric, state text)
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); n record;
begin
  if not public.commission_route_is_beneficiary(p_notice, v_uid) then raise exception 'Commission notice not found'; end if;
  select s.beneficiary_profile_id, s.beneficiary_organisation_id into n
    from public.commission_notice_snapshots s where s.commission_notice_id = p_notice;
  return query
    select 'contractor', ci.id, ci.invoice_number, ci.total_amount, ci.state::text
      from public.contractor_invoices ci
     where ci.contractor_id = n.beneficiary_profile_id and ci.state::text in ('submitted', 'approved', 'paid')
    union all
    select 'partner', pi.id, pi.invoice_number, pi.total_amount, pi.state::text
      from public.partner_invoices pi
     where pi.state::text in ('submitted', 'approved', 'paid')
       and pi.referral_partner_id = coalesce(n.beneficiary_organisation_id,
             (select bp.referral_partner_id from public.profiles bp where bp.id = n.beneficiary_profile_id))
     order by 3 desc
     limit 50;
end;
$$;
revoke all on function public.my_commission_invoice_options(uuid) from public, anon;
grant execute on function public.my_commission_invoice_options(uuid) to authenticated;
