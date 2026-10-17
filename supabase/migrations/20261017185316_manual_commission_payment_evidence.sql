-- Full manual payments only. Does not execute an EFT or settle an invoice.
create table public.owner_commission_payments (
  entry_id uuid primary key references public.owner_commission_entries(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0 and amount::text not in ('NaN','Infinity','-Infinity')),
  currency text not null,
  payment_reference text not null check (length(btrim(payment_reference)) between 3 and 200),
  proof_path text not null,
  proof_object_id uuid not null,
  recorded_by uuid not null references public.profiles(id) on delete restrict,
  recorded_at timestamptz not null default now()
);
alter table public.owner_commission_payments enable row level security;
revoke all on public.owner_commission_payments from public, anon, authenticated;
grant select on public.owner_commission_payments to authenticated;
create policy owner_commission_payments_owner_read on public.owner_commission_payments
for select to authenticated using ((select public.is_owner()));
create trigger owner_commission_payments_immutable before update or delete
on public.owner_commission_payments for each row
execute function public.owner_commission_append_only_guard();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('commission-payment-proofs','commission-payment-proofs',false,10485760,
  array['application/pdf','image/png','image/jpeg']);
create policy commission_proofs_insert on storage.objects for insert to authenticated
with check (bucket_id = 'commission-payment-proofs' and (select public.is_owner())
  and split_part(name,'/',1) = (select auth.uid())::text);
create policy commission_proofs_read on storage.objects for select to authenticated
using (bucket_id = 'commission-payment-proofs' and (select public.is_owner()));
-- Restrictive policies also protect against a future broad permissive policy.
create policy commission_proofs_no_update on storage.objects as restrictive
for update to authenticated using (bucket_id <> 'commission-payment-proofs')
with check (bucket_id <> 'commission-payment-proofs');
create policy commission_proofs_no_delete on storage.objects as restrictive
for delete to authenticated using (bucket_id <> 'commission-payment-proofs');
create policy commission_proofs_private on storage.objects as restrictive
for select to authenticated using (bucket_id <> 'commission-payment-proofs' or (select public.is_owner()));
create policy commission_proofs_owner_insert on storage.objects as restrictive
for insert to authenticated with check (bucket_id <> 'commission-payment-proofs' or
  ((select public.is_owner()) and split_part(name,'/',1) = (select auth.uid())::text));

-- Keep the old function as a private implementation of its existing eligibility
-- checks. API callers must use the new expected-amount/evidence command.
revoke all on function public.owner_mark_commission_entry_paid(uuid,text) from public, anon, authenticated;

create function public.owner_record_commission_payment(
  p_entry_id uuid, p_expected_amount numeric, p_currency text,
  p_payment_reference text, p_proof_path text
)
returns public.owner_commission_payments
language plpgsql security definer set search_path = '' as $$
declare
  v_deal uuid;
  v_entry public.owner_commission_entries;
  v_existing public.owner_commission_payments;
  v_object storage.objects;
  v_amount numeric;
begin
  perform public.owner_commission_require_owner();
  if p_expected_amount is null or p_expected_amount <= 0
    or p_expected_amount::text in ('NaN','Infinity','-Infinity')
    or p_expected_amount <> round(p_expected_amount,2) then
    raise exception 'A positive exact payment amount is required';
  end if;
  if p_payment_reference is null or length(btrim(p_payment_reference)) not between 3 and 200 then
    raise exception 'A payment reference of 3 to 200 characters is required';
  end if;
  select deal_id into v_deal from public.owner_commission_entries where id=p_entry_id;
  if v_deal is null then raise exception 'Entry not found'; end if;
  perform pg_advisory_xact_lock(hashtextextended('owner_commission:' || v_deal::text,0));
  select * into v_existing from public.owner_commission_payments where entry_id=p_entry_id;
  if found then
    if v_existing.amount is not distinct from p_expected_amount
      and v_existing.currency is not distinct from p_currency
      and v_existing.payment_reference is not distinct from btrim(p_payment_reference)
      and v_existing.proof_path is not distinct from p_proof_path then
      return v_existing;
    end if;
    raise exception 'Payment already recorded; review the permanent payment evidence';
  end if;
  select * into v_entry from public.owner_commission_entries where id=p_entry_id for update;
  v_amount := public.owner_commission_effective(p_entry_id);
  if v_entry.currency is distinct from p_currency or v_amount is distinct from p_expected_amount then
    raise exception 'The allocation amount or currency changed; refresh and review before recording payment';
  end if;
  if p_proof_path is null or split_part(p_proof_path,'/',1) <> (select auth.uid())::text
    or split_part(p_proof_path,'/',2) <> p_entry_id::text then
    raise exception 'Proof must be uploaded for this Owner and allocation';
  end if;
  select * into v_object from storage.objects
    where bucket_id='commission-payment-proofs' and name=p_proof_path for share;
  if not found then raise exception 'Upload the payment proof before recording payment'; end if;
  if coalesce(v_object.metadata->>'mimetype','') not in ('application/pdf','image/png','image/jpeg')
    or coalesce(v_object.metadata->>'size','') !~ '^[0-9]{1,10}$' then
    raise exception 'Payment proof has invalid file metadata';
  end if;
  if (v_object.metadata->>'size')::bigint not between 1 and 10485760 then
    raise exception 'Payment proof must be between 1 byte and 10 MB';
  end if;
  -- Rechecks approved state, whole-deal reconciliation, flags and pending
  -- drafts. The existing route trigger atomically rejects automatic payouts.
  perform public.owner_mark_commission_entry_paid(p_entry_id,btrim(p_payment_reference));
  insert into public.owner_commission_payments
    (entry_id,amount,currency,payment_reference,proof_path,proof_object_id,recorded_by)
  values (p_entry_id,v_amount,p_currency,btrim(p_payment_reference),p_proof_path,v_object.id,(select auth.uid()))
  returning * into v_existing;
  perform public.staff_audit_write('owner_commission_entry',p_entry_id,'commission_payment_evidence_recorded',null,
    jsonb_build_object('amount',v_amount,'currency',p_currency,'proof_object_id',v_object.id));
  return v_existing;
end;
$$;
revoke all on function public.owner_record_commission_payment(uuid,numeric,text,text,text) from public, anon, authenticated;
grant execute on function public.owner_record_commission_payment(uuid,numeric,text,text,text) to authenticated;

-- Even an internal transition flag cannot rewrite paid entry metadata.
create function public.owner_commission_paid_metadata_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status='paid' and (new.paid_at is distinct from old.paid_at
    or new.paid_by is distinct from old.paid_by or new.payment_reference is distinct from old.payment_reference) then
    raise exception 'Recorded commission payment metadata is immutable';
  end if;
  return new;
end;
$$;
revoke all on function public.owner_commission_paid_metadata_immutable() from public, anon, authenticated;
create trigger owner_commission_paid_metadata_immutable before update on public.owner_commission_entries
for each row execute function public.owner_commission_paid_metadata_immutable();
