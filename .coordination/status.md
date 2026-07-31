# Agent Coordination Status

## FIX LANE — audit follow-up (2026-07-31, from `.coordination/full-system-audit-2026-08-01.md`)
Sequenced fixes of 5 audit findings, ONE PR at a time; owner merges each before the next. Do NOT merge — owner merges. Wait for Macroscope.
- **FIX #1 — Docs drift — ✅ MERGED (PR #92, 2026-07-31).** Docs-only. Reconciled funder count `21→23` (CLAUDE.md build-state, ROADMAP A1 annotation, SPEC S1 C0.3 `43+/21→43+/23`) and Polokwane address `75→73` (SPEC S16.3 + S7B.4 footer notes reflect the deployed v12 fix, docs/email-templates.md locked footer block). No code/DB changes.
- **FIX #2 — Lula + RM Capital rate cleanup — ✅ MERGED + APPLIED + VERIFIED LIVE (PR #93, 2026-07-31).** Migration `20260731120000_fix2_remove_noncontracted_funder_rate_structures.sql` removed `funder_commission_structures` rows for non-contracted funders per SPEC S1 C0.3. Applied to live 2026-07-31 18:32 UTC; verified: (1) rate rows 6→4, Lula+RM Capital=0; (2) post-condition holds — 0 non-contracted funders retain a rate row; (3) audit trail = 1 summary DELETE row (before-image array of both removed rows + S1 C0.3 rationale) + 2 per-row log_activity DELETE markers.
- **FIX #3 — Notification label/icon coverage — ✅ PR #94 OPEN (awaiting Macroscope + owner merge).** One file `src/lib/notifications.ts`. `notification_event_type` enum has 30 values; the file mapped only 17 labels + 9 icons → 13 events showed raw enum strings, 8 more fell back to Bell. Now: all 30 labelled (enum order, verified live) + all 30 iconned (13 newly-labelled + 8 labelled-but-Bell + 9 existing) + `eventIconClass()` colours extended (green money-in / teal positive / red negative / amber expiry-warning). Belt-and-braces fallbacks kept (raw string / Bell). Verified: `tsc -b && vite build` pass (all icons resolve on lucide-react 1.24.0), oxlint clean on file, scripted cross-check = 30 labels + 30 icons match enum exactly. Presentation-only, no DB/behaviour change.
- FIX #4–#5 — NOT STARTED (paused for owner approval to continue after each merge).

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
- **PR #89 — ✅ MERGED.** Branded empty state for `/leads` + new reusable `EmptyState` component (`src/components/ui/empty-state.tsx`). Filtered-empty vs first-run split.
- **PR #90 — OPEN (awaiting Macroscope + owner merge).** Branded empty state for `/clients` — reuses `EmptyState`, search-empty ("Clear search") vs first-run ("Add your first client"), lifted out of the table cell. Loading/error rows untouched. Visual-only, 1 code file, tsc+build+oxlint green.
- Note for other lanes: `EmptyState` (`src/components/ui/empty-state.tsx`) is the canonical empty-state primitive — reuse it, don't hand-roll "No X yet" text.
- Discrepancy flagged to owner: the briefing's `docs/proposals/f5-f6-ui-polish-scope-proposal.md` (Codex banked proposal) and `src/assets/fintech-spinner/` assets do NOT exist in this branch or origin/main. DESIGN lane is proceeding on the real live-code baseline instead.
- Queue: `/invoices` empty state APPROVED next (global CTA → `/pipeline?filter=funded`, verify param support first — else guidance-text-only). `/pipeline` empty column ON HOLD until BACK lands C3.
- Last update: 2026-07-29 (Wed).

## NEW CC 2 — Data Hygiene
- Session: not yet started
- Task: CIPC correction drafts + Brighton/Flow48 audit + sequence check + test residue scan
- Blocked on: owner CIPC portal lookup + Brighton/Flow48 review decision
- Last update: N/A
