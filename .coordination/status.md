# Agent Coordination Status

## AUDIT-FIX LANE — full system audit + sequenced fixes (2026-07-31)
- **Audit ✅ COMPLETE — `AUDIT.md`** (on branch `claude/fnc-crm-audit-fix-n48rvm`, awaiting owner merge). Read-only inventory of live `hvxruwkgmhjoypepffgv`: 29 tables/RLS/triggers/row counts, DEFINER RPC matrix (locks/idempotency/state guards/grants), Edge Functions, pg_cron (all green), routes, action buttons, notification events, commission-logic sites, advisors. **No blockers.** It supersedes the never-committed `.coordination/full-system-audit-2026-08-01.md` this file previously cited.
- **Owner-approved fix order: FIX-C (docs) → FIX-A (grants migration) → FIX-B (notification prefs matrix).** One PR each, fresh main, Macroscope, owner merges.
- **FIX-C — docs reconciliation — 🔨 THIS PR** (`claude/fix-c-docs-reconcile`): CLAUDE.md build-state + ROADMAP checkmarks + SPEC S4 list + this file to live truth through PR #93 merged / #94 open.
- **FIX-A — queued.** Precondition (owner-set): search src/ for any RPC caller depending on anon access before revoking; flag any in the scope proposal. Includes `leads_qualification_guard` search_path pin.
- **FIX-B — queued.** Extend `src/lib/notifications.ts` to all 30 event types (labels/icons/colours + prefs matrix). **Coordinate with PR #94 (open, `claude/fix-3-notification-icons`)** — same file/territory; FIX-B builds on it after it lands.
- After all 3: separate scope proposal for the two S7C compliance items (flat-40% PO scope, R1M+ tier). **No commission-math change without explicit owner sign-off.**
- Owner-side dashboard tasks (no PR): leaked-password protection toggle; `short_code` for Business Partners + Better Banc; delete inert `pdflibtest` + `ops-storage-remove` Edge Functions. Architectural flag (Phase D planning): the 4 `partner_*` SECURITY DEFINER views.
- Last update: 2026-07-31 — FIX-C in flight.

## FIX LANE — audit follow-up (2026-07-31) — historical, folded into AUDIT-FIX lane above
Sequenced fixes, ONE PR at a time; owner merges each before the next. Do NOT merge — owner merges. Wait for Macroscope.
- **FIX #1 — Docs drift — ✅ MERGED (PR #92, 2026-07-31).** Docs-only. Reconciled funder count `21→23` (CLAUDE.md build-state, ROADMAP A1 annotation, SPEC S1 C0.3 `43+/21→43+/23`) and Polokwane address `75→73` (SPEC S16.3 + S7B.4 footer notes reflect the deployed v12 fix, docs/email-templates.md locked footer block). No code/DB changes.
- **FIX #2 — Lula + RM Capital rate cleanup — ✅ MERGED (PR #93) + APPLIED + VERIFIED LIVE (2026-07-31 audit spot-check: `funder_commission_structures` = exactly 4 rows, all `is_contracted=true` — Business Partners / Flow48 / Merchant Capital / Pollen).**
- **FIX #3 — notification event labels/icons — PR #94 OPEN** (`claude/fix-3-notification-icons`, awaiting Macroscope + owner merge).
- FIX #4–#5 — not started (sequencing now governed by the AUDIT-FIX lane above).

## OLD CC 1 — C2 Backend — ✅ CLOSED OUT (handover items all resolved as of 2026-07-31)
- Session: 2026-07-22 → 2026-07-27. C2.1/C2.2/C2.3 MERGED + APPLIED + verified live.

### ✅ RESOLVED — C2.4 applied (was "next session's first job")
- **PR #86 (C2.4) — MERGED + BOTH MIGRATIONS APPLIED IN ORDER + VERIFIED LIVE** (audit spot-check 2026-07-31): `bonus_records` table live with lifecycle triggers, `BONUS_PAID` present in both `activity_event_type` and `notification_event_type`, 0 rows, no leaked test deals.

### ✅ PR #87 (docs) — MERGED
- CLAUDE.md DEAL-001 correction (Funded stage but NOT genuinely funded; commission_records legitimately 0 rows; never backfill from notes).

### 6 triage findings — status (2026-07-31)
1. Test residue (DEAL-011/012 "reginald maupa") — **DONE** (owner cleaned).
2. Stale docs PRs #64/#39/#29 — **STILL OPEN**, recommend close/renumber (#64's "S7B" label clashes with merged #81's S7B).
3. BONUS_PAID (+ missing event) frontend mapping in src/lib/notifications.ts — **PR #94 OPEN**; full 30-event coverage lands as audit FIX-B after #94.
4. Email footer 75→73 Marshall St — **DONE via PR #84** (merged; v12 deployed + verified).
5. G7 commission-engine reconciliation — **OPEN, promoted to Open Decision 3** (CLAUDE.md/ROADMAP): (a) flat-40% for ALL PO deals vs S7C Sourcefin-only; (b) R1M+ tier 25% in-code vs "TBD" in S7C. Separate scope proposal after audit FIX-A/B/C; no engine change without owner sign-off.
6. DEAL-001 at kanban "Funded" but not genuinely funded — **OWNER JUDGMENT, still open** (move back vs progress properly). Money layer already ignores it correctly.

### C3 — 🔨 PARTIAL (updated 2026-07-31)
- **Owner-side `/partner-earnings` reconciliation view MERGED (PR #91).** Remaining C3: the S8 `doctor_earnings` lifecycle (earned → ready_to_invoice → invoiced → paid) + statements plumbing; P0002 settle/unsettle stubs wire up when C4 builds partner_invoices. Respect SPEC S7C presentation policy (Doctor sees only his Rands, 50/50 framing) + S8. Same rhythm: schema-verify → scope proposal → owner OK → build → PR → owner merges.

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
