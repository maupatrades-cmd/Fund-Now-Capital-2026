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

## NEW CC 1 — Funder Billing Details Prep
- Session: not yet started
- Task: populate legal_name/billing_address/company_registration/vat_registration/accounts_email on funders rows for contracted funders
- Blocked on: owner providing real details per funder
- Last update: N/A

## NEW CC 2 — Data Hygiene
- Session: not yet started
- Task: CIPC correction drafts + Brighton/Flow48 audit + sequence check + test residue scan
- Blocked on: owner CIPC portal lookup + Brighton/Flow48 review decision
- Last update: N/A
