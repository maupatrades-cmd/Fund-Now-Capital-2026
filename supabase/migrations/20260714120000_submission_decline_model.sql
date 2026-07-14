-- Partner-safe decline model on funder submissions, plus deal-level auto-decline.
--
-- Two concerns, one coherent model:
--   1. When a funder submission is declined, capture a PARTNER-SAFE generic
--      reason (decline_reason_category) separately from the OWNER-ONLY real
--      detail (decline_notes_internal). The Phase-D partner portal will show
--      only the generic category alongside the fictional funder name.
--   2. When the LAST active submission on a deal is declined, the deal itself
--      moves to the terminal 'declined' stage automatically.

-- ---------------------------------------------------------------------------
-- 1) Partner-safe generic decline reasons.
-- ---------------------------------------------------------------------------
create type public.submission_decline_reason as enum (
  'affordability',
  'documentation_gaps',
  'sector_appetite',
  'credit_profile',
  'security_insufficient',
  'funder_criteria_not_met',
  'other'
);

-- ---------------------------------------------------------------------------
-- 2) New columns on deal_funder_submissions.
-- ---------------------------------------------------------------------------
alter table public.deal_funder_submissions
  add column decline_reason_category public.submission_decline_reason,
  add column decline_notes_internal  text;

comment on column public.deal_funder_submissions.decline_reason_category is
  'Partner-safe generic decline reason. The ONLY decline detail a referral partner may ever see (via partner_submission_view; Phase-D portal).';
comment on column public.deal_funder_submissions.decline_notes_internal is
  'Owner-only free-text decline detail (what the funder actually said). NEVER exposed to partners.';

-- ---------------------------------------------------------------------------
-- 3) The database owns the money-adjacent rule (LB-281): a declined submission
--    MUST carry a partner-safe reason category. The form mirrors this, but the
--    constraint is the source of truth.
-- ---------------------------------------------------------------------------
alter table public.deal_funder_submissions
  add constraint deal_funder_submissions_decline_reason_ck
  check (status <> 'declined' or decline_reason_category is not null);

-- ---------------------------------------------------------------------------
-- 4) Deal-level auto-decline: when the LAST active submission is declined,
--    move the deal to the terminal 'declined' stage.
--
-- "Active" = any submission whose status is not 'declined'. If none remain
-- active after this decline, the deal is declined too.
--
-- SECURITY INVOKER: only owners can write submissions (RLS), so the nested
-- deals UPDATE runs as the owner and passes deals' owner RLS. Entering
-- 'declined' is permitted by deals_block_declined_reopen (that trigger only
-- blocks LEAVING 'declined'); deals_log_stage records the transition in
-- deal_stage_history; deals_before_write resets stage_entered_at. A later
-- reopen_deal() revives the deal deliberately, and a subsequent last-decline
-- can close it again.
-- ---------------------------------------------------------------------------
create or replace function public.deals_auto_decline_on_last_submission()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  active_remaining int;
  current_stage    public.deal_stage;
begin
  if new.status = 'declined'
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then

    select count(*) into active_remaining
      from public.deal_funder_submissions
     where deal_id = new.deal_id
       and status <> 'declined';

    if active_remaining = 0 then
      select stage into current_stage from public.deals where id = new.deal_id;
      if current_stage is distinct from 'declined' then
        update public.deals set stage = 'declined' where id = new.deal_id;
      end if;
    end if;
  end if;
  return null;
end;
$$;

create trigger deal_funder_submissions_auto_decline
  after insert or update of status on public.deal_funder_submissions
  for each row execute function public.deals_auto_decline_on_last_submission();

-- ---------------------------------------------------------------------------
-- 5) Partner-safe read path (scaffold now; portal UI is Phase D).
--
-- deal_funder_submissions is owner-only (it exposes funder identity + money).
-- A partner may see, on his OWN deals only: the fictional funder name, the
-- submission status, and the generic decline_reason_category. Never the real
-- funder name, decline_notes_internal, or any quote/commission figures.
--
-- The view runs with its owner's privileges (security_invoker off) so it can
-- read the owner-only base tables, and enforces the partner scope itself via
-- current_partner_id(). security_barrier blocks predicate push-down leaks.
-- ---------------------------------------------------------------------------
create view public.partner_submission_view
with (security_barrier = true) as
  select
    s.id,
    s.deal_id,
    f.display_name_for_partner as funder_display_name,
    s.status,
    s.decline_reason_category
  from public.deal_funder_submissions s
  join public.deals   d on d.id = s.deal_id
  join public.funders f on f.id = s.funder_id
  where public.is_owner()
     or d.referral_partner_id = public.current_partner_id();

comment on view public.partner_submission_view is
  'Partner-safe projection of deal_funder_submissions: fictional funder name, status, and generic decline reason for the partner''s own deals only. Excludes real funder name, internal decline notes, and all money fields.';

grant select on public.partner_submission_view to authenticated;
