# Agent Coordination Status

## OLD CC 1 — C2 Backend — 🛑 HANDOVER / STOOD DOWN (2026-07-27, rate-limit pause)
- Session: 2026-07-22 → 2026-07-27. C2.1/C2.2/C2.3 MERGED + APPLIED + verified live. C2.4 built + in review (NOT applied). Standing down; a FRESH SESSION takes over.

### ⚠️ CRITICAL — next session's first job: apply C2.4 after PR #86 merges
- **PR #86 (C2.4) — OPEN, validated in rollback, DO-NOT-APPLIED (owner deferred apply to fresh session).** Two files, apply STRICTLY IN ORDER after merge:
  1. `supabase/migrations/20260727210000_c2_4_bonus_paid_enums.sql`  (adds BONUS_PAID to activity_event_type + notification_event_type — MUST be its own apply/txn; a new enum value can't be used in the txn it's added)
  2. `supabase/migrations/20260727210100_c2_4_bonus_records.sql`  (table + RPCs + triggers + assertions; self-verifies incl. the settle→BONUS_PAID emit, which was enum-gated during rollback validation)
- Validation done pre-merge: full lifecycle in a rolled-back txn (add_bonus idempotency + Decision-C guard, lockstep cascade with the commission, immutability block, void_bonus OVERRIDE, void-cascade revert, per-deal first-invoice-wins, P0002 stubs, RLS). Only the settle→BONUS_PAID runtime is deferred to apply-time (inherent to enum-add-then-use). After apply, verify: bonus_records live, BONUS_PAID in both enums, 0 rows, no leaked test deals (C2_4_*).
- **Readiness spot-check (2026-07-27, read-only): PASS** — commission_state has all 5 values; C2.3 commission_cascade trigger present + enabled; no bonus_records/bonus_* collision; BONUS_PAID net-new in both enums; commission_records 0 rows.

### PR #87 (docs) — OPEN
- CLAUDE.md DEAL-001 correction (Funded stage but NOT genuinely funded; commission_records legitimately 0 rows; never backfill from notes). Owner merges. No apply needed.

### 6 triage findings — status
1. Test residue (DEAL-011/012 "reginald maupa") — **DONE** (owner cleaned).
2. Stale docs PRs #64/#39/#29 — **OPEN**, recommend close/renumber (#64's "S7B" label clashes with merged #81's S7B).
3. BONUS_PAID (+ MISMATCH) frontend mapping in src/lib/notifications.ts — **PENDING** (NEW CC 2 / frontend lane; notification delivers regardless).
4. Email footer 75→73 Marshall St — **DONE via PR #84** (merged).
5. G7 commission-engine reconciliation — **OPEN/DEFERRED** (real money-math, no live trigger yet): (a) calculate_commission gives flat-40% to ALL PO deals; SPEC S7C scopes flat-40% to Sourcefin PO only — fix before first non-Sourcefin PO deal; (b) R1M+ tier is 25% in-code but "TBD" in S7C — confirm before first R1M+ deal. Natural small migration+SPEC PR right after C2.4.
6. DEAL-001 at kanban "Funded" but not genuinely funded — **OWNER JUDGMENT** (move back to a pre-funding stage vs leave + progress properly). Money layer already ignores it correctly.

### C3 (next build) — NOT started, anchor points for the next session
- C3 = Doctor's Earnings engine + `/partner-earnings` route. Consumes commission_records + bonus_records at their lifecycle states; the P0002 settle/unsettle stubs (commission + bonus) get wired when C4 builds partner_invoices. Respect SPEC S7C presentation policy (Doctor sees only his Rands, 50/50 framing) + S8. Same rhythm: schema-verify → scope proposal → owner OK → build → PR → owner merges.

### Partial work worth preserving
- None uncommitted. Everything is in a PR (#86, #87) or merged. Scratchpad has commit-message drafts only (ephemeral). No stray branches beyond the pushed feature branches.
- LIVE STATE (verified 2026-07-27): 11 contracted funders; commission_records + (once #86 applies) bonus_records lifecycle wired; 0 real money rows (no genuine funding yet).
- Standing rule reminder for the applier: OLD CC 1 does NOT touch funder billing columns, CIPC data, or frontend.
- Last update: 2026-07-27 (Mon) — HANDOVER; OLD CC 1 stood down for rate-limit pause. Fresh session applies #86 post-merge.

## NEW CC 1 — Funder Billing + email footer + docs (STANDING DOWN — rate-limit pause)
- Last update: 2026-07-28 (Tue) — handover before strategic pause.

### ✅ Edge Function redeploy (DONE + verified)
- `send-notification-email` redeployed **v11 → v12** from merged `main` (after PRs #84 + #85 merged).
- Verified: footer address now **73 Marshall Street** (HTML + plain-text), no `75` anywhere; `verify_jwt=false` preserved (webhook-secret auth). Also brought the function current with `main` — the previously-undeployed C1.1 invoice email routing (FUNDER_INVOICE_ISSUED / INVOICE_MARKED_PAID / INVOICE_OVERDUE) is now live. This closes OLD CC 1's deferred "75→73 email-template TODO".

### ✅ SPEC S1 docs PR — ALREADY OPENED as **PR #88** (awaiting Macroscope + owner merge)
- NOT "planned/unopened" — it is open. A fresh session only needs to MERGE it, not create it.
- Content: SPEC.md S1 funder count `21 → 23` (+ derived appetite line 12 scored / 9→11 unscored, against 23; no invented scores); CLAUDE.md adds `Naledi` (Spartan) + `Sizwe` (AAA Consortium) to the fictional name pool.

### Funder billing block progress (funders INVOICE TO fields)
- **Pollen Finance** — full (pre-existing reference).
- **Merchant Capital** — DONE except **VAT** (owner to confirm number, or "not registered" → NULL). legal_name/address/CIPC/accounts_email/phone all set.
- **Bright On Capital** — name+legal_name set (renamed from "Brighton Capital"), short_code `BRIGHTON`. Address/CIPC/VAT/accounts_email still pending.
- **7 more contracted funders PENDING owner registered data** (address/CIPC/VAT/accounts_email): Bridgement, Sourcefin, GenFin, Better Banc, Flow48, Business Partners, + the 2 new (Spartan, AAA Consortium). ⚠️ Better Banc + Business Partners also lack a short_code.
- These details come from funder invoices/letterheads, not rate emails. Reconcile migration for all applied funder data = merged PR #85.
- Also captured (NOT applied): funder RATE-structure intel for C2 in scratchpad/funder-rate-structures-capture.md (Bright On 7.5% fees+interest, Sourcefin net-profit, Business Partners 1%, Spartan 1%, AAA 3%/opt1.6%, Centrafin 1%+2.8% client fee [NOT contracted]). Needs new rate_types → a C2 scope proposal.

- STANDING DOWN. No new work this session.

## DESIGN — UI polish + brand consistency (F5/F6 lane)
- Session: 2026-07-29 (Wed) ~21:25 SAST.
- Scope: empty states + loading states polish only. No partner/* routes, no C3–C7, no backend, no SPEC/CLAUDE/ROADMAP.
- **PR #89 — OPEN (awaiting Macroscope + owner merge).** Branded empty state for `/leads` + new reusable `EmptyState` component (`src/components/ui/empty-state.tsx`). Distinguishes filtered-empty ("Clear filters") from first-run ("Add your first lead") — the old one-liner conflated them. Visual-only, 2 files, tsc+build+oxlint green.
- Note for other lanes: `EmptyState` is the canonical empty-state primitive going forward — reuse it, don't hand-roll "No X yet" text.
- Discrepancy flagged to owner: the briefing's `docs/proposals/f5-f6-ui-polish-scope-proposal.md` (Codex banked proposal) and `src/assets/fintech-spinner/` assets do NOT exist in this branch or origin/main. DESIGN lane is proceeding on the real live-code baseline instead.
- Next: 3 more empty-state proposals drafted for owner pick (clients / invoices / pipeline empty column). Owner chooses next build after #89 lands.
- Last update: 2026-07-29 (Wed).

## NEW CC 2 — Data Hygiene
- Session: not yet started
- Task: CIPC correction drafts + Brighton/Flow48 audit + sequence check + test residue scan
- Blocked on: owner CIPC portal lookup + Brighton/Flow48 review decision
- Last update: N/A

## VERIFY/CLEANUP — verification + drift catching lane
- Session: 2026-07-29 (Wed) ~21:15 SAST. Read-only verification only.

### ✅ C2.4 (PR #86) apply verification — ALL PASS (live DB `hvxruwkgmhjoypepffgv`)
- `bonus_records` table live: all 17 columns present, nullability matches migration. RLS enabled + both policies (`bonus_records_owner_all`, `bonus_records_partner_read_own`). Dedup unique index `bonus_records_dedup_uq` matches spec (coalesced-submission sentinel, `WHERE state<>'void'`). **0 rows.**
- `BONUS_PAID` present in BOTH enums (`notification_event_type` + `activity_event_type`).
- 3 RPCs present, all SECURITY DEFINER + `search_path` set + return jsonb + grants = `authenticated:EXECUTE` only (no anon/PUBLIC): `add_bonus(uuid,uuid,uuid,numeric,text)`, `void_bonus(uuid,text,text)`, `transition_bonus_record(uuid,commission_state,uuid)`. Signatures match PR spec.
- C4 stubs `settle_/unsettle_bonus_from_partner_invoice(uuid,uuid)` — DEFINER, authenticated-only, **raise P0002 at runtime** (live-tested).
- Triggers all ENABLED: `bonus_cascade_on_invoice_state` (lockstep cascade on funder_invoices), `bonus_records_immutable_when_settled`, `notify_bonus_paid`, `log_activity_bonus_records`, `set_updated_at`. (Note: `bonus_records_immutable_when_settled()` is SECURITY INVOKER — as-written in the migration, comparison-only trigger fn; not a defect.)

### ✅ Production-data truth — MATCHES briefing
- 3 real clients: `fepa sechaba`, `Mama Mabase JV`, `NRL BAKWENA MINE`. 3 real deals: DEAL-001 (stage `funded`), DEAL-002 (`qualifying`), DEAL-004 (`qualifying`). 0 submissions carry `amount_funded` → DEAL-001 not genuinely funded (confirmed).
- Money layer correctly empty: 0 commission_records, 0 funder_invoices, 0 bonus_records. 23 funders / 11 contracted.
- `funder_invoices_seq` starts at 32, never advanced (`last_value` null) → first invoice will be **INV-0032**. `deals_reference_seq`=12 (deleted DEAL-011/012 test deals advanced it; real deals 001/002/004).

### ⚠️ DRIFT FOUND — orphaned qualified lead "reginald maupa" (test residue, NOT cleaned)
- Board finding #1 was marked DONE ("owner cleaned DEAL-011/012 reginald maupa") but only the DEALS + client were removed. The **source lead survived**: `leads.id=b7f40b31-d6ac-4b50-944e-5296ef0a634b`, `qualification_stage=qualified`, created 2026-07-22, `linked_deals=null`, no matching client. Carries **real PII** (contact `reginald` / richmaupa@gmail.com / cell 0812191851 / ID 9003235671083 / Limpopo address), 5 activity_logs, 2 notifications, 0 documents.
- Broader test-pattern sweep (test/demo/sample/c24/dummy/delete/etc.) across leads/clients/deals/funder_invoices otherwise **clean** — this is the only residue.
- **Proposal (awaiting owner approval — read-only lane):** delete the orphan lead + its activity_logs + notifications in one txn. Owner to confirm before any DELETE.

### ⚠️ Edge Functions dashboard-delete follow-up (3 parked)
- `bulk-storage-cleanup` — **DELETED** (no longer present) ✓
- `pdflibtest` — **still ACTIVE** (needs dashboard delete)
- `ops-storage-remove` — **still ACTIVE** (needs dashboard delete)
- Legit functions live + correct: `send-notification-email` v12, `generate-invoice-pdf` v6, `sign-invoice-url` v2.

### ✅ C3 readiness verification (before BACK builds /partner-earnings) — read-only
Data model is query-ready; RLS + JOINs clean. Missing indexes are BACK's C3 build task (owner-directed), listed below.

**Indexes vs owner-side query patterns:**
- `commission_records`: ✅ partner filter (`idx_commission_records_referral_partner`). ❌ NO index on `status` (⚠️ note: commission uses **`status`**, not `state`). ❌ NO index on any date col (`earned_at`/`outstanding_at`/`payable_at`/`settled_at`). (Also has: deal_id, submission partial-unique, funder_invoice_id, partner_invoice_id.)
- `bonus_records`: ✅ partner filter (`idx_bonus_records_partner`). ✅ state filter (`idx_bonus_records_state`, col is **`state`**). ❌ NO index on any date col. (Also has: deal_id, submission, funder_invoice_id, dedup_uq.)
- Recommendation for BACK (not urgent at 0 rows): a composite partial `(referral_partner_id, status)` on commission + `(referral_partner_id, state)` on bonus serves the dominant "this partner's earnings by state" query; date-col indexes only if statements do date-range scans.

**RLS matrix — owner full visibility CONFIRMED:** both tables RLS-enabled. `*_owner_all` = cmd ALL, `USING is_owner()` / `WITH CHECK is_owner()`, role authenticated → owner can `SELECT *`. Partner path = `*_partner_read_own` SELECT `referral_partner_id = current_partner_id()`. Correct for /partner-earnings (owner-only).

**JOIN patterns — both execute cleanly, 0 rows, empty set handled (no error):**
- `commission_records cr JOIN deal_funder_submissions dfs ON cr.deal_funder_submission_id = dfs.id` → 0 rows ✓
- `bonus_records br JOIN deal_funder_submissions dfs ...` → 0 rows ✓

**⚠️ Two data-model correctness notes for BACK's C3 build (not perf):**
1. **Column-name asymmetry** — commission filters on `status`, bonus filters on `state`. Same enum (`commission_state`), different column name. The /partner-earnings query must use the right one per table.
2. **Nullable FK on bonus_records** — `bonus_records.deal_funder_submission_id` is **NULLABLE** (per-deal bonuses = NULL); `commission_records.deal_funder_submission_id` is **NOT NULL**. So an **INNER** JOIN of bonuses→submissions (the tested task-4 pattern) **silently drops per-deal bonuses**. BACK must **LEFT JOIN** bonuses→submissions (or join on `deal_id`), per the CLAUDE.md `!inner`/`!left` rule. Both tables carry `deal_id` natively, so the JOIN is only needed for submission-level fields — fetching `deal_id` needs no JOIN at all.

- IDLE, awaiting owner assignment. Last update: 2026-07-29 (Wed) ~21:30 SAST.
