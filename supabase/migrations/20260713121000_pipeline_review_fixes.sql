-- Pipeline review fixes (follow-up to the deal_pipeline migration).

-- 1) Make the reference sequence usable by authenticated inserts explicitly,
--    rather than relying on Supabase default privileges (portability / self-host).
grant usage on sequence public.deals_reference_seq to authenticated;

-- 2) Enforce Declined as a terminal stage at the database layer.
--
-- A deal can ENTER 'declined' from any stage, but it cannot LEAVE 'declined'
-- except through the deliberate reopen_deal() path, which sets a
-- transaction-local flag the trigger checks for.
create or replace function public.deals_block_declined_reopen()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.stage = 'declined'
     and new.stage is distinct from old.stage
     and coalesce(current_setting('app.reopen_deal', true), '') <> 'on' then
    raise exception
      'Declined deals are terminal; use reopen_deal() to revive them'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger deals_block_declined_reopen
  before update on public.deals
  for each row execute function public.deals_block_declined_reopen();

-- Deliberate revival path. Sets the transaction-local flag, then moves the deal
-- out of 'declined'. SECURITY INVOKER, so RLS still applies (owners only can
-- actually update; a partner's call updates zero rows). The BEFORE/AFTER deal
-- triggers still run, so stage_entered_at resets and the reopen is logged in
-- deal_stage_history.
create or replace function public.reopen_deal(p_deal_id uuid, p_stage public.deal_stage)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_stage = 'declined' then
    raise exception 'reopen_deal must move the deal to a non-declined stage';
  end if;
  perform set_config('app.reopen_deal', 'on', true);
  update public.deals set stage = p_stage where id = p_deal_id;
end;
$$;
