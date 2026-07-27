# Agent Coordination Status

## OLD CC 1 — C2.2 Backend
- Session started: 2026-07-22 23:42 SAST
- Task: commission_records reshape + write_commission_record RPC + funded-transition trigger
- PR: not opened yet
- Files touched: supabase/migrations/*_c2_2_*.sql
- Tables/RPCs affected: commission_records (reshape), deals (add trigger only), write_commission_record (NEW), commission_records_recompute + notify_commission_paid (reconcile)
- Blocked on: none
- Do NOT touch (from other agents): reserved for their protected files
- Last update: 2026-07-22 23:42 SAST

## NEW CC 1 — Funder Billing Details Prep
- Session: not yet started
- Task: populate legal_name/billing_address/company_registration/vat_registration/accounts_email on funders rows for contracted funders
- Blocked on: owner providing real details per funder
- Last update: N/A

## NEW CC 2 — Data Hygiene
- Session started: 2026-07-22 (Data Hygiene Sweep) — INVESTIGATION COMPLETE, no data changed
- Task: CIPC correction drafts + Brighton/Flow48 audit + sequence check + test residue scan
- Files touched: scratchpad/mama-mabase-cipc-correction.sql (draft only). No production data changed.
- Do NOT touch (from other agents): commission_records, funders (OLD CC 1 + NEW CC 1 own these)
- Findings:
  1. CIPC — ALREADY CORRECTED today 2026-07-22 20:03:52 UTC (201989387807 → 2019/893878/07,
     direct DB update, actor null). Draft is now a guarded confirm/no-op pending CIPC-portal value.
  2. Brighton Capital + Flow48 — both is_contracted=true, flipped 2026-07-21 ~22:20–22:22 UTC as part
     of a BATCH of 9 funders all flipped that evening (Sourcefin, Bridgement, Merchant Capital,
     Better Banc, GenFin, Business Partners, Pollen Finance + these 2). Seeded 2026-07-13 19:32:49.
     NO activity_logs exist for the flip — funders table has ZERO activity logging (0 rows entity_type=funder).
     Only trace is updated_at. Owner decision needed: were all 9 intended as contracted?
  3. Sequences — funder_invoices_seq = 32, is_called=false → next invoice #32 (CONFIRMED, matches expectation).
     deals_reference_seq = 10, is_called=true → next DEAL-011 (gaps from deleted test deals, expected).
     Only these 2 sequences exist in public schema.
  4. Test residue — CLEAN. 0 hits in all live tables (clients/leads/deals/documents/call_logs/notifications/
     contacts/partners). No B3.2 Test Lead, no C1.2 UI Smoke, no smoke residue. All 3 deals/2 leads/1 call_log
     are real. All docs + submissions attach to real parents, zero orphans. Only footprints are 10 immutable
     activity_logs DELETE rows from the 2026-07-17 cleanup (correct — audit truth, do not purge).
- Blocked on: owner CIPC portal lookup (likely no-op) + Brighton/Flow48/batch-of-9 contracted decision
- Last update: 2026-07-27 (idempotency audit done; doc-fix drafts handed off below)

---

## 📌 HANDOFF → whoever owns the CLAUDE.md edit this cycle (from NEW CC 2, 2026-07-27)
Owner-approved. Two doc fixes to add to **CLAUDE.md** (SPEC.md needs no change). Paste-ready
below — verbatim, owner already reviewed the wording. Context: the C-phase idempotency audit
surfaced 5 real gaps, ALL UI-layer, and no UI write-standard existed in the docs; and the
"belt-and-braces rule 10" that PRs keep citing is written down nowhere. These two fixes close both.
Full rationale + a standalone copy: `scratchpad/doc-idempotency-wording-DRAFT.md`.

**FIX 1 — append to `## Working style`, directly after the "Supabase RLS silently returns empty
result sets…" paragraph (its natural companion):**

```
Every user-facing control that writes state (create, transition, delete) must be idempotency-safe
at the UI layer, not only the DB. The button or submit disables itself the moment its mutation is
in flight — `disabled={mutation.isPending}`, or a local `const [loading, setLoading] = useState(false)`
with `try { setLoading(true); await rpc(); } finally { setLoading(false); }` — shows a working label
("Saving…" / "Uploading…" / "Working…"), and re-enables only on settle. Destructive or irreversible
actions (delete, void, override, reopen) additionally require an explicit confirm step. Every write
fires a success toast AND an error toast, so the owner always sees that the action landed, or why it
failed. This is the UI companion to the silent-RLS `.select()` rule: the DB backstop stops the
duplicate, the UI stops the double-click that provokes it. Applies to every write surface, Phases B through F.
```

**FIX 2 — new titled section immediately AFTER `## Security rules — NON-NEGOTIABLE`
(leaves security rules 1–8 intact; gives "rule 10" a written home). If a number other than 10 is
preferred, only the heading changes — the body stands:**

```
## State-mutation hardening — belt-and-braces (standing rule 10)
Every RPC or trigger that creates or transitions state applies as many of these as the operation
allows — a money-bearing write applies all of them:

1. **Serialize concurrent execution.** Either `pg_advisory_xact_lock(<key>)` (e.g.
   `generate_funder_invoice`, `write_commission_record`) OR a `SELECT … FOR UPDATE` row lock on the
   anchor row (e.g. `qualify_lead` locks the lead). These are equivalent and interchangeable — pick
   whichever fits; a row lock is preferred when a single natural row anchors the operation. One of the
   two is required; "no advisory lock" is NOT a gap if a `FOR UPDATE` lock is present.
2. **Dedup the create.** A unique constraint / partial-unique + `ON CONFLICT`, or an `upsert`
   (e.g. `funder_invoices.invoice_number` unique; `client_stories` unique `client_id` upsert;
   `deal_funder_submissions` unique `(deal_id, funder_id)`).
3. **Idempotent short-circuit.** A re-call on already-final state returns the existing result and
   mutates nothing — same return shape on every path (e.g. `qualify_lead` returns the existing deal
   with `match_kind:'idempotent'` when the lead is already qualified).
4. **State guard.** A CHECK constraint or a guarded `WHERE` on the prior state (e.g.
   `… WHERE qualification_stage = 'new_lead'`), with a `.select()`/`RETURNING` row-count check so a
   silent no-op surfaces loudly (the silent-RLS rule).
5. **Owner guard + definer hygiene.** Owner-only writes: `is_owner()` body guard, `SECURITY DEFINER`,
   `SET search_path = ''`.
6. **Grant matrix.** `postgres + authenticated + service_role`, anon-free — revoke from BOTH `public`
   AND `anon` (Supabase default privileges grant `anon`; revoking only `public` leaves it). Mirror
   every existing owner-only money RPC.
7. **Self-verifying migration.** A DO-block with structural assertions (definer, search_path, grants,
   signature) AND behavioural assertions on synthetic rows, unwound by a `ROLLBACK_TEST_DATA` exception
   so nothing persists.

Companion to Security rule 5: money is recomputed server-side AND every money-state write is idempotent
under double-submit / retry — the two clauses always travel together.
```

NEW CC 2 will NOT edit CLAUDE.md itself (standing rule: SPEC/CLAUDE/ROADMAP are owner/other-lane edits).
