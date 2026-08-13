-- Fix PL/pgSQL ambiguity between the function output column named client_id
-- and the client_quick_invitations.client_id conflict target.
do $hotfix$
declare
  v_definition text;
begin
  select pg_get_functiondef(
    'public.service_create_quick_client_invitation(uuid,text,text,text,text)'::regprocedure
  ) into v_definition;

  if position('on conflict (client_id, invited_by)' in lower(v_definition)) = 0 then
    if position(
      'on conflict on constraint client_quick_invitations_actor_unique'
      in lower(v_definition)
    ) > 0 then
      return;
    end if;
    raise exception 'Expected quick invitation conflict target was not found';
  end if;

  v_definition := regexp_replace(
    v_definition,
    'ON CONFLICT \(client_id, invited_by\)',
    'ON CONFLICT ON CONSTRAINT client_quick_invitations_actor_unique',
    'i'
  );
  execute v_definition;
end;
$hotfix$;

do $verify$
begin
  if position(
    'on conflict on constraint client_quick_invitations_actor_unique'
    in lower(pg_get_functiondef(
      'public.service_create_quick_client_invitation(uuid,text,text,text,text)'::regprocedure
    ))
  ) = 0 then
    raise exception 'Quick invitation conflict-target hotfix was not installed';
  end if;
end;
$verify$;
