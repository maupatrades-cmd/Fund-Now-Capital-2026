# Multi-Agent Coordination — Fund Now Capital CRM

> Shared session-state board. Each agent maintains ONLY its own section.
> NOTE (NEW CC 1, 2026-07-22): OLD CC 1's copy of this file was not visible in my
> isolated container (not on any branch, not pushed). I recreated it locally so I
> could maintain my section per task instructions. OLD CC 1 to reconcile / merge
> its section when it pushes.

---

## OLD CC 1 — C2.2 build (commission_records lifecycle)
_(placeholder — OLD CC 1 owns this section)_
- Building: `commission_records` reshape + `write_commission_record` RPC + funded-transition trigger.
- DO NOT TOUCH (per handover): `commission_records` table, `deals` schema,
  `write_commission_record` / `funder_rate_at` / `generate_funder_invoice` RPCs.

---

## NEW CC 1 — Funder Billing Details Prep (INVOICE TO block, C1.1 PDF)
**Status:** IN PROGRESS — prep/awaiting owner-provided values (no UPDATE run yet)
**Branch:** claude/invoice-c1-2-smoke-test-wbfvim
**Started:** 2026-07-22

**Task:** Populate 5 billing fields per contracted funder for C1.1's PDF `INVOICE TO`
block: `legal_name`, `billing_address`, `company_registration` (CIPC),
`vat_registration`, `accounts_email`. Owner supplies real values; I execute UPDATEs.

**Scope touched (only):** `funders` table data rows (via UPDATE), scratchpad drafts.
Does NOT touch anything in OLD CC 1's C2.2 zone.

**Findings (live query, 2026-07-22):**
- Reference (already done): **Pollen Finance** — all 5 fields populated.
- Contracted funders needing values (8, all 5 fields currently NULL):
  Better Banc · Bridgement · Brighton Capital · Business Partners · Flow48 ·
  GenFin · Merchant Capital · Sourcefin.
- ⚠️ Task listed **"Bright Rock"** as contracted — no such funder exists. Closest:
  **Brighton Capital** (contracted) + **Rockfin** (NOT contracted). Flagged to owner.
- ⚠️ **Brighton Capital** `short_code = "BRIGHT ON"` (has a space — looks malformed;
  ref format is spaceless e.g. POLLEN/MERCHANT). Not my field to fix — flagged to
  owner (aligns with the parked "Brighton Capital / Flow48 reconciliation" item).

**Deliverable:** `scratchpad/funder-billing-populate.sql` — template UPDATEs with
placeholders, one block per funder, keyed by funder `id` (immutable) with `name`
guard. Owner fills real values; NEW CC 1 executes after review.

**Blocked on:** owner-provided billing details per funder (5 fields × 8 funders).
