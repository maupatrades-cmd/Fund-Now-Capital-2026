import { supabase } from "@/lib/supabase";

// C4 (Doctor Invoicing FNC) — shared types + state metadata for the partner
// invoice lifecycle. SPEC S8 / S11 "Invoicing" / S7C.
//
// PRIVACY (S7C, absolute): the partner surface shows ONLY his own commission in
// Rands (line_item.amount = partner_share) and the FICTIONAL funder name. It
// NEVER exposes FNC gross, company retention, the partner pool, the tier band,
// or the tier %. The line-items enrichment RPC (list_partner_invoice_line_items)
// resolves the funder name audience-scoped server-side (fictional for a partner
// caller, real for the owner), so the client never has to anonymise anything.

export type PartnerInvoiceState =
  | "draft"
  | "submitted"
  | "approved"
  | "paid"
  | "rejected";

// A partner_invoices row. Numeric columns arrive as strings from PostgREST.
export type PartnerInvoice = {
  id: string;
  referral_partner_id: string;
  invoice_number: string;
  generated_at: string;
  invoice_period_start: string;
  invoice_period_end: string;
  total_amount: string | number;
  state: PartnerInvoiceState;
  submitted_at: string | null;
  approved_at: string | null;
  approved_by: string | null;
  paid_at: string | null;
  paid_reference: string | null;
  due_date: string | null;
  rejected_at: string | null;
  rejected_reason: string | null;
  notes: string | null;
  pdf_storage_path: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

// Owner list rows embed the REAL partner name (owner privilege). Partners never
// need their own name, so the partner list uses the bare PartnerInvoice shape.
export type OwnerPartnerInvoiceRow = PartnerInvoice & {
  partner: { id: string; name: string } | null;
};

// Enriched line item — the exact shape returned by list_partner_invoice_line_items.
// `funder_name` is already audience-scoped by the RPC (fictional for partners).
export type PartnerInvoiceLineItem = {
  line_item_id: string;
  deal_id: string;
  deal_reference: string | null;
  client_business_name: string | null;
  funder_name: string | null;
  amount: string | number;
  added_at: string;
};

// State chip styling — mirrors the funder-invoice INVOICE_STATE_META convention.
export const PARTNER_INVOICE_STATE_META: Record<
  PartnerInvoiceState,
  { label: string; badge: string }
> = {
  draft: { label: "Draft", badge: "bg-slate-100 text-slate-600 ring-slate-500/20" },
  submitted: { label: "Submitted", badge: "bg-blue-50 text-blue-700 ring-blue-600/20" },
  approved: { label: "Approved", badge: "bg-brand-teal/10 text-brand-teal ring-brand-teal/30" },
  paid: { label: "Paid", badge: "bg-brand-green/15 text-brand-green ring-brand-green/30" },
  rejected: { label: "Rejected", badge: "bg-red-50 text-red-700 ring-red-600/20" },
};

export function partnerInvoiceStateLabel(state: PartnerInvoiceState): string {
  return PARTNER_INVOICE_STATE_META[state]?.label ?? state;
}

// An approved-but-unpaid invoice is overdue once past its due date (Build 12).
export function isPayoutOverdue(state: string, dueDate: string | null): boolean {
  if (state !== "approved" || !dueDate) return false;
  const [y, m, d] = dueDate.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return false;
  const now = new Date();
  return new Date(y, m - 1, d) < new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

// Stable order for the state filter multi-select (both surfaces).
export const PARTNER_INVOICE_STATES: PartnerInvoiceState[] = [
  "draft",
  "submitted",
  "approved",
  "paid",
  "rejected",
];

// PostgREST numeric → number coercion (numeric columns arrive as strings).
export function toNum(value: string | number | null | undefined): number {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

// Invoice period ('YYYY-MM-DD') formatted for display, tz-safe (date-part only).
export function formatPeriodDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return "—";
  return new Date(y, m - 1, d).toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// "1 Jul 2026 – 31 Jul 2026" period range label.
export function formatPeriodRange(
  start: string | null | undefined,
  end: string | null | undefined,
): string {
  return `${formatPeriodDate(start)} – ${formatPeriodDate(end)}`;
}

// Signed URL for a rendered partner-invoice PDF in the private `partner-invoices`
// bucket. Both surfaces mint it with the caller's OWN session — owner (owner-all
// RLS) or the owning partner ({partner_id}/ folder RLS) — so no service-role
// secret ever reaches the browser (mirrors getInvoicePdfUrl for funder invoices).
export async function getPartnerInvoicePdfUrl(path: string, expiresIn = 3600): Promise<string> {
  const { data, error } = await supabase.storage
    .from("partner-invoices")
    .createSignedUrl(path, expiresIn);
  if (error || !data?.signedUrl) {
    throw new Error(error?.message ?? "Could not create a download link for this PDF.");
  }
  // https-only allow-list; keep the full URL (the required ?token=… must survive).
  if (!/^https:\/\//i.test(data.signedUrl)) {
    throw new Error("Refusing to open a non-HTTPS PDF link.");
  }
  return data.signedUrl;
}

function localIsoDate(dt: Date): string {
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(
    dt.getDate(),
  ).padStart(2, "0")}`;
}

// Default to the current calendar month. Commission becomes invoiceable when
// FNC receives the funder's payment, so the previous-month default can hide
// newly-payable money and make the partner guess which period to use.
export function defaultInvoicePeriod(now = new Date()): { start: string; end: string } {
  return {
    start: localIsoDate(new Date(now.getFullYear(), now.getMonth(), 1)),
    end: localIsoDate(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
  };
}

export function previousInvoicePeriod(now = new Date()): { start: string; end: string } {
  return {
    start: localIsoDate(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
    end: localIsoDate(new Date(now.getFullYear(), now.getMonth(), 0)),
  };
}
