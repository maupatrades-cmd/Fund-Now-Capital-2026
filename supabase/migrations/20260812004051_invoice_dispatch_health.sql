-- C10: Owner-only health and next-action view over the existing invoice dispatch ledger.

create or replace function public.owner_funder_invoice_dispatch_health()
returns table (
  invoice_id uuid,
  invoice_number text,
  deal_id uuid,
  invoice_state text,
  total_amount numeric,
  latest_dispatch_status text,
  latest_dispatch_at timestamptz,
  recipient_email text,
  attention_reason text,
  recommended_action text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_owner() then
    raise exception 'Only the owner can inspect invoice dispatch health' using errcode = '42501';
  end if;

  return query
  select
    i.id,
    i.invoice_number,
    i.deal_id,
    i.state::text,
    i.total_amount,
    d.status,
    coalesce(d.delivered_at, d.sent_at, d.failed_at, d.queued_at),
    d.recipient_email,
    case
      when i.state = 'draft' then 'Invoice is still a draft'
      when d.id is null then 'Issued invoice has never been queued for delivery'
      when d.status in ('failed','bounced') then 'Latest delivery attempt failed'
      when d.status = 'queued' and d.queued_at < now() - interval '15 minutes' then 'Delivery remains queued beyond 15 minutes'
      when d.status = 'sent' and d.sent_at < now() - interval '24 hours' then 'Delivery has no confirmation after 24 hours'
      else null
    end,
    case
      when i.state = 'draft' then 'Issue invoice'
      when d.id is null then 'Queue invoice email'
      when d.status in ('failed','bounced') then 'Review failure and retry'
      when d.status = 'queued' and d.queued_at < now() - interval '15 minutes' then 'Check email worker'
      when d.status = 'sent' and d.sent_at < now() - interval '24 hours' then 'Confirm recipient or resend'
      else 'No action required'
    end
  from public.funder_invoices i
  left join lateral (
    select x.*
    from public.funder_invoice_dispatches x
    where x.invoice_id = i.id
    order by x.attempt_number desc
    limit 1
  ) d on true
  where i.state <> 'void'
  order by
    case when i.state = 'draft' or d.id is null or d.status in ('failed','bounced') then 0 else 1 end,
    i.created_at desc;
end;
$$;

revoke all on function public.owner_funder_invoice_dispatch_health()
  from public, anon;
grant execute on function public.owner_funder_invoice_dispatch_health()
  to authenticated;

do $$
begin
  if has_function_privilege('anon','public.owner_funder_invoice_dispatch_health()','EXECUTE') then
    raise exception 'C10: anonymous invoice health access exposed';
  end if;
end;
$$;

notify pgrst, 'reload schema';
