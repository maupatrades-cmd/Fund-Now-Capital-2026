-- Fix a race in deals_auto_decline_on_last_submission (CodeRabbit, follow-up to
-- submission_decline_model / PR #12).
--
-- The trigger counts remaining active submissions to decide whether the deal
-- should auto-decline. Two concurrent declines on the SAME deal could each read
-- that count before the other committed, both still see an active sibling, and
-- neither moves the deal to Declined — leaving a fully-declined deal stuck open.
--
-- Fix: take a per-deal row lock (SELECT ... FOR UPDATE) before counting, so
-- concurrent declines on one deal serialise — the second waits for the first to
-- commit, then re-counts and sees the true remaining-active total.
--
-- Only the function body changes; the trigger definition is unchanged.
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

    -- Serialise concurrent declines on the same deal before counting.
    perform 1 from public.deals where id = new.deal_id for update;

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
