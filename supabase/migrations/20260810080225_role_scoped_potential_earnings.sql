-- PR11: role-scoped potential earnings snapshots. Rates and amounts are inputs from
-- canonical owner-approved engines; this migration invents no rate or split.
create table public.potential_earning_snapshots(
 id uuid primary key default gen_random_uuid(),deal_id uuid not null references public.deals(id) on delete restrict,
 beneficiary_profile_id uuid not null references public.profiles(id) on delete restrict,
 beneficiary_role text not null check(beneficiary_role in('owner','partner','contractor','lead_referrer')),
 earning_kind text not null check(earning_kind in('r100_reward','commission')),
 earning_state text not null check(earning_state in('estimated','r100_locked','commission_locked','approved','paid')),
 amount numeric(14,2) not null check(amount>=0),currency text not null default 'ZAR' check(currency='ZAR'),
 source_snapshot jsonb not null check(jsonb_typeof(source_snapshot)='object'),idempotency_key text not null,
 calculated_by uuid not null references public.profiles(id) on delete restrict,calculated_at timestamptz not null default now(),
 unique(idempotency_key),check((earning_kind='r100_reward' and earning_state<>'commission_locked')or earning_kind='commission'));
create table public.owner_earnings_waterfall_snapshots(
 id uuid primary key default gen_random_uuid(),deal_id uuid not null references public.deals(id) on delete restrict,
 potential_earning_snapshot_id uuid references public.potential_earning_snapshots(id) on delete restrict,
 gross_amount numeric(14,2) check(gross_amount is null or gross_amount>=0),fnc_retention numeric(14,2) check(fnc_retention is null or fnc_retention>=0),
 owner_amount numeric(14,2) check(owner_amount is null or owner_amount>=0),downstream_amount numeric(14,2) check(downstream_amount is null or downstream_amount>=0),
 inputs_snapshot jsonb not null check(jsonb_typeof(inputs_snapshot)='object'),recorded_by uuid not null references public.profiles(id) on delete restrict,recorded_at timestamptz not null default now());
create index potential_earning_beneficiary_idx on public.potential_earning_snapshots(beneficiary_profile_id,calculated_at desc);
create index potential_earning_deal_idx on public.potential_earning_snapshots(deal_id,calculated_at desc);
create index owner_earnings_waterfall_deal_idx on public.owner_earnings_waterfall_snapshots(deal_id,recorded_at desc);
alter table public.potential_earning_snapshots enable row level security;alter table public.owner_earnings_waterfall_snapshots enable row level security;
revoke all on table public.potential_earning_snapshots,public.owner_earnings_waterfall_snapshots from public,anon,authenticated;
grant select on table public.potential_earning_snapshots,public.owner_earnings_waterfall_snapshots to authenticated;
create policy potential_earning_owner_read on public.potential_earning_snapshots for select to authenticated using(public.is_owner());
create policy potential_earning_own_read on public.potential_earning_snapshots for select to authenticated using(beneficiary_profile_id=(select auth.uid()));
create policy owner_earnings_waterfall_owner_read on public.owner_earnings_waterfall_snapshots for select to authenticated using(public.is_owner());
create function public.owner_record_potential_earning(p_deal_id uuid,p_beneficiary_profile_id uuid,p_beneficiary_role text,p_earning_kind text,p_earning_state text,p_amount numeric,p_source_snapshot jsonb,p_idempotency_key text)
returns public.potential_earning_snapshots language plpgsql security definer set search_path='' as $$declare v public.potential_earning_snapshots;v_profile public.profiles;begin
 if not public.is_owner() then raise exception 'Only the owner can record earnings calculations' using errcode='42501';end if;
 select * into v_profile from public.profiles where id=p_beneficiary_profile_id and is_active;if v_profile.id is null then raise exception 'Active beneficiary not found';end if;
 if p_beneficiary_role='owner' and v_profile.role::text<>'owner' then raise exception 'Owner beneficiary mismatch';end if;
 if p_beneficiary_role='contractor' and v_profile.role::text<>'contractor' then raise exception 'Contractor beneficiary mismatch';end if;
 if p_beneficiary_role in('partner','lead_referrer') and v_profile.role::text<>'partner' then raise exception 'Partner/referrer beneficiary mismatch';end if;
 if jsonb_typeof(p_source_snapshot)<>'object' or btrim(p_idempotency_key)='' then raise exception 'Source snapshot and idempotency key required';end if;
 insert into public.potential_earning_snapshots(deal_id,beneficiary_profile_id,beneficiary_role,earning_kind,earning_state,amount,source_snapshot,idempotency_key,calculated_by)
 values(p_deal_id,p_beneficiary_profile_id,p_beneficiary_role,p_earning_kind,p_earning_state,round(p_amount,2),p_source_snapshot,btrim(p_idempotency_key),(select auth.uid()))
 on conflict(idempotency_key)do nothing returning * into v;
 if v.id is null then select * into v from public.potential_earning_snapshots where idempotency_key=btrim(p_idempotency_key);end if;
 insert into public.activity_logs(timestamp,user_id,user_email,user_role,event_type,entity_type,entity_id,description,related_entity_ids)
 select now(),p.id,p.email,p.role::text,'CREATE','potential_earning_snapshot',v.id,'Potential earning snapshot recorded',array[p_deal_id] from public.profiles p where p.id=(select auth.uid());
 return v;end;$$;
create function public.owner_record_earnings_waterfall(p_deal_id uuid,p_snapshot_id uuid,p_gross numeric,p_fnc_retention numeric,p_owner_amount numeric,p_downstream numeric,p_inputs jsonb)
returns public.owner_earnings_waterfall_snapshots language plpgsql security definer set search_path='' as $$declare v public.owner_earnings_waterfall_snapshots;begin
 if not public.is_owner()then raise exception 'Only the owner can record a waterfall' using errcode='42501';end if;
 if jsonb_typeof(p_inputs)<>'object' then raise exception 'Inputs snapshot must be an object';end if;
 if p_gross is not null and coalesce(p_fnc_retention,0)+coalesce(p_owner_amount,0)+coalesce(p_downstream,0)<>p_gross then raise exception 'Waterfall components must equal gross';end if;
 insert into public.owner_earnings_waterfall_snapshots(deal_id,potential_earning_snapshot_id,gross_amount,fnc_retention,owner_amount,downstream_amount,inputs_snapshot,recorded_by)
 values(p_deal_id,p_snapshot_id,p_gross,p_fnc_retention,p_owner_amount,p_downstream,p_inputs,(select auth.uid()))returning * into v;
 insert into public.activity_logs(timestamp,user_id,user_email,user_role,event_type,entity_type,entity_id,description,related_entity_ids)
 select now(),p.id,p.email,p.role::text,'CREATE','owner_earnings_waterfall_snapshot',v.id,'Owner earnings waterfall snapshot recorded',array[p_deal_id] from public.profiles p where p.id=(select auth.uid());
 return v;end;$$;
create function public.potential_earnings_dashboard()
returns table(snapshot_id uuid,deal_id uuid,beneficiary_profile_id uuid,beneficiary_role text,earning_kind text,earning_state text,amount numeric,currency text,calculated_at timestamptz)
language sql security invoker set search_path='' stable as $$select e.id,e.deal_id,e.beneficiary_profile_id,e.beneficiary_role,e.earning_kind,e.earning_state,e.amount,e.currency,e.calculated_at from public.potential_earning_snapshots e where public.is_owner() or e.beneficiary_profile_id=(select auth.uid()) order by e.calculated_at desc$$;
revoke all on function public.owner_record_potential_earning(uuid,uuid,text,text,text,numeric,jsonb,text),public.owner_record_earnings_waterfall(uuid,uuid,numeric,numeric,numeric,numeric,jsonb) from public,anon;
grant execute on function public.owner_record_potential_earning(uuid,uuid,text,text,text,numeric,jsonb,text),public.owner_record_earnings_waterfall(uuid,uuid,numeric,numeric,numeric,numeric,jsonb) to authenticated;
revoke all on function public.potential_earnings_dashboard() from public,anon;grant execute on function public.potential_earnings_dashboard() to authenticated;
do $$begin if has_table_privilege('authenticated','public.potential_earning_snapshots','INSERT')then raise exception 'PR11 direct earning insert';end if;if exists(select 1 from pg_policies where schemaname='public' and tablename='owner_earnings_waterfall_snapshots' and policyname<>'owner_earnings_waterfall_owner_read')then raise exception 'PR11 waterfall exposed';end if;if has_function_privilege('anon','public.potential_earnings_dashboard()','EXECUTE')then raise exception 'PR11 anon dashboard';end if;end$$;
notify pgrst,'reload schema';