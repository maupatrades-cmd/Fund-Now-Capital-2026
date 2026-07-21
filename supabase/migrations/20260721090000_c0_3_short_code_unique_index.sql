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
-- Assertions (RAISE → roll the migration back). Catalog-only — inspects the
-- index definition via pg_index / pg_get_indexdef and mutates NO rows, so it's
-- replay-safe and can never disturb a real short_code (the earlier row-mutating
-- test could wipe a code on re-apply — CodeRabbit #70).
-- ===========================================================================
do $$
declare
  v_def    text;
  v_unique boolean;
begin
  select pg_get_indexdef(i.indexrelid), i.indisunique
    into v_def, v_unique
  from pg_index i
  where i.indexrelid = 'public.funders_short_code_unique'::regclass;

  if v_def is null then
    raise exception 'C0.3-fix assert FAIL: funders_short_code_unique index missing';
  end if;
  if not v_unique then
    raise exception 'C0.3-fix assert FAIL: index is not UNIQUE (def: %)', v_def;
  end if;
  -- case-insensitive: keyed on upper(short_code)
  if position('upper(short_code)' in lower(v_def)) = 0 then
    raise exception 'C0.3-fix assert FAIL: index is not case-insensitive on short_code (def: %)', v_def;
  end if;
  -- partial: only constrains non-null codes
  if position('where' in lower(v_def)) = 0 then
    raise exception 'C0.3-fix assert FAIL: index is not partial (expected WHERE short_code IS NOT NULL) (def: %)', v_def;
  end if;

  raise notice 'C0.3-fix assertions passed (unique + case-insensitive + partial short_code index)';
end $$;

notify pgrst, 'reload schema';
