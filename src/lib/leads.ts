// Lead enums, option lists, and validation helpers (SPEC S2 / B2.1).
// Kept out of the page components so the same option sets drive the form, the
// list filters, and the detail view.

export type Option<T extends string = string> = { value: T; label: string };

export const ENTITY_TYPES: Option[] = [
  { value: "pty_ltd", label: "Pty Ltd" },
  { value: "cc", label: "Close Corporation" },
  { value: "sole_prop", label: "Sole Proprietor" },
  { value: "trust", label: "Trust" },
  { value: "partnership", label: "Partnership" },
  { value: "ngo", label: "NGO" },
  { value: "other", label: "Other" },
];

export const EMPLOYEE_RANGES: Option[] = [
  { value: "1-5", label: "1–5" },
  { value: "6-20", label: "6–20" },
  { value: "21-50", label: "21–50" },
  { value: "51-200", label: "51–200" },
  { value: "200+", label: "200+" },
];

export const TURNOVER_RANGES: Option[] = [
  { value: "<50k", label: "< R50k" },
  { value: "50-100k", label: "R50k–100k" },
  { value: "100-250k", label: "R100k–250k" },
  { value: "250-500k", label: "R250k–500k" },
  { value: "500k-1m", label: "R500k–1m" },
  { value: "1-2.5m", label: "R1m–2.5m" },
  { value: "2.5-5m", label: "R2.5m–5m" },
  { value: "5m+", label: "R5m+" },
];

export const FUNDING_TIMELINES: Option[] = [
  { value: "urgent_7d", label: "Urgent (7 days)" },
  { value: "30d", label: "Within 30 days" },
  { value: "90d", label: "Within 90 days" },
  { value: "flexible", label: "Flexible" },
];

export const FUNDING_PURPOSES: Option[] = [
  { value: "stock", label: "Stock" },
  { value: "equipment", label: "Equipment" },
  { value: "working_capital", label: "Working capital" },
  { value: "expansion", label: "Expansion" },
  { value: "bridging", label: "Bridging" },
  { value: "debt_consolidation", label: "Debt consolidation" },
  { value: "property", label: "Property" },
  { value: "vehicles", label: "Vehicles" },
  { value: "other", label: "Other" },
];

export const SECURITY_OPTIONS: Option[] = [
  { value: "property_res", label: "Residential property" },
  { value: "property_comm", label: "Commercial property" },
  { value: "property_agri", label: "Agricultural property" },
  { value: "vehicles", label: "Vehicles" },
  { value: "equipment", label: "Equipment" },
  { value: "livestock", label: "Livestock" },
  { value: "stock", label: "Stock" },
  { value: "invoices_receivables", label: "Invoices / receivables" },
  { value: "contract_cession", label: "Contract cession" },
  { value: "suretyship", label: "Suretyship" },
  { value: "none", label: "None" },
];

export const REFERRED_BY: Option[] = [
  { value: "self", label: "Self (direct)" },
  { value: "bright_destiny", label: "Bright Destiny" },
  { value: "other", label: "Other" },
];

export const QUALIFICATION_STAGES: Option[] = [
  { value: "new_lead", label: "New lead" },
  { value: "under_qualification", label: "Under qualification" },
  { value: "qualified", label: "Qualified" },
  { value: "not_qualified", label: "Not qualified" },
];

// Colour-coded badge classes per qualification stage (matches the app's pill style).
export const QUALIFICATION_BADGE: Record<string, string> = {
  new_lead: "bg-slate-100 text-slate-600 ring-slate-500/20",
  under_qualification: "bg-teal-50 text-teal-700 ring-teal-600/20",
  qualified: "bg-green-50 text-green-700 ring-green-600/20",
  not_qualified: "bg-red-50 text-red-700 ring-red-600/20",
};

// The 15 standard not-qualified reasons (registered in B2.1; the qualification
// workflow that uses them lands in B2.2).
export const NOT_QUALIFIED_REASONS: Option[] = [
  { value: "no_cipc", label: "No CIPC registration" },
  { value: "trading_history_too_short", label: "Trading history too short" },
  { value: "turnover_too_low", label: "Turnover too low" },
  { value: "sector_not_serviced", label: "Sector not serviced" },
  { value: "over_leveraged", label: "Over-leveraged" },
  { value: "bank_statement_issues", label: "Bank statement issues" },
  { value: "client_unresponsive", label: "Client unresponsive" },
  { value: "unrealistic_expectations", label: "Unrealistic expectations" },
  { value: "already_declined_by_likely_funders", label: "Already declined by likely funders" },
  { value: "no_security_for_asset_needs", label: "No security for asset needs" },
  { value: "timing_not_right", label: "Timing not right" },
  { value: "sector_risk_too_high", label: "Sector risk too high" },
  { value: "documentation_impossible", label: "Documentation impossible" },
  { value: "compliance_concern", label: "Compliance concern" },
  { value: "other", label: "Other" },
];

export function labelFor(options: Option[], value: string | null | undefined): string {
  if (!value) return "—";
  return options.find((o) => o.value === value)?.label ?? value;
}

// ---- Validation helpers (frontend only; DB stores raw text) ----

// CIPC registration number: YYYY/NNNNNN/NN.
export const CIPC_REGEX = /^\d{4}\/\d{6}\/\d{2}$/;

// SA cell: 0 or +27 prefix, then 6/7/8, then 8 digits. Accepts spaces.
const SA_CELL_REGEX = /^(?:\+?27|0)[678]\d{8}$/;

export function isValidSaCell(raw: string): boolean {
  return SA_CELL_REGEX.test(raw.replace(/[\s-]/g, ""));
}

// Normalise a valid SA cell to local 0XXXXXXXXX form for storage.
export function normaliseSaCell(raw: string): string {
  const digits = raw.replace(/[\s-]/g, "").replace(/^\+/, "");
  if (digits.startsWith("27")) return "0" + digits.slice(2);
  return digits;
}

// SA ID: 13 digits (structural only — Luhn check is B5).
export const SA_ID_REGEX = /^\d{13}$/;
