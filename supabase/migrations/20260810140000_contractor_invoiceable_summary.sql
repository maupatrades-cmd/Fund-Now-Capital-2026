-- Build 9 add-on — contractor_my_invoiceable_summary(): a READ-ONLY eligibility
-- preview for the signed-in contractor's "Generate invoice" dialog.
-- ============================================================================
-- WHY A DEFINER RPC (not a client query like the partner side does):
--   commission_records RLS is owner-full + partner-read-own ONLY — there is no
--   contractor read-own policy, so a contractor cannot read their own
--   commission rows directly. The partner dialog previews eligibility with a
--   plain RLS-scoped client query; the contractor cannot, so this SECURITY
--   DEFINER function does the read server-side and returns ONLY aggregate
--   counts + Rand totals + the ready-date range for the CALLER'S OWN payable,
--   not-yet-invoiced contractor commissions.
--
-- S7C (absolute): returns the contractor's TAKE only (contractor_share) as a
-- sum + counts + dates. It NEVER returns FNC gross, retention, the pool, the
-- tier band/%, funder identity, or per-row detail — only what the dialog needs
-- to say "R X across N deals is ready in this period".
--
-- Eligibility predicate is IDENTICAL to #168's internal
-- contractor_invoiceable_commissions (payable FNC_Contractor tier rows, not on
-- any non-rejected contractor invoice) so the preview can never sanction more
-- than the authoritative generate RPC would actually invoice.
--
-- Depends on #168 (contractor_invoices + contractor_invoice_line_items) being
-- applied first. No schema change — a single new function.
-- ============================================================================

create or replace function public.contractor_my_invoiceable_summary(p_start date, p_end date)
returns table (
  selected_count  int,
  selected_amount numeric(14,2),
  ready_count     int,
  ready_amount    numeric(14,2),
  ready_start     date,
  ready_end       date
) language sql stable security definer set search_path = '' as $$
  with elig as (
    select
      cr.contractor_share as amount,
      coalesce(cr.payable_at, cr.earned_at, cr.created_at)::date as ready_date
    from public.commission_records cr
    where cr.contractor_id = (select auth.uid())
      and cr.deal_funder_submission_id is null
      and cr.attribution_type = 'FNC_Contractor'
      and cr.contractor_share > 0
      and cr.status = 'payable'
      and not exists (
        select 1
          from public.contractor_invoice_line_items li
          join public.contractor_invoices ci on ci.id = li.invoice_id
         where li.commission_record_id = cr.id
           and ci.state <> 'rejected'
      )
  )
  select
    coalesce(count(*) filter (where ready_date between p_start and p_end), 0)::int,
    coalesce(sum(amount) filter (where ready_date between p_start and p_end), 0)::numeric(14,2),
    coalesce(count(*), 0)::int,
    coalesce(sum(amount), 0)::numeric(14,2),
    min(ready_date),
    max(ready_date)
  from elig;
$$;

comment on function public.contractor_my_invoiceable_summary(date, date) is
  'Read-only invoice-eligibility preview for the signed-in contractor. Returns aggregate counts + Rand totals (contractor take only) + ready-date range for their payable, not-yet-invoiced FNC_Contractor tier commissions. S7C: no gross/pool/tier/funder — the "what is ready to invoice" figure only.';

-- Grants: caller-scoped (auth.uid()), returns only the caller's own aggregates,
-- so any authenticated user may run it (a non-contractor simply gets zeros).
revoke all on function public.contractor_my_invoiceable_summary(date, date) from public, anon;
grant  execute on function public.contractor_my_invoiceable_summary(date, date) to authenticated;

-- ===========================================================================
-- Assertions (structural + grant matrix). No synthetic data needed — the body
-- is a pure aggregate over existing rows scoped to auth.uid().
-- ===========================================================================
do $$
begin
  if not exists (
    select 1 from pg_proc pr join pg_namespace n on n.oid = pr.pronamespace
     where n.nspname = 'public' and pr.proname = 'contractor_my_invoiceable_summary'
  ) then
    raise exception 'assert FAIL: contractor_my_invoiceable_summary missing';
  end if;

  if not has_function_privilege('authenticated',
       'public.contractor_my_invoiceable_summary(date,date)', 'execute') then
    raise exception 'assert FAIL: authenticated cannot execute contractor_my_invoiceable_summary';
  end if;
  if has_function_privilege('anon',
       'public.contractor_my_invoiceable_summary(date,date)', 'execute') then
    raise exception 'assert FAIL: anon can execute contractor_my_invoiceable_summary';
  end if;

  raise notice 'Build 9 add-on: contractor_my_invoiceable_summary created + grants verified.';
end $$;
