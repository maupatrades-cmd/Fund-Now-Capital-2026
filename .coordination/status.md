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
- ✅ RESOLVED (owner, 2026-07-22): **"Bright Rock" = Brighton Capital.** Rockfin is
  unrelated + not contracted. Brighton Capital is the 6th of the 8 to populate.
- ✅ DONE (owner-approved, executed 2026-07-22): **Brighton Capital `short_code`
  fix.** `"BRIGHT ON"` → `BRIGHTON` (1 row, RETURNING-verified). Payment reference now
  renders cleanly (e.g. `BRIGHTON-INV0032-<CLIENT>`). This was the only live write so
  far; the 5 INVOICE TO billing fields remain pending owner values.

**Deliverable:** `scratchpad/funder-billing-populate.sql` — template UPDATEs with
placeholders, one block per funder, keyed by funder `id` (immutable) with `name`
guard. Owner fills real values; NEW CC 1 executes after review.

**Progress — billing fields populated (owner-provided values):**
- ✅ **Merchant Capital** (2026-07-22): legal_name `Merchant Capital (Pty) Ltd`
  (owner best-guess — verify vs invoice header) · billing_address `32 Impala Road,
  Chislehurston, Johannesburg 2196, South Africa` · CIPC `2012/217256/07` ·
  vat_registration `NULL` (PENDING owner confirm) · accounts_email
  `info@merchantcapital.co.za` (general — may swap for AP/finance inbox). 1 row,
  RETURNING-verified.
  - 📌 phone `+27 11 217 2880` from contract — **no `phone` column on funders**;
    skipped per owner "Otherwise skip". Value preserved here. Owner to decide whether
    to add a nullable `phone` column (schema change) — not part of INVOICE TO block.

**Still blocked on:** owner values for the remaining 7 funders (Bridgement, Sourcefin,
GenFin, Better Banc, Brighton Capital, Flow48, Business Partners) + Merchant Capital
VAT confirmation.
