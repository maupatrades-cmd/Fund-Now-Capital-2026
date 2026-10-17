-- Owner-approved allocation notices; Claude owns routing against commission_notice_id.
-- No automatic-ledger bridge, payment authority or direct staff ledger access.
create table public.commission_notice_snapshots (
  commission_notice_id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.owner_commission_entries(id) on delete restrict,
  deal_id uuid not null references public.deals(id) on delete restrict,
  source_adjustment_id bigint not null,
  client_name text not null,
  deal_reference text not null,
  beneficiary_kind text not null check (beneficiary_kind in ('agent','team_leader','organisation')),
  beneficiary_profile_id uuid,
  beneficiary_organisation_id uuid,
  beneficiary_name text not null,
  commission_amount numeric(14,2) not null check (commission_amount >= 0 and commission_amount <> 'NaN'::numeric),
  currency text not null check (currency = 'ZAR'),
  issued_by uuid not null references public.profiles(id) on delete restrict,
  issued_at timestamptz not null default now(),
  unique(entry_id, source_adjustment_id)
);
create index commission_notice_snapshots_deal_idx on public.commission_notice_snapshots(deal_id, issued_at, commission_notice_id);
alter table public.commission_notice_snapshots enable row level security;
revoke all on public.commission_notice_snapshots from public, anon, authenticated;

create function public.commission_notice_block_rewrite() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'Commission notice snapshots are immutable; issue a new notice after an approved correction';
end;
$$;
create trigger commission_notice_snapshots_immutable before update or delete or truncate
on public.commission_notice_snapshots for each statement execute function public.commission_notice_block_rewrite();
revoke all on function public.commission_notice_block_rewrite() from public, anon, authenticated;

-- Deliberately do not rely on staff_role_of(): older deployed versions do not
-- recognise Administrator. NULL/missing/disabled/mismatching access fails closed.
create function public.commission_notice_can_read() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.is_active is true and (
      p.role::text = 'owner' or (
        p.role::text in ('coordinator','administrator') and exists (
          select 1 from public.staff_access s where s.profile_id = p.id
          and s.staff_role = p.role and s.access_enabled is true
        )
      )
    )
  );
$$;
revoke all on function public.commission_notice_can_read() from public, anon, authenticated;

create function public.owner_issue_commission_notice(p_entry_id uuid, p_expected_amount numeric)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_entry public.owner_commission_entries;
  v_amount numeric(14,2);
  v_adjustment bigint;
  v_reconciliation jsonb;
  v_notice uuid;
begin
  if not exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role::text = 'owner' and p.is_active is true) then
    raise exception 'Only an active Owner may issue a commission notice' using errcode = '42501';
  end if;
  select * into v_entry from public.owner_commission_entries where id = p_entry_id;
  if not found then raise exception 'Commission allocation not found'; end if;
  perform pg_advisory_xact_lock(hashtextextended('owner_commission:' || v_entry.deal_id::text, 0));
  select * into v_entry from public.owner_commission_entries where id = p_entry_id for update;
  if v_entry.status <> 'approved' or v_entry.currency <> 'ZAR'
     or v_entry.beneficiary_kind not in ('agent','team_leader','organisation') then
    raise exception 'A notice requires an approved ZAR agent, Team Leader or partner allocation';
  end if;
  v_amount := public.owner_commission_effective(v_entry.id);
  if p_expected_amount is null or p_expected_amount::text in ('NaN','Infinity','-Infinity')
     or p_expected_amount < 0 or p_expected_amount <> round(p_expected_amount,2)
     or p_expected_amount <> v_amount then
    raise exception 'Commission amount changed; review the current allocation before issuing';
  end if;
  v_reconciliation := public.owner_commission_reconciliation(v_entry.deal_id);
  if (v_reconciliation->>'reconciled')::boolean is not true
     or coalesce((v_reconciliation->>'open_flags')::integer,1) <> 0
     or exists (select 1 from public.owner_commission_entries e where e.deal_id = v_entry.deal_id and e.status = 'draft') then
    raise exception 'Reconcile and approve all allocations and resolve flags before issuing';
  end if;
  select coalesce(max(a.id),0) into v_adjustment from public.owner_commission_adjustments a where a.entry_id = v_entry.id;
  select n.commission_notice_id into v_notice from public.commission_notice_snapshots n
    where n.entry_id = v_entry.id and n.source_adjustment_id = v_adjustment;
  if found then return v_notice; end if;
  insert into public.commission_notice_snapshots(entry_id,deal_id,source_adjustment_id,client_name,deal_reference,
    beneficiary_kind,beneficiary_profile_id,beneficiary_organisation_id,beneficiary_name,commission_amount,currency,issued_by)
  select v_entry.id,v_entry.deal_id,v_adjustment,c.business_name,coalesce(nullif(btrim(d.reference),''),d.id::text),
    v_entry.beneficiary_kind,v_entry.beneficiary_profile_id,v_entry.beneficiary_organisation_id,
    coalesce(nullif(btrim(p.full_name),''),nullif(btrim(r.name),''),'Beneficiary'),v_amount,'ZAR',(select auth.uid())
  from public.deals d join public.clients c on c.id = d.client_id
    left join public.profiles p on p.id = v_entry.beneficiary_profile_id
    left join public.referral_partners r on r.id = v_entry.beneficiary_organisation_id
  where d.id = v_entry.deal_id returning commission_notice_id into v_notice;
  if v_notice is null then raise exception 'The allocation needs a client and deal reference'; end if;
  perform public.staff_audit_write('commission_notice',v_notice,'commission_notice_issued',null,
    jsonb_build_object('entry_id',v_entry.id,'deal_id',v_entry.deal_id));
  return v_notice;
end;
$$;

create function public.staff_commission_notices_for_deal(p_deal_id uuid)
returns table(commission_notice_id uuid,client_name text,deal_reference text,beneficiary_kind text,
  beneficiary_profile_id uuid,beneficiary_organisation_id uuid,beneficiary_name text,
  commission_amount numeric(14,2),currency text,issued_at timestamptz,is_current boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if public.commission_notice_can_read() is not true then
    raise exception 'Active Owner, Coordinator or Administrator access required' using errcode = '42501';
  end if;
  return query select n.commission_notice_id,n.client_name,n.deal_reference,n.beneficiary_kind,
    n.beneficiary_profile_id,n.beneficiary_organisation_id,n.beneficiary_name,n.commission_amount,n.currency,n.issued_at,
    (e.status in ('approved','paid') and e.currency = 'ZAR'
      and n.source_adjustment_id = coalesce((select max(a.id) from public.owner_commission_adjustments a where a.entry_id = e.id),0)
      and n.commission_amount = public.owner_commission_effective(e.id)
      and not exists (select 1 from public.owner_commission_entries de where de.deal_id = e.deal_id and de.status = 'draft')
      and exists (select 1 from public.owner_commission_deal_totals t where t.deal_id = e.deal_id and t.currency = 'ZAR'
        and t.total_amount = (select sum(public.owner_commission_effective(se.id)) from public.owner_commission_entries se
          where se.deal_id = e.deal_id and se.status <> 'void')
        and not exists (select 1 from public.owner_commission_entries ce where ce.deal_id = e.deal_id and ce.status <> 'void' and ce.currency <> 'ZAR'))
      and not exists (select 1 from public.owner_commission_flags f join public.owner_commission_entries fe on fe.id = f.entry_id
        where fe.deal_id = e.deal_id and f.status = 'open'))
  from public.commission_notice_snapshots n join public.owner_commission_entries e on e.id = n.entry_id
  where n.deal_id = p_deal_id order by n.issued_at,n.commission_notice_id;
end;
$$;

create function public.staff_commission_notice(p_commission_notice_id uuid)
returns table(commission_notice_id uuid,client_name text,deal_reference text,beneficiary_kind text,
  beneficiary_profile_id uuid,beneficiary_organisation_id uuid,beneficiary_name text,
  commission_amount numeric(14,2),currency text,issued_at timestamptz,is_current boolean)
language plpgsql stable security definer set search_path = '' as $$
declare v_deal uuid;
begin
  if public.commission_notice_can_read() is not true then
    raise exception 'Active Owner, Coordinator or Administrator access required' using errcode = '42501';
  end if;
  select n.deal_id into v_deal from public.commission_notice_snapshots n where n.commission_notice_id = p_commission_notice_id;
  return query select s.* from public.staff_commission_notices_for_deal(v_deal) s where s.commission_notice_id = p_commission_notice_id;
end;
$$;
revoke all on function public.owner_issue_commission_notice(uuid,numeric) from public,anon,authenticated;
revoke all on function public.staff_commission_notices_for_deal(uuid) from public,anon,authenticated;
revoke all on function public.staff_commission_notice(uuid) from public,anon,authenticated;
grant execute on function public.owner_issue_commission_notice(uuid,numeric) to authenticated;
grant execute on function public.staff_commission_notices_for_deal(uuid) to authenticated;
grant execute on function public.staff_commission_notice(uuid) to authenticated;
