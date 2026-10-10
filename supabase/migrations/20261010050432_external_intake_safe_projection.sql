-- External relationships grant access to safe status fields, not internal rows.
drop policy if exists submission_intakes_relationship_select on public.submission_intakes;

create or replace function public.my_submission_intakes(
  p_after_lead_id uuid default null, p_limit integer default 50
)
returns table(lead_id uuid, funding_type text, workflow_status text,
              registered_at timestamptz, first_complete_at timestamptz, archived boolean)
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_role text;
begin
  if v_uid is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select p.role::text into v_role from public.profiles p where p.id=v_uid and p.is_active;
  if v_role is null or v_role not in ('owner','partner','contractor','lead_referrer') then return; end if;
  return query
    select si.lead_id, si.funding_type, si.workflow_status::text, si.registered_at,
           si.first_complete_at, si.archived_at is not null
      from public.submission_intakes si
     where (p_after_lead_id is null or si.lead_id > p_after_lead_id)
       and (v_role='owner' or si.agent_profile_id=v_uid
         or (si.team_id is not null and si.team_id in (select public.my_team_ids(true)))
         or (v_role='partner' and si.organisation_id=public.my_organisation_id()))
     order by si.lead_id
     limit greatest(1,least(coalesce(p_limit,50),100));
end;
$$;
revoke all on function public.my_submission_intakes(uuid,integer) from public,anon;
grant execute on function public.my_submission_intakes(uuid,integer) to authenticated;
notify pgrst, 'reload schema';
