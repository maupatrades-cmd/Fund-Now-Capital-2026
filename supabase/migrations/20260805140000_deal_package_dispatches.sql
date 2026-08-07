create table public.deal_package_dispatches(
 id uuid primary key default gen_random_uuid(), deal_id uuid not null references public.deals(id) on delete restrict,
 funder_id uuid not null references public.funders(id) on delete restrict,
 delivery_method text not null check(delivery_method in('email','portal','hand_delivery','other')),
 recipient text, notes text, sent_at timestamptz not null default now(),
 sent_by uuid not null default auth.uid() references public.profiles(id), created_at timestamptz not null default now()
);
create index deal_package_dispatches_deal_idx on public.deal_package_dispatches(deal_id,sent_at desc);
create index deal_package_dispatches_funder_idx on public.deal_package_dispatches(funder_id);
alter table public.deal_package_dispatches enable row level security;
create policy deal_package_dispatches_owner_select on public.deal_package_dispatches for select to authenticated using((select public.is_owner()));
revoke all on table public.deal_package_dispatches from public,anon,authenticated;
grant select on table public.deal_package_dispatches to authenticated;
grant all on table public.deal_package_dispatches to service_role;

create function public.owner_record_deal_package_dispatch(
 p_deal_id uuid,p_funder_id uuid,p_delivery_method text,p_recipient text default null,p_notes text default null
) returns public.deal_package_dispatches language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=auth.uid(); v_row public.deal_package_dispatches;
begin
 if not public.is_owner() then raise exception 'Only the owner can record package dispatches' using errcode='42501'; end if;
 if p_delivery_method not in('email','portal','hand_delivery','other') then raise exception 'Invalid delivery method'; end if;
 insert into public.deal_package_dispatches(deal_id,funder_id,delivery_method,recipient,notes,sent_at,sent_by)
 values(p_deal_id,p_funder_id,p_delivery_method,nullif(btrim(p_recipient),''),nullif(btrim(p_notes),''),now(),v_uid)
 returning * into v_row;
 return v_row;
end $$;

create function public.log_deal_package_dispatch()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_email text; v_role text;
begin
 select email,role::text into v_email,v_role from public.profiles where id=auth.uid();
 insert into public.activity_logs(
   occurred_at,user_id,user_email,user_role,event_type,entity_type,entity_id,
   description,after_values,related_entity_ids
 ) values(
   now(),auth.uid(),v_email,v_role,'CREATE','deal_package_dispatch',new.id,
   'Funding package dispatch recorded',to_jsonb(new),jsonb_build_array(new.deal_id)
 );
 return null;
end $$;

create trigger log_activity_deal_package_dispatches after insert on public.deal_package_dispatches for each row execute function public.log_deal_package_dispatch();
revoke all on function public.owner_record_deal_package_dispatch(uuid,uuid,text,text,text) from public,anon;
revoke all on function public.log_deal_package_dispatch() from public,anon,authenticated;
grant execute on function public.owner_record_deal_package_dispatch(uuid,uuid,text,text,text) to authenticated,service_role;
do $$ begin
 if has_table_privilege('authenticated','public.deal_package_dispatches','INSERT') then raise exception 'assert: direct dispatch inserts must be blocked'; end if;
 if has_function_privilege('anon','public.owner_record_deal_package_dispatch(uuid,uuid,text,text,text)','EXECUTE') then raise exception 'assert: anon dispatch RPC access'; end if;
end $$;
notify pgrst,'reload schema';
