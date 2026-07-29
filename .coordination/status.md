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

## NEW CC 2 — Data Hygiene
- Session: not yet started
- Task: CIPC correction drafts + Brighton/Flow48 audit + sequence check + test residue scan
- Blocked on: owner CIPC portal lookup + Brighton/Flow48 review decision
- Last update: N/A

## VERIFY — verification + cleanup + drift catching (branch claude/verification-cleanup-prep-dyps2t)
- Session start: 2026-07-29 (Wed) ~21:15 SAST. Read-only verification pass. NOT touching BACK/DATA/SCOPE lanes.

### ✅ ITEM 1 — C2.4 apply verification: PASS (already applied — migrations recorded 2026-07-29 19:06 + 19:08 UTC, in order)
- `bonus_records` table LIVE — all 17 cols per PR #86 (bonus_amount numeric(14,2) CHECK>0; state `commission_state` default 'earned'; earned/outstanding/payable/settled_at; funder_invoice_id FK; partner_invoice_id NO-FK; dedup unique index + 5 indexes).
- `BONUS_PAID` in BOTH enums: activity_event_type (order 20) + notification_event_type (order 30).
- 3 RPCs present, all SECURITY DEFINER / owner=postgres / search_path='' / return jsonb, signatures match spec, EXECUTE→authenticated only (revoked public+anon): `add_bonus(deal,sub,partner,amount,reason)`, `void_bonus(bonus,override,reason)`, `transition_bonus_record(bonus,to,funder_invoice)`.
- Lockstep cascade LIVE: `bonus_cascade_on_invoice_state` trigger enabled on **funder_invoices** (Decision D — separate trigger, NOT on commission_records; that's why the C2.3 commission cascade is untouched).
- Immutability LIVE: `bonus_records_immutable_when_settled` (BEFORE UPDATE) enabled; plus notify_bonus_paid, log_activity, set_updated_at.
- C4 stubs raise P0002: `settle_bonus_from_partner_invoice` + `unsettle_bonus_from_partner_invoice` (alongside commission `stub_settle/stub_unsettle_from_partner_invoice`).
- RLS: `bonus_records_owner_all` (is_owner) + `bonus_records_partner_read_own` (referral_partner_id=current_partner_id).
- **0 rows in bonus_records.** commission_state enum = earned/outstanding/payable/settled/void (5). **C2.4 fully verified clean.**

### ✅ ITEM 2 — Production data truth: clean except ONE residue finding
- 3 clients: Mama Mabase JV · fepa sechaba · NRL BAKWENA MINE. ✅
- 3 deals: DEAL-001 (stage `funded`, 3 submissions, **0 funded_subs** — confirms "Funded stage but NOT genuinely funded", matches CLAUDE.md) · DEAL-002 (qualifying) · DEAL-004 (qualifying). ✅
- 0 commission_records · 0 funder_invoices · 0 bonus_records. ✅
- `funder_invoices_seq`: last_value=32, is_called=false → next issue = **INV-0032, unused.** ✅
- ⚠️ **TEST RESIDUE — triage finding #1 was INCOMPLETE.** Lead **"reginald maupa"** (id `b7f40b31-d6ac-4b50-944e-5296ef0a634b`) still live: qualified 2026-07-22, self-referred, contact richmaupa@gmail.com / 0812191851 / CIPC 2025/985234/07. The deals (DEAL-011/012) were cleaned but the **source lead was left behind** in an orphaned `qualified`-with-0-deals state. Footprint: 0 deals/docs/stories/stakeholders/matching-clients; **5 activity_logs rows + 2 notifications**. Awaiting owner authorization to DELETE (read-only lane — no delete performed).

### ITEM 3 — Parked Edge Functions (dashboard-delete follow-up) — live status via management API
- `bulk-storage-cleanup` — ✅ already DELETED (absent from function list).
- `pdflibtest` — ⚠️ still **ACTIVE** (v6). Needs manual dashboard delete.
- `ops-storage-remove` — ⚠️ still **ACTIVE** (v2). Needs manual dashboard delete.

### Drift observation (OUTSIDE my assigned items — flagging only, not my lane)
- Migrations `stakeholders_b6_1` (20260720093535) + `qualify_lead_stakeholder_repointer` are in the applied-migration log, but ROADMAP marks **B6 as ⬜ not started**. Confirm whether B6.1 schema was applied ahead of documented order, or the docs need updating. Not investigated further.

- Last update: 2026-07-29 (Wed) ~21:15 SAST — VERIFY read-only pass complete; awaiting owner assignment / cleanup authorization.
