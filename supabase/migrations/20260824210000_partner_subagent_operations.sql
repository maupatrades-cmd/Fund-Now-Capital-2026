-- Partner / sub-agent operational directory.
--
-- Reuses the canonical Path-B relationship in partner_lead_referrers. This
-- deliberately does not create another role or membership table. The RPC is a
-- narrow, read-only projection: owners see every relationship; an active
-- partner sees only memberships belonging to its own referral_partner_id.

create index if not exists lead_attribution_events_referrer_partner_occurred_idx
  on public.lead_attribution_events
    (lead_referrer_profile_id, referral_partner_id, occurred_at desc)
  where lead_referrer_profile_id is not null;

create or replace function public.list_partner_subagent_operations()
returns table (
  membership_id uuid,
  lead_referrer_profile_id uuid,
  lead_referrer_name text,
  referral_partner_id uuid,
  referral_partner_name text,
  membership_status text,
  profile_is_active boolean,
  joined_at timestamptz,
  membership_updated_at timestamptz,
  captured_lead_count bigint,
  deal_count bigint,
  last_activity_type text,
  last_activity_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with actor as (
    select p.role::text as role, p.referral_partner_id
      from public.profiles p
     where p.id = auth.uid()
       and p.is_active
  )
  select
    membership.id,
    membership.profile_id,
    membership.display_name,
    membership.referral_partner_id,
    partner.name,
    membership.status,
    profile.is_active,
    membership.created_at,
    membership.updated_at,
    coalesce(lead_stats.lead_count, 0),
    coalesce(lead_stats.deal_count, 0),
    latest_activity.event_type,
    latest_activity.occurred_at
  from public.partner_lead_referrers membership
  join public.profiles profile
    on profile.id = membership.profile_id
   and profile.role::text = 'lead_referrer'
  join public.referral_partners partner
    on partner.id = membership.referral_partner_id
  cross join actor
  left join lateral (
    select
      count(distinct lead.id)::bigint as lead_count,
      count(distinct deal.id)::bigint as deal_count
    from public.leads lead
    left join public.deals deal on deal.lead_id = lead.id
    where lead.attributed_to_lead_referrer_id = membership.profile_id
      and lead.referral_partner_id = membership.referral_partner_id
  ) lead_stats on true
  left join lateral (
    select event.event_type, event.occurred_at
      from public.lead_attribution_events event
     where event.lead_referrer_profile_id = membership.profile_id
       and event.referral_partner_id = membership.referral_partner_id
     order by event.occurred_at desc
     limit 1
  ) latest_activity on true
  where actor.role = 'owner'
     or (
       actor.role = 'partner'
       and actor.referral_partner_id = membership.referral_partner_id
     )
  order by partner.name, membership.display_name;
$$;

comment on function public.list_partner_subagent_operations() is
  'Read-only Path-B operational directory. Active owners see all partner/sub-agent relationships; active partners see only their own. Excludes email, phone, client PII, banking, agreements and lead-referrer compensation.';

revoke all on function public.list_partner_subagent_operations() from public, anon;
grant execute on function public.list_partner_subagent_operations() to authenticated;

do $$
declare
  v_definition text;
begin
  select lower(pg_get_functiondef('public.list_partner_subagent_operations()'::regprocedure))
    into v_definition;

  if has_function_privilege('anon', 'public.list_partner_subagent_operations()', 'EXECUTE') then
    raise exception 'partner operations RPC must not be executable by anon';
  end if;
  if v_definition not like '%actor.role = ''owner''%'
     or v_definition not like '%actor.role = ''partner''%'
     or v_definition not like '%actor.referral_partner_id = membership.referral_partner_id%' then
    raise exception 'partner operations RPC is missing its owner/partner isolation gate';
  end if;
  if v_definition like '%profile.email%'
     or v_definition like '%phone_number%'
     or v_definition like '%bank%'
     or v_definition like '%lead_referrer_commission%'
     or v_definition like '%contact_email%'
     or v_definition like '%contact_cell%' then
    raise exception 'partner operations RPC exposes a forbidden field';
  end if;
end;
$$;

notify pgrst, 'reload schema';
