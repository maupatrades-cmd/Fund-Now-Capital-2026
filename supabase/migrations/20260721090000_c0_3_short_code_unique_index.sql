-- C0.3 follow-up — case-insensitive uniqueness on funders.short_code.
-- Reference: CodeRabbit review on PR #68 (short_code feeds the C1 invoice payment
-- reference POLLEN-INV0032-CHICKANOS; two funders sharing a code would make those
-- references ambiguous). Owner-approved 2026-07-21.
--
-- Partial (non-null) + upper() so uniqueness applies only to set codes and is
-- case-insensitive (the UI already uppercases; this enforces at the DB so a direct
-- write can't create a case-variant collision). All 21 short_codes are NULL today,
-- so the index covers zero rows at creation — plain CREATE INDEX is instant here
-- (CONCURRENTLY can't run inside a migration transaction and isn't needed at this
-- size / row count).

create unique index if not exists funders_short_code_unique
  on public.funders (upper(short_code))
  where short_code is not null;

-- ===========================================================================
-- Assertions (RAISE → roll the migration back). The negative test mutates two
-- real funders then reverts; the failing UPDATE persists nothing.
-- ===========================================================================
do $$
declare
  v_a uuid;
  v_b uuid;
begin
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and indexname = 'funders_short_code_unique'
  ) then
    raise exception 'C0.3-fix assert FAIL: funders_short_code_unique index missing';
  end if;

  -- Case-insensitive collision is rejected (two real funders, reverted after).
  select id into v_a from public.funders order by name limit 1;
  select id into v_b from public.funders where id <> v_a order by name limit 1;

  if v_a is not null and v_b is not null then
    update public.funders set short_code = 'ZZTESTUNIQ' where id = v_a;
    begin
      update public.funders set short_code = 'zztestuniq' where id = v_b;  -- case variant
      raise exception 'C0.3-fix assert FAIL: case-insensitive duplicate short_code accepted';
    exception when unique_violation then null;  -- expected block
    end;
    update public.funders set short_code = null where id = v_a;  -- revert
  else
    raise notice 'C0.3-fix uniqueness live-test skipped (need two funders)';
  end if;

  raise notice 'C0.3-fix assertions passed (short_code unique index present + case-insensitive)';
end $$;

notify pgrst, 'reload schema';
