-- PR10: exactly-once R100 reward after owner acceptance and funder submission.
create table public.complete_document_reward_locks(
 id uuid primary key default gen_random_uuid(),deal_id uuid not null references public.deals(id) on delete restrict,
 lead_id uuid references public.leads(id) on delete restrict,beneficiary_profile_id uuid not null references public.profiles(id) on delete restrict,
 beneficiary_role text not null check(beneficiary_role in('partner','contractor','lead_referrer')),
 amount numeric(14,2) not null default 100.00 check(amount=100.00),status text not null default 'locked' check(status='locked'),
 eligibility_snapshot jsonb not null check(jsonb_typeof(eligibility_snapshot)='object'),locked_by uuid not null references public.profiles(id) on delete restrict,
 locked_at timestamptz not null default now(),cutoff_date date not null,pay_window_open_on date not null,pay_window_close_on date not null,
 unique(deal_id),check(cutoff_date<pay_window_open_on and pay_window_open_on<=pay_window_close_on));
create index complete_document_reward_beneficiary_idx on public.complete_document_reward_locks(beneficiary_profile_id,locked_at desc);
create index complete_document_reward_pay_window_idx on public.complete_document_reward_locks(pay_window_open_on,pay_window_close_on);
alter table public.complete_document_reward_locks enable row level security;
revoke all on table public.complete_document_reward_locks from public,anon,authenticated;grant select on table public.complete_document_reward_locks to authenticated;
create policy complete_document_reward_owner_read on public.complete_document_reward_locks for select to authenticated using(public.is_owner());
create policy complete_document_reward_beneficiary_read on public.complete_document_reward_locks for select to authenticated using(beneficiary_profile_id=(select auth.uid()));
create function public.complete_document_reward_locks_immutable() returns trigger language plpgsql set search_path='' as $$begin raise exception 'Locked R100 reward evidence is immutable';end;$$;
create trigger complete_document_reward_locks_immutable before update or delete on public.complete_document_reward_locks for each row execute function public.complete_document_reward_locks_immutable();
create function public.owner_lock_complete_document_reward(p_deal_id uuid,p_beneficiary_profile_id uuid,p_beneficiary_role text)
returns public.complete_document_reward_locks language plpgsql security definer set search_path='' as $$
declare v_deal public.deals;v_lead public.leads;v_profile public.profiles;v_lock public.complete_document_reward_locks;v_date date:=(now() at time zone 'Africa/Johannesburg')::date;v_cycle date;v_docs int;
begin
 if not public.is_owner() then raise exception 'Only the owner can lock the R100 reward' using errcode='42501';end if;
 if p_beneficiary_role not in('partner','contractor','lead_referrer') then raise exception 'Unsupported beneficiary role';end if;
 perform pg_advisory_xact_lock(hashtext('complete_document_reward:'||p_deal_id::text));
 select * into v_lock from public.complete_document_reward_locks where deal_id=p_deal_id;if v_lock.id is not null then return v_lock;end if;
 select * into v_deal from public.deals where id=p_deal_id;if v_deal.id is null then raise exception 'Deal not found';end if;
 if v_deal.stage<'submitted'::public.deal_stage or v_deal.stage='declined'::public.deal_stage then raise exception 'Deal must be submitted to a funder first';end if;
 if not exists(select 1 from public.deal_package_dispatches where deal_id=p_deal_id) then raise exception 'No recorded funder package dispatch';end if;
 select count(*) into v_docs from public.documents where deal_id=p_deal_id and is_current and status='active' and verification_status='accepted';
 if v_docs=0 then raise exception 'No current owner-accepted documents';end if;
 if exists(select 1 from public.documents where deal_id=p_deal_id and is_current and status='active' and verification_status<>'accepted') then raise exception 'Every current active deal document must be accepted';end if;
 if v_deal.is_purchase_order and not exists(select 1 from public.documents where deal_id=p_deal_id and is_current and status='active' and verification_status='accepted' and document_type='purchase_order') then raise exception 'Accepted purchase order required';end if;
 select * into v_lead from public.leads where id=v_deal.lead_id;select * into v_profile from public.profiles where id=p_beneficiary_profile_id and is_active;
 if v_profile.id is null then raise exception 'Active beneficiary not found';end if;
 if p_beneficiary_role='contractor' and (v_profile.role::text<>'contractor' or v_lead.attributed_to_contractor_id is distinct from v_profile.id) then raise exception 'Contractor attribution mismatch';end if;
 if p_beneficiary_role in('partner','lead_referrer') and (v_profile.role::text<>'partner' or v_lead.attributed_to_partner_id is distinct from v_profile.id) then raise exception 'Partner/referrer attribution mismatch';end if;
 v_cycle:=case when extract(day from v_date)<=22 then date_trunc('month',v_date)::date else(date_trunc('month',v_date)+interval '1 month')::date end;
 insert into public.complete_document_reward_locks(deal_id,lead_id,beneficiary_profile_id,beneficiary_role,eligibility_snapshot,locked_by,cutoff_date,pay_window_open_on,pay_window_close_on)
 values(v_deal.id,v_deal.lead_id,v_profile.id,p_beneficiary_role,jsonb_build_object('deal_stage',v_deal.stage,'accepted_current_documents',v_docs,'funder_dispatch_recorded',true,'purchase_order',v_deal.is_purchase_order),(select auth.uid()),(v_cycle+interval '21 days')::date,(v_cycle+interval '24 days')::date,least((v_cycle+interval '29 days')::date,(v_cycle+interval '1 month - 1 day')::date) returning * into v_lock;
 insert into public.activity_logs(timestamp,user_id,user_email,user_role,event_type,entity_type,entity_id,description,related_entity_ids)
 select now(),p.id,p.email,p.role::text,'CREATE','complete_document_reward_lock',v_lock.id,'Exactly R100 complete-document reward locked',array_remove(array[v_deal.id,v_deal.client_id],null) from public.profiles p where p.id=(select auth.uid());return v_lock;
end;$$;
revoke all on function public.complete_document_reward_locks_immutable() from public,anon,authenticated;
revoke all on function public.owner_lock_complete_document_reward(uuid,uuid,text) from public,anon;grant execute on function public.owner_lock_complete_document_reward(uuid,uuid,text) to authenticated;
do $$begin if not(select relrowsecurity from pg_class where oid='public.complete_document_reward_locks'::regclass)then raise exception 'PR10 RLS missing';end if;if has_table_privilege('authenticated','public.complete_document_reward_locks','INSERT')then raise exception 'PR10 direct insert allowed';end if;if has_function_privilege('anon','public.owner_lock_complete_document_reward(uuid,uuid,text)','EXECUTE')then raise exception 'PR10 anon RPC access';end if;end$$;
notify pgrst,'reload schema';