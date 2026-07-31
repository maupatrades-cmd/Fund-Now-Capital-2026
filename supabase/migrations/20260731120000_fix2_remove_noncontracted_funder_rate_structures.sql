-- FIX #2 — Remove funder_commission_structures rows for NON-CONTRACTED funders
-- Source: .coordination/full-system-audit-2026-08-01.md §9.4 (Data-vs-policy drift)
--
-- SPEC S1 C0.3 (LOCKED — Option A): only funders with `is_contracted = true`
-- may carry `funder_commission_structures` rows. The rule is enforced GOING
-- FORWARD by the `enforce_rate_funder_contracted` BEFORE-trigger (a Postgres
-- CHECK can't reference another table, so the cross-table gate is a trigger).
-- Two rate rows predate that flag being set false and violate the invariant:
--   • Lula        — non_po, percent_of_gross_funded 1.00%  (is_contracted=false)
--   • RM Capital  — po,     flat_rand_per_deal R5,000.00   (is_contracted=false)
-- Verified live against project hvxruwkgmhjoypepffgv on 2026-07-31: the
-- `is_contracted = false` predicate matches EXACTLY those two rate rows.
--
-- Design:
--   * Atomic — the whole DO block is one transaction; any RAISE rolls back
--     every change (delete + audit), so the migration is all-or-nothing.
--   * Idempotent — targets the S1 C0.3 invariant (is_contracted=false), not
--     hard-coded ids; a re-run finds 0 matching rows and no-ops cleanly.
--   * Over-deletion guard — halts (rolls back) if MORE than 2 rows match,
--     which would signal an unexpected `is_contracted` change to review first.
--   * Audit — the existing A10 `log_activity` trigger fires per deleted row
--     (a DELETE marker anchored to each rate-row id). Because `log_activity`
--     does NOT capture a before-image on DELETE, this migration ALSO writes
--     one summary `activity_logs` row carrying the cleanup rationale AND the
--     full before-image of every removed row (in `before_values`).
--   * Post-condition — asserts the S1 C0.3 invariant holds afterward.

do $$
declare
  r            record;
  v_ids        uuid[]  := '{}';   -- deleted rate-structure ids
  v_funder_ids uuid[]  := '{}';   -- their funder ids (for related_entity_ids)
  v_funders    text[]  := '{}';   -- their funder names (for the description)
  v_images     jsonb   := '[]'::jsonb;  -- full before-image of each removed row
  v_count      int;
begin
  -- Remove rate structures belonging to non-contracted funders (S1 C0.3).
  -- The per-row log_activity trigger fires for each deletion.
  for r in
    delete from public.funder_commission_structures s
    using public.funders f
    where s.funder_id = f.id
      and f.is_contracted = false
    returning s.id, s.funder_id, f.name as funder_name, to_jsonb(s.*) as row_image
  loop
    v_ids        := v_ids || r.id;
    v_funder_ids := v_funder_ids || r.funder_id;
    v_funders    := v_funders || r.funder_name;
    v_images     := v_images || jsonb_build_object('funder', r.funder_name, 'row', r.row_image);
  end loop;

  v_count := coalesce(array_length(v_ids, 1), 0);

  -- Over-deletion guard: exactly 2 non-contracted rate rows were verified live
  -- on 2026-07-31 (Lula, RM Capital). Halt if more match.
  if v_count > 2 then
    raise exception
      'FIX #2 over-deletion guard: expected at most 2 non-contracted rate rows, matched % (funders: %). Rolling back for owner review.',
      v_count, v_funders;
  end if;

  if v_count = 0 then
    raise notice 'FIX #2: no non-contracted funder rate structures found — already clean (idempotent re-run).';
  else
    -- Summary audit entry: rationale + full before-image of every removed row
    -- (the per-row DELETE markers are emitted by the A10 log_activity trigger).
    insert into public.activity_logs (
      occurred_at, user_id, user_email, user_role,
      event_type, entity_type, entity_id,
      description, before_values, related_entity_ids, notes
    ) values (
      now(), null, null, 'system',
      'DELETE', 'funder_commission_structure', null,
      'FIX #2: removed ' || v_count || ' non-contracted funder rate structure row(s): '
        || array_to_string(v_funders, ', '),
      v_images,
      to_jsonb(v_funder_ids),
      'S1 C0.3 (LOCKED) contracted-only cleanup: funder_commission_structures must hold rows '
        || 'ONLY for is_contracted=true funders (enforced going forward by '
        || 'enforce_rate_funder_contracted). The removed rows predate the flag being set false. '
        || 'Source: .coordination/full-system-audit-2026-08-01.md §9.4.'
    );
    raise notice 'FIX #2: deleted % non-contracted funder rate structure(s): %', v_count, v_funders;
  end if;

  -- Belt-and-braces post-condition: the S1 C0.3 invariant must now hold.
  if exists (
    select 1
    from public.funder_commission_structures s
    join public.funders f on f.id = s.funder_id
    where f.is_contracted = false
  ) then
    raise exception
      'FIX #2 post-condition failed: a non-contracted funder still carries a rate structure row after cleanup. Rolling back.';
  end if;
end $$;
