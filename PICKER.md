# Fund Now Capital — Owner-Side Commission Picker Concept

## Document Purpose

Canonical reference for the flexible commission picker that lives on every
deal in the owner backend. This picker captures how Fund Now Capital
actually earns from each funder — because real funders pay in different,
dynamic ways that cannot be locked to a fixed rate per funder.

## Real Business Truth

Funders pay Fund Now Capital in different ways per deal:

- **AAA Consortium** — 8-10% flexible, deal-dependent
- **Bright On** — depends on client's interest rate
- **Pollen** — 6-25% depending on client-specific terms
- **Merchant Capital** — 10% of Revenue first advance, 5% subsequent
- **Flow48** — 2.5% new / 2.0% repeat
- **FundRock** — invoice discounting 11.8% for 12 months, partner may earn only on first disbursement
- **Sourcefin PO** — 15-30% charge to client, decided by deal manager

**Rates change:** Merchant Capital was 3%, now 5%. Real business truth
is dynamic, not static.

**Owner cannot know exact final payout until deal completes.**

## The Picker (owner-facing UI, on every deal)

**At fund-time on a deal, owner picks 4 dimensions:**

### Section A: Calculation Base (pick 1 of 8)

1. Percent of gross funded (rate × facility amount)
2. Percent of finance charge (rate × total fee to client) — Pollen model
3. Percent of revenue collected (rate × merchant paybacks) — Merchant Capital model
4. Percent of MDR (rate × card processing fee)
5. Percent of client interest (rate × interest earned by lender) — Bright On model
6. Points (buy vs sell rate) — MCA structure globally
7. Flat rand per deal
8. Per-deal owner override — Thapelo types exact commission R amount

### Section B: Tier Modifier (pick 0 to 2)

1. Flexible range (e.g. 8-10% deal-negotiated)
2. First vs subsequent (new client vs repeat) — Merchant Capital, Flow48
3. Volume tier (R500k / R1m / R1m+ bands)
4. Client-interest-driven (Bright On style)
5. Referred channel tier (lower % if sub-referred)

### Section C: Timing Model (pick 1)

1. Upfront at funding (90% of MCA/business finance)
2. Recurring monthly (Bright On 12-month term commissions)
3. Residual on renewal (MCA repeat advances)

### Section D: Special Adjustments (pick 0 to N)

1. Clawback clause (reversal if client defaults within 30 days)
2. VAT inclusive (rate already contains VAT) — Merchant Capital
3. Client-side fee (Centrafin: client pays separately, funder doesn't pay FNC)
4. Retention split (40% company / 60% partner pool)
5. Cap / ceiling (max R commission per deal)
6. Weekly payment run (Merchant Capital's Tuesday 4pm → Thursday cadence)

## Commission Lifecycle States

Each deal's commission moves through 3 states:

### State 1: POTENTIAL

- Owner has picked A + B + C + D at fund-time
- System calculates estimated commission
- **Editable** — owner can update as reality changes (rate goes 3% → 5%, deal terms shift)
- System recalculates instantly on edit
- Partner (Doctor / contractor) sees "Potential Earning: R X"
- Never a locked promise

### State 2: PENDING

- Funder invoice issued
- Waiting for funder to pay FNC
- Still editable if funder disputes amount

### State 3: LOCKED

- Funder has paid FNC actual amount
- Owner enters final actual figure
- System locks it → immutable
- Locked figure flows into partner invoice to FNC (Doctor's C4 invoicing)
- Partner sees "Confirmed Earning: R X" (was "Potential")

## Partner View Rules

**Doctor + contractors see ONLY:**
- "Potential Earning: R X" (during POTENTIAL + PENDING states)
- "Confirmed Earning: R X" (during LOCKED state)
- Anonymized funder name (per fictional name mapping)
- NEVER see: real funder name, real calculation base, tier logic, or FNC's gross

**Owner sees ALL:**
- Real funder name
- Full picker output (A + B + C + D breakdown)
- Real FNC gross
- Partner's share after 40/60 split (Doctor) or tier lookup (contractor)

## Real Coexistence with Existing Money Engine

**The commission picker OUTPUTS the FNC gross commission amount, which the
existing C2 money engine already handles:**

- Picker output → `commission_records.gross_commission_amount`
- Existing C2.2 `write_commission_record` writes the record
- Existing C2.3 state triggers cascade (Earned → Outstanding → Payable → Settled)
- Existing 40/60 split logic applies as-is
- Existing bonus_records (C2.4) apply as-is

**Real: picker is UPSTREAM of the money engine. Money engine unchanged.**

## Duplicate Protection

**The picker's LOCK operation must be:**
- Idempotent at DB layer (advisory lock on commission_record + state guard)
- Button-disable-on-click at UI layer
- Owner cannot re-lock a locked record without typed OVERRIDE + reason
- All lock/unlock operations write audit_log entry

## Real Example Flow

1. Client: Chickanos, R400k facility, Pollen
2. Owner opens deal → picks A: Percent of finance charge / C: Upfront / D: VAT inclusive / rate: 10%
3. Owner enters finance charge: R140,000
4. **POTENTIAL state:** System calculates R14,000 FNC gross
5. Doctor referred deal → tier (R0-R80k) = 29% of 60% partner pool = R2,436 potential earning to Doctor
6. Doctor sees "Potential Earning: R2,436" in his portal (anonymized funder)
7. Funder invoice issued → deal moves to PENDING
8. Pollen pays FNC R14,000 → owner enters actual R14,000 → LOCKED
9. Doctor now sees "Confirmed Earning: R2,436" — proceeds to C4 invoicing

## Build Notes for Engineering

- Picker UI lives on Deal Detail Page (owner view only)
- Data model: `deal.commission_calculation` field capturing owner's picks (jsonb structure: `{base, rate, tier_modifiers, timing, adjustments}`)
- POTENTIAL state uses estimated_gross_commission
- LOCKED state populates commission_records.gross_commission_amount via existing write_commission_record RPC
- Partner UI shows only Potential/Confirmed with anonymized funder name
- Owner UI shows full picker + real funder name

## Standing Rules

- Money numeric(14,2)
- Percentages numeric(10,4)
- Money-state transitions idempotent + lock-protected at DB layer
- Belt-and-braces DEFINER + grant matrix on any new RPC
- Picker changes write to activity_log
- Real POPIA compliance: partners never see other partners' or Direct FNC deals
