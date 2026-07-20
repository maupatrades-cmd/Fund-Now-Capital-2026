// Per-funder commission rate structures — TypeScript mirror of the DB enums +
// display helpers (C0.2 UI over the C0.1 `funder_commission_structures` table).
// Keep these enum lists in lockstep with the Postgres `deal_type` /
// `funder_rate_type` enums (migration 20260720130000). SPEC S7A.
import { formatZAR } from "@/lib/format";

// ---- deal_type (DB enum: 6 values, ordered) ---------------------------------
export type DealType =
  | "non_po"
  | "po"
  | "invoice_discounting"
  | "term_loan"
  | "bridging"
  | "other";

export const DEAL_TYPES: { value: DealType; label: string }[] = [
  { value: "non_po", label: "Non-PO (working capital)" },
  { value: "po", label: "Purchase order (PO)" },
  { value: "invoice_discounting", label: "Invoice discounting" },
  { value: "term_loan", label: "Term loan" },
  { value: "bridging", label: "Bridging" },
  { value: "other", label: "Other" },
];

export function dealTypeLabel(value: string | null): string {
  if (!value) return "—";
  return DEAL_TYPES.find((d) => d.value === value)?.label ?? value;
}

// ---- funder_rate_type (DB enum: 4 values) -----------------------------------
// percent_of_finance_charge added in C0.3 — Pollen Finance and similar funders
// pay FNC a % of the CLIENT's finance charge on the facility (not the funded
// amount). See migration 20260720140000.
export type FunderRateType =
  | "percent_of_gross_funded"
  | "percent_of_mdr"
  | "flat_rand_per_deal"
  | "percent_of_finance_charge";

export const RATE_TYPES: { value: FunderRateType; label: string }[] = [
  { value: "percent_of_gross_funded", label: "% of gross funded" },
  { value: "percent_of_finance_charge", label: "% of finance charge" },
  { value: "percent_of_mdr", label: "% of MDR" },
  { value: "flat_rand_per_deal", label: "Flat rand per deal" },
];

export function rateTypeLabel(value: string | null): string {
  if (!value) return "—";
  return RATE_TYPES.find((r) => r.value === value)?.label ?? value;
}

// A percent rate stores a 0..1 fraction (`rate_fraction`); a flat rate stores a
// rand amount (`flat_amount`). This drives which form field + formatter is used.
// percent_of_finance_charge is a percent rate (stored as rate_fraction).
export function isPercentRate(rateType: FunderRateType): boolean {
  return (
    rateType === "percent_of_gross_funded" ||
    rateType === "percent_of_mdr" ||
    rateType === "percent_of_finance_charge"
  );
}

// ---- payment_terms_days (C0.3) ----------------------------------------------
// 0 = "Due on receipt" (no due date; skipped by the C1 overdue sweep); N = net-N.
export const PAYMENT_TERMS_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: "Due on receipt" },
  { value: 7, label: "7 days" },
  { value: 14, label: "14 days" },
  { value: 30, label: "30 days" },
  { value: 45, label: "45 days" },
  { value: 60, label: "60 days" },
];

export function paymentTermsLabel(days: number | null | undefined): string {
  if (days === null || days === undefined || days === 0) return "Due on receipt";
  return `${days} day${days === 1 ? "" : "s"} from invoice date`;
}

// ---- display -----------------------------------------------------------------
// Format a 0..1 fraction as a percentage, keeping up to 2 decimals (0.085 → "8.5%",
// 0.08 → "8%"). Unlike funders.ts `pct()` which rounds to whole percent.
export function formatRatePercent(fraction: number | string | null | undefined): string {
  if (fraction === null || fraction === undefined || fraction === "") return "—";
  const n = typeof fraction === "string" ? Number(fraction) : fraction;
  if (!Number.isFinite(n)) return "—";
  const pctValue = n * 100;
  // trim trailing zeros: 8.50 → "8.5", 8.00 → "8"
  const rounded = Math.round(pctValue * 100) / 100;
  return `${rounded}%`;
}

// The single "rate" cell — routes on rate_type to the right column + formatter.
export function formatRateValue(row: {
  rate_type: FunderRateType;
  rate_fraction: number | string | null;
  flat_amount: number | string | null;
}): string {
  return isPercentRate(row.rate_type)
    ? formatRatePercent(row.rate_fraction)
    : formatZAR(row.flat_amount, { cents: true });
}

// ---- the row shape (mirror of funder_commission_structures) ------------------
export type RateStructure = {
  id: string;
  funder_id: string;
  deal_type: DealType;
  rate_type: FunderRateType;
  rate_fraction: number | string | null;
  flat_amount: number | string | null;
  effective_from: string; // date (ISO)
  effective_to: string | null; // date | null (null = active/open-ended)
  contract_clause_ref: string | null;
  // C0.3: payment terms (0 = due on receipt) + the human agreement reference
  // that flows onto the C1 invoice ("Lead Provider Agreement dated 28 April 2026").
  payment_terms_days: number;
  contract_reference: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

// Insert/update payload — money/rate coerced to number|null, one set per rate_type.
export type RateStructureInput = {
  funder_id: string;
  deal_type: DealType;
  rate_type: FunderRateType;
  rate_fraction: number | null;
  flat_amount: number | null;
  effective_from: string;
  effective_to: string | null;
  contract_clause_ref: string | null;
  payment_terms_days: number;
  contract_reference: string | null;
  notes: string | null;
};

// A structure with no effective_to is the currently-active one for its
// (funder, deal_type). The DB exclusion constraint enforces at most one.
export function isActive(row: RateStructure): boolean {
  return row.effective_to === null;
}
