import { formatZAR } from "@/lib/format";

// ---- Agreement status ----------------------------------------------------
export const AGREEMENT_STATUSES = ["signed", "verbal", "pending", "estimated"] as const;
export type AgreementStatus = (typeof AGREEMENT_STATUSES)[number];

// Colour-coded per spec: signed=green, verbal=amber, pending=grey, estimated=red.
export const AGREEMENT_STATUS_META: Record<
  AgreementStatus,
  { label: string; badgeClass: string }
> = {
  signed: { label: "Signed", badgeClass: "bg-green-100 text-green-800 ring-green-600/20" },
  verbal: { label: "Verbal", badgeClass: "bg-amber-100 text-amber-800 ring-amber-600/20" },
  pending: { label: "Pending", badgeClass: "bg-slate-100 text-slate-600 ring-slate-500/20" },
  estimated: { label: "Estimated", badgeClass: "bg-red-100 text-red-700 ring-red-600/20" },
};

export function agreementMeta(status: string | null) {
  if (status && status in AGREEMENT_STATUS_META) {
    return AGREEMENT_STATUS_META[status as AgreementStatus];
  }
  return { label: status ?? "—", badgeClass: "bg-slate-100 text-slate-600 ring-slate-500/20" };
}

// ---- Product type --------------------------------------------------------
export const FUNDER_TYPE_LABELS: Record<string, string> = {
  working_capital: "Working Capital",
  MCA: "Merchant Cash Advance",
  po_finance: "PO Finance",
  invoice_discount: "Invoice Discounting",
  asset_finance: "Asset Finance",
  property_secured: "Property Secured",
};

export const FUNDER_TYPE_OPTIONS = Object.entries(FUNDER_TYPE_LABELS).map(
  ([value, label]) => ({ value, label }),
);

export function funderTypeLabel(value: string | null): string {
  if (!value) return "—";
  return FUNDER_TYPE_LABELS[value] ?? value;
}

// ---- Ticket range --------------------------------------------------------
export function formatTicketRange(
  min: number | string | null,
  max: number | string | null,
): string {
  const lo = min == null || min === "" ? null : Number(min);
  const hi = max == null || max === "" ? null : Number(max);
  if (lo == null && hi == null) return "Not set";
  if (lo != null && hi != null) return `${formatZAR(lo)} – ${formatZAR(hi)}`;
  if (lo != null) return `From ${formatZAR(lo)}`;
  return `Up to ${formatZAR(hi)}`;
}

// ---- Commission structure (reference, shown on the funder detail) --------
// Fund Now Capital's split is global (by deal type / gross band), not per funder,
// so the detail page shows this as read-only reference.
export const COMMISSION_STRUCTURE = {
  companyRetention: 0.4,
  partnerPool: 0.6,
  tiers: [
    { label: "Purchase Order deals (any funder)", pct: 0.4 },
    { label: "Non-PO · R0 – R80,000", pct: 0.29 },
    { label: "Non-PO · R80,001 – R150,000", pct: 0.3 },
    { label: "Non-PO · R150,001 – R500,000", pct: 0.33 },
    { label: "Non-PO · R500,001+", pct: 0.25 },
  ],
};

export function pct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}
