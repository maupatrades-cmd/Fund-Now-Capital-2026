// Owner-side Commission Picker — shared vocabulary, jsonb shape, and the
// client-side estimated-gross calculation (PICKER.md).
//
// The picker captures HOW Fund Now Capital earns from a funder on a given deal.
// The owner picks four dimensions at fund-time:
//   A: calculation base (1 of 8)   B: tier modifiers (0–2)
//   C: timing model (1)            D: special adjustments (0–N)
// plus an attribution (who the deal belongs to) — and the commission moves
// POTENTIAL → PENDING → LOCKED via the PICKER-BACKEND state RPCs.
//
// The `base` / `timing` / `tier_modifiers` / `adjustments` / `rate` fields mirror
// EXACTLY what the DB's validate_commission_calculation() enforces (base ∈ the 8
// canonical tokens; rate a JSON number for the five percent bases; the two arrays
// contain only strings). `inputs` + `attribution` are extra keys the validator
// ignores — they carry the owner's raw entries and the deal ownership so the
// selection round-trips and stays forward-compatible with the tier engine.
//
// Rate convention: `rate` is a WHOLE-NUMBER PERCENT (10 = 10%), matching the DB
// calc helpers (which divide by 100). Money is Rands, numeric(14,2).

// ---- Section A: calculation base -----------------------------------------
// Tokens MUST match public.validate_commission_calculation()'s allow-list.
export type CalcBase =
  | "percent_of_gross_funded"
  | "percent_of_finance_charge"
  | "percent_of_revenue_collected"
  | "percent_of_mdr"
  | "percent_of_client_interest"
  | "points_margin"
  | "flat_rand_per_deal"
  | "owner_override";

export type CalcBaseMeta = {
  value: CalcBase;
  label: string;
  hint: string;
  // Which raw inputs this base consumes:
  //  - "percent": a rate (%) + a base amount (R)  → rate% × base amount
  //  - "points":  a sell rate + a buy rate + a facility amount (R)
  //  - "amount":  a single R amount (flat / owner override)
  kind: "percent" | "points" | "amount";
  // Label for the base-amount / single-amount field.
  amountLabel: string;
};

export const CALC_BASES: CalcBaseMeta[] = [
  {
    value: "percent_of_gross_funded",
    label: "Percent of gross funded",
    hint: "rate × facility amount",
    kind: "percent",
    amountLabel: "Gross funded / facility amount (R)",
  },
  {
    value: "percent_of_finance_charge",
    label: "Percent of finance charge",
    hint: "rate × total fee to client — Pollen model",
    kind: "percent",
    amountLabel: "Finance charge (R)",
  },
  {
    value: "percent_of_revenue_collected",
    label: "Percent of revenue collected",
    hint: "rate × merchant paybacks — Merchant Capital model",
    kind: "percent",
    amountLabel: "Revenue collected (R)",
  },
  {
    value: "percent_of_mdr",
    label: "Percent of MDR",
    hint: "rate × card processing fee",
    kind: "percent",
    amountLabel: "Merchant discount rate base (R)",
  },
  {
    value: "percent_of_client_interest",
    label: "Percent of client interest",
    hint: "rate × interest earned by lender — Bright On model",
    kind: "percent",
    amountLabel: "Client interest (R)",
  },
  {
    value: "points_margin",
    label: "Points (buy vs sell rate)",
    hint: "sell − buy margin applied to the advance — MCA structure",
    kind: "points",
    amountLabel: "Advance / facility amount (R)",
  },
  {
    value: "flat_rand_per_deal",
    label: "Flat rand per deal",
    hint: "an agreed flat commission",
    kind: "amount",
    amountLabel: "Flat commission (R)",
  },
  {
    value: "owner_override",
    label: "Per-deal owner override",
    hint: "type the exact commission amount",
    kind: "amount",
    amountLabel: "Exact commission amount (R)",
  },
];

export const CALC_BASE_BY_VALUE: Record<CalcBase, CalcBaseMeta> = Object.fromEntries(
  CALC_BASES.map((b) => [b.value, b]),
) as Record<CalcBase, CalcBaseMeta>;

// ---- Section B: tier modifiers (0–2) -------------------------------------
export type TierModifier =
  | "flexible_range"
  | "first_vs_subsequent"
  | "volume_tier"
  | "client_interest_driven"
  | "referred_channel_tier";

export const TIER_MODIFIERS: { value: TierModifier; label: string; hint: string }[] = [
  { value: "flexible_range", label: "Flexible range", hint: "e.g. 8–10% deal-negotiated" },
  { value: "first_vs_subsequent", label: "First vs subsequent", hint: "new client vs repeat" },
  { value: "volume_tier", label: "Volume tier", hint: "R500k / R1m / R1m+ bands" },
  { value: "client_interest_driven", label: "Client-interest-driven", hint: "Bright On style" },
  { value: "referred_channel_tier", label: "Referred channel tier", hint: "lower % if sub-referred" },
];

export const MAX_TIER_MODIFIERS = 2;

// ---- Section C: timing model (pick 1) ------------------------------------
export type Timing = "upfront_at_funding" | "recurring_monthly" | "residual_on_renewal";

export const TIMINGS: { value: Timing; label: string; hint: string }[] = [
  { value: "upfront_at_funding", label: "Upfront at funding", hint: "90% of MCA / business finance" },
  { value: "recurring_monthly", label: "Recurring monthly", hint: "Bright On 12-month term" },
  { value: "residual_on_renewal", label: "Residual on renewal", hint: "MCA repeat advances" },
];

// ---- Section D: special adjustments (0–N) --------------------------------
export type Adjustment =
  | "clawback_clause"
  | "vat_inclusive"
  | "client_side_fee"
  | "retention_split"
  | "cap_ceiling"
  | "weekly_payment_run";

export const ADJUSTMENTS: { value: Adjustment; label: string; hint: string }[] = [
  { value: "clawback_clause", label: "Clawback clause", hint: "reversal if client defaults within 30 days" },
  { value: "vat_inclusive", label: "VAT inclusive", hint: "rate already contains VAT" },
  { value: "client_side_fee", label: "Client-side fee", hint: "client pays separately; funder doesn't pay FNC" },
  {
    value: "retention_split",
    label: "Retention split (40% company / 60% partner pool)",
    hint: "only meaningful for a partner-attributed deal — applied downstream, not in gross",
  },
  { value: "cap_ceiling", label: "Cap / ceiling", hint: "max R commission per deal" },
  { value: "weekly_payment_run", label: "Weekly payment run", hint: "Merchant Capital's Tue → Thu cadence" },
];

// ---- Attribution ---------------------------------------------------------
export type AttributionType = "direct_fnc" | "fnc_contractor" | "bright_destiny_partner";

export const ATTRIBUTION_TYPES: { value: AttributionType; label: string; hint: string }[] = [
  { value: "direct_fnc", label: "Direct FNC", hint: "won directly by Fund Now Capital" },
  { value: "fnc_contractor", label: "FNC contractor", hint: "sourced by an internal contractor" },
  { value: "bright_destiny_partner", label: "Bright Destiny partner", hint: "referred by a partner" },
];

export type Attribution = {
  type: AttributionType;
  contractor_id?: string | null;
  partner_id?: string | null;
};

// ---- The stored jsonb shape (deal_commissions.commission_calculation) -----
export type CommissionCalculation = {
  base: CalcBase;
  rate?: number | null; // whole-number percent; required for the 5 percent bases
  timing: Timing;
  tier_modifiers: TierModifier[];
  adjustments: Adjustment[];
  inputs: {
    base_amount?: number | null; // R base for percent / flat / override bases
    sell_rate?: number | null; // points base
    buy_rate?: number | null; // points base
    cap?: number | null; // cap_ceiling adjustment
  };
  attribution: Attribution;
};

// ---- Estimated gross (mirrors the DB calc helpers) -----------------------
// Half-away-from-zero to 2 dp, matching Postgres round(numeric, 2).
//
// Postgres rounds exact decimal half-cents away from zero (round(1.005, 2) =
// 1.01). A naive `Math.round(n * 100) / 100` disagrees at those boundaries
// because the IEEE-754 product lands just below the .5 tick (1.005 * 100 =
// 100.49999999999999 → rounds to 100 → 1.00). Nudging the scaled value up by a
// magnitude-relative epsilon restores the intended half — the nudge is many
// orders smaller than a cent at any realistic money magnitude, so non-boundary
// values are unaffected.
export function round2(n: number): number {
  if (!Number.isFinite(n)) return n;
  const sign = n < 0 ? -1 : 1;
  const scaled = Math.abs(n) * 100;
  return (sign * Math.round(scaled * (1 + Number.EPSILON))) / 100;
}

// Compute the estimated FNC gross commission (Rands) from the picker selection.
// Returns null when the required inputs for the chosen base aren't present yet
// (so the preview reads "—" rather than a misleading R0). The `cap_ceiling`
// adjustment clamps the result; every other adjustment is downstream of gross
// (VAT/retention/clawback/etc.) and does NOT change this number.
export function estimateGross(calc: {
  base: CalcBase;
  rate?: number | null;
  adjustments: Adjustment[];
  inputs: CommissionCalculation["inputs"];
}): number | null {
  const { base, rate, inputs } = calc;
  const meta = CALC_BASE_BY_VALUE[base];
  let gross: number | null = null;

  if (meta.kind === "percent") {
    const amount = numOrNull(inputs.base_amount);
    const r = numOrNull(rate);
    if (amount != null && r != null) gross = round2((amount * r) / 100);
  } else if (meta.kind === "points") {
    const sell = numOrNull(inputs.sell_rate);
    const buy = numOrNull(inputs.buy_rate);
    const facility = numOrNull(inputs.base_amount);
    if (sell != null && buy != null && facility != null) {
      gross = round2(((sell - buy) / 100) * facility);
    }
  } else {
    // flat / owner override — the single amount IS the gross.
    gross = numOrNull(inputs.base_amount);
    if (gross != null) gross = round2(gross);
  }

  if (gross == null) return null;

  if (calc.adjustments.includes("cap_ceiling")) {
    const cap = numOrNull(inputs.cap);
    if (cap != null && gross > cap) gross = round2(cap);
  }
  return gross;
}

function numOrNull(v: number | string | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

// ---- Lifecycle state -----------------------------------------------------
export type CommissionState = "potential" | "pending" | "locked";

export type DealCommissionState = {
  deal_id: string;
  reference: string | null;
  commission_calculation: CommissionCalculation | null;
  commission_state: CommissionState | null; // null = no picker configured yet
  estimated_gross_commission: string | number | null;
  actual_gross_commission: string | number | null;
  commission_locked_at: string | null;
  commission_locked_by: string | null;
};

// Human labels for the vocabulary tokens (for the read-only locked summary).
export function labelForBase(v: CalcBase): string {
  return CALC_BASE_BY_VALUE[v]?.label ?? v;
}
export function labelForTiming(v: string): string {
  return TIMINGS.find((t) => t.value === v)?.label ?? v;
}
export function labelForTierModifier(v: string): string {
  return TIER_MODIFIERS.find((t) => t.value === v)?.label ?? v;
}
export function labelForAdjustment(v: string): string {
  return ADJUSTMENTS.find((a) => a.value === v)?.label ?? v;
}
export function labelForAttribution(v: string): string {
  return ATTRIBUTION_TYPES.find((a) => a.value === v)?.label ?? v;
}
