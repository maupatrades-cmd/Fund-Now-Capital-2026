// B3.1 Document taxonomy — the client-side mirror of the DB enums and helper
// functions in migration 20260717130000_document_management_b3_1.sql.
//
// Single source of truth on the client for: the 52 document types, their 8
// categories (+ `other`), which types are period-scoped, which carry structured
// client PII (partner-excluded), default expiry rules, and expiry status. Keep
// this in lockstep with the DB — the DB stays authoritative (RLS, generated
// `category`/`is_period_scoped`, the versioning trigger); this file is for
// labels, grouping, and pre-fill only.

export type DocumentCategory =
  | "business"
  | "financial"
  | "personal"
  | "deal"
  | "asset"
  | "compliance"
  | "funder_comms"
  | "fnc_business"
  | "other";

export type DocumentType =
  | "cipc_cert" | "company_profile" | "tax_clearance" | "bee_cert" | "moi"
  | "trading_license" | "shareholder_register" | "director_appointment"
  | "bank_statement" | "financial_statements" | "mgmt_accounts" | "debtors_ageing"
  | "creditors_ageing" | "cashflow_projection" | "budget"
  | "id_copy" | "proof_of_address" | "anc_contract" | "personal_financials"
  | "spousal_consent" | "marriage_cert"
  | "application_form" | "credit_consent" | "purchase_order" | "cession" | "suretyship"
  | "personal_guarantee" | "business_plan" | "quotation" | "invoice_doc"
  | "natis" | "vehicle_license" | "title_deed" | "valuation_report"
  | "equipment_schedule" | "livestock_inventory"
  | "fica_pack" | "popia_consent" | "source_of_funds" | "tax_residency"
  | "approval_letter" | "decline_letter" | "offer_letter" | "term_sheet"
  | "funder_agreement" | "submission_cover"
  | "invoice_sent" | "commission_agreement" | "referral_agreement" | "msa" | "welcome_pack"
  | "other";

export type UploadSource = "owner" | "partner" | "client" | "funder";
export type DocumentStatus = "active" | "archived" | "expired" | "rejected";

// ---- Verification (B3.2) — mirrors document_verification_status /
// document_rejection_reason in the DB. Verification is a separate axis from the
// lifecycle `status` above: a document is unverified/accepted/rejected.
export type VerificationStatus = "unverified" | "accepted" | "rejected";
export type RejectionReason =
  | "illegible"
  | "expired"
  | "wrong_document"
  | "incomplete"
  | "mismatch"
  | "outdated_version"
  | "other";

// Partner-safe rejection reasons (A9.5 decline-category pattern). The partner
// only ever sees the rendered phrase — never the free-text verification notes.
export const REJECTION_REASONS: { value: RejectionReason; label: string }[] = [
  { value: "illegible", label: "Illegible / unreadable" },
  { value: "expired", label: "Expired" },
  { value: "wrong_document", label: "Wrong document" },
  { value: "incomplete", label: "Incomplete" },
  { value: "mismatch", label: "Details mismatch" },
  { value: "outdated_version", label: "Outdated version" },
  { value: "other", label: "Other" },
];

export function rejectionReasonLabel(value: string | null): string {
  if (!value) return "";
  return REJECTION_REASONS.find((r) => r.value === value)?.label ?? value;
}

// The 8 named categories (+ other) in display order. `other` is the catch-all;
// the brief surfaces the 8 as filter chips.
export const DOCUMENT_CATEGORIES: { value: DocumentCategory; label: string }[] = [
  { value: "business", label: "Business" },
  { value: "financial", label: "Financial" },
  { value: "personal", label: "Personal" },
  { value: "deal", label: "Deal" },
  { value: "asset", label: "Asset" },
  { value: "compliance", label: "Compliance" },
  { value: "funder_comms", label: "Funder communications" },
  { value: "fnc_business", label: "FNC business" },
  { value: "other", label: "Other" },
];

export function categoryLabel(value: DocumentCategory): string {
  return DOCUMENT_CATEGORIES.find((c) => c.value === value)?.label ?? value;
}

type TypeMeta = {
  value: DocumentType;
  label: string;
  category: DocumentCategory;
  periodScoped?: boolean;
};

// The full taxonomy. `periodScoped` matches document_type_is_period_scoped() in
// the DB; grouping matches document_type_category().
export const DOCUMENT_TYPES: TypeMeta[] = [
  // Business
  { value: "cipc_cert", label: "CIPC certificate", category: "business" },
  { value: "company_profile", label: "Company profile", category: "business" },
  { value: "tax_clearance", label: "Tax clearance", category: "business" },
  { value: "bee_cert", label: "BEE certificate", category: "business" },
  { value: "moi", label: "MOI", category: "business" },
  { value: "trading_license", label: "Trading license", category: "business" },
  { value: "shareholder_register", label: "Shareholder register", category: "business" },
  { value: "director_appointment", label: "Director appointment letter", category: "business" },
  // Financial
  { value: "bank_statement", label: "Bank statement", category: "financial", periodScoped: true },
  { value: "financial_statements", label: "Financial statements", category: "financial", periodScoped: true },
  { value: "mgmt_accounts", label: "Management accounts", category: "financial", periodScoped: true },
  { value: "debtors_ageing", label: "Debtors ageing", category: "financial", periodScoped: true },
  { value: "creditors_ageing", label: "Creditors ageing", category: "financial", periodScoped: true },
  { value: "cashflow_projection", label: "Cash flow projection", category: "financial", periodScoped: true },
  { value: "budget", label: "Budget", category: "financial" },
  // Personal
  { value: "id_copy", label: "ID copy", category: "personal" },
  { value: "proof_of_address", label: "Proof of address", category: "personal" },
  { value: "anc_contract", label: "ANC contract", category: "personal" },
  { value: "personal_financials", label: "Personal financials", category: "personal" },
  { value: "spousal_consent", label: "Spousal consent", category: "personal" },
  { value: "marriage_cert", label: "Marriage certificate", category: "personal" },
  // Deal
  { value: "application_form", label: "Application form", category: "deal" },
  { value: "credit_consent", label: "Credit consent", category: "deal" },
  { value: "purchase_order", label: "Purchase order", category: "deal" },
  { value: "cession", label: "Cession", category: "deal" },
  { value: "suretyship", label: "Suretyship", category: "deal" },
  { value: "personal_guarantee", label: "Personal guarantee", category: "deal" },
  { value: "business_plan", label: "Business plan", category: "deal" },
  { value: "quotation", label: "Quotation", category: "deal" },
  { value: "invoice_doc", label: "Invoice", category: "deal" },
  // Asset
  { value: "natis", label: "NATIS", category: "asset" },
  { value: "vehicle_license", label: "Vehicle license", category: "asset" },
  { value: "title_deed", label: "Title deed", category: "asset" },
  { value: "valuation_report", label: "Valuation report", category: "asset" },
  { value: "equipment_schedule", label: "Equipment schedule", category: "asset" },
  { value: "livestock_inventory", label: "Livestock inventory", category: "asset" },
  // Compliance
  { value: "fica_pack", label: "FICA pack", category: "compliance" },
  { value: "popia_consent", label: "POPIA consent", category: "compliance" },
  { value: "source_of_funds", label: "Source of funds declaration", category: "compliance" },
  { value: "tax_residency", label: "Tax residency", category: "compliance" },
  // Funder communications
  { value: "approval_letter", label: "Approval letter", category: "funder_comms" },
  { value: "decline_letter", label: "Decline letter", category: "funder_comms" },
  { value: "offer_letter", label: "Offer letter", category: "funder_comms" },
  { value: "term_sheet", label: "Term sheet", category: "funder_comms" },
  { value: "funder_agreement", label: "Funder agreement", category: "funder_comms" },
  { value: "submission_cover", label: "Submission cover", category: "funder_comms" },
  // FNC business
  { value: "invoice_sent", label: "Invoice sent", category: "fnc_business" },
  { value: "commission_agreement", label: "Commission agreement", category: "fnc_business" },
  { value: "referral_agreement", label: "Referral agreement", category: "fnc_business" },
  { value: "msa", label: "MSA", category: "fnc_business" },
  { value: "welcome_pack", label: "Welcome pack", category: "fnc_business" },
  // Catch-all
  { value: "other", label: "Other", category: "other" },
];

const TYPE_META = new Map<string, TypeMeta>(DOCUMENT_TYPES.map((t) => [t.value, t]));

export function docTypeLabel(value: string): string {
  return TYPE_META.get(value)?.label ?? value;
}

export function typeCategory(value: string): DocumentCategory {
  return TYPE_META.get(value)?.category ?? "other";
}

export function isPeriodScoped(value: string): boolean {
  return TYPE_META.get(value)?.periodScoped ?? false;
}

export function typesInCategory(category: DocumentCategory): TypeMeta[] {
  return DOCUMENT_TYPES.filter((t) => t.category === category);
}

// Structured client-PII types partners can never read (mirrors the RLS exclusion
// list in documents_partner_read_own_uploads). Surfaced in the UI as an
// "owner-only" marker.
export const PARTNER_EXCLUDED_TYPES: ReadonlySet<string> = new Set<DocumentType>([
  "bank_statement",
  "mgmt_accounts",
  "debtors_ageing",
  "creditors_ageing",
  "financial_statements",
  "personal_financials",
  "source_of_funds",
]);

export function isPartnerExcluded(value: string): boolean {
  return PARTNER_EXCLUDED_TYPES.has(value);
}

// ---- Default expiry (mirrors document_default_expiry()) --------------------
// Used to PRE-FILL the expiry input; the DB applies the same rule server-side if
// the owner leaves it blank. Returns an ISO date string (yyyy-mm-dd) or null.
function addMonths(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  const targetMonth = d.getMonth() + months;
  const target = new Date(d.getFullYear(), targetMonth, d.getDate());
  // Clamp to month end when the day overflows (e.g. Jan 31 + 3mo → Apr 30),
  // matching Postgres date + interval semantics.
  if (target.getDate() !== d.getDate()) target.setDate(0);
  return target;
}

function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

/**
 * Default expiry for a type given the upload date and (for period-scoped types)
 * the period end. Returns yyyy-mm-dd or null when the type has no default.
 */
export function defaultExpiry(
  type: string,
  uploadDate: Date,
  periodEnd: string | null,
): string | null {
  const pe = periodEnd ? new Date(periodEnd + "T00:00:00") : null;
  switch (type) {
    case "bank_statement":
      return pe ? toISODate(addMonths(pe, 3)) : null;
    case "proof_of_address":
      return toISODate(addMonths(uploadDate, 3));
    case "tax_clearance":
    case "bee_cert":
    case "fica_pack":
      return toISODate(addMonths(uploadDate, 12));
    case "financial_statements":
      return pe ? toISODate(addMonths(pe, 12)) : null;
    default:
      return null;
  }
}

// ---- Expiry status pill ----------------------------------------------------
export type ExpiryStatus = "none" | "ok" | "soon" | "urgent" | "expired";

/** Classify an expiry date into a pill status. 7d → urgent, 30d → soon. */
export function expiryStatus(
  expiryDate: string | null,
  now = new Date(),
): ExpiryStatus {
  if (!expiryDate) return "none";
  const exp = new Date(expiryDate + "T00:00:00").getTime();
  if (!Number.isFinite(exp)) return "none";
  // Compare whole CALENDAR days, not raw instants: normalise `now` to the start
  // of today so the diff is midnight-to-midnight. Using Date.now() directly would
  // make (exp - now) fractionally negative any time after midnight on the expiry
  // date itself, flooring to -1 and marking the document "expired" a day early —
  // a document is only expired the day AFTER its expiry date. round() keeps the
  // boundary exact across DST (where a day isn't precisely 86,400,000 ms).
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const days = Math.round((exp - today) / 86_400_000);
  if (days < 0) return "expired";
  if (days <= 7) return "urgent";
  if (days <= 30) return "soon";
  return "ok";
}

export const EXPIRY_PILL: Record<
  ExpiryStatus,
  { label: (d: string | null) => string; className: string }
> = {
  none: { label: () => "No expiry", className: "bg-slate-100 text-slate-500 ring-slate-400/20" },
  ok: {
    label: (d) => `Valid to ${d ? formatDocDate(d) : ""}`,
    className: "bg-green-100 text-green-800 ring-green-600/20",
  },
  soon: {
    label: (d) => `Expires ${d ? formatDocDate(d) : ""}`,
    className: "bg-amber-100 text-amber-800 ring-amber-600/20",
  },
  urgent: {
    label: (d) => `Expires ${d ? formatDocDate(d) : ""}`,
    className: "bg-red-100 text-red-800 ring-red-600/20",
  },
  expired: {
    label: (d) => `Expired ${d ? formatDocDate(d) : ""}`,
    className: "bg-red-100 text-red-800 ring-red-600/20",
  },
};

// Short SA date for document surfaces (matches the existing en-ZA date style).
export function formatDocDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso.length <= 10 ? iso + "T00:00:00" : iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
}

export function formatFileSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Coverage window for a period-scoped "pack" of the same type on one entity.
export function packCoverage(
  periods: { period_start: string | null; period_end: string | null }[],
): { start: string | null; end: string | null; months: number } {
  const withPeriods = periods.filter((p) => p.period_start && p.period_end);
  if (withPeriods.length === 0) return { start: null, end: null, months: 0 };
  const starts = withPeriods.map((p) => p.period_start!).sort();
  const ends = withPeriods.map((p) => p.period_end!).sort();
  return { start: starts[0], end: ends[ends.length - 1], months: withPeriods.length };
}
