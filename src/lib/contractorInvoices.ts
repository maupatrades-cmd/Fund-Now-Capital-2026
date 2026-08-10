import { supabase } from "@/lib/supabase";

// Build 9 (Contractor invoicing FNC) — shared types + state metadata for the
// contractor invoice lifecycle. The contractor analogue of partnerInvoices.ts.
//
// PRIVACY (S7C, absolute): the contractor surface shows ONLY his own commission
// in Rands (line_item.amount = the flat-tier contractor_share) and neutral
// deal/client references. It NEVER exposes FNC gross, company retention, the
// pool, the tier band, the tier %, or any funder name/rate — contractor tier
// rows carry no funder submission at all, so no funder name exists to leak.

export type ContractorInvoiceState =
  | "draft"
  | "submitted"
  | "approved"
  | "paid"
  | "rejected";

// A contractor_invoices row. Numeric columns arrive as strings from PostgREST.
// NB: unlike partner_invoices there is no pdf_storage_path — the PDF is rendered
// on demand by the generate-contractor-invoice-pdf Edge Function (Build 9 adds
// no migration, so nothing is persisted server-side).
export type ContractorInvoice = {
  id: string;
  contractor_id: string;
  invoice_number: string;
  generated_at: string;
  invoice_period_start: string;
  invoice_period_end: string;
  total_amount: string | number;
  state: ContractorInvoiceState;
  submitted_at: string | null;
  approved_at: string | null;
  approved_by: string | null;
  paid_at: string | null;
  paid_reference: string | null;
  paid_proof_path: string | null;
  due_date: string | null;
  rejected_at: string | null;
  rejected_reason: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

// Owner review rows embed the contractor's real name (owner privilege — the
// owner sees who raised each invoice). Contractors never need their own name, so
// the contractor list uses the bare ContractorInvoice shape.
export type OwnerContractorInvoiceRow = ContractorInvoice & {
  contractor: { id: string; full_name: string | null } | null;
};

// Enriched line item — the exact shape returned by
// list_contractor_invoice_line_items. No funder name (contractor tier rows have
// none); amount is the contractor take only.
export type ContractorInvoiceLineItem = {
  line_item_id: string;
  deal_id: string;
  deal_reference: string | null;
  client_business_name: string | null;
  amount: string | number;
  added_at: string;
};

// Read-only eligibility preview returned by contractor_my_invoiceable_summary.
// Numeric fields arrive as strings from PostgREST — coerce with toNum. S7C: the
// contractor's take + counts + ready-date range only, no gross/pool/tier/funder.
export type ContractorInvoiceableSummary = {
  selected_count: number;
  selected_amount: string | number;
  ready_count: number;
  ready_amount: string | number;
  ready_start: string | null;
  ready_end: string | null;
};

// State chip styling — mirrors PARTNER_INVOICE_STATE_META.
export const CONTRACTOR_INVOICE_STATE_META: Record<
  ContractorInvoiceState,
  { label: string; badge: string }
> = {
  draft: { label: "Draft", badge: "bg-slate-100 text-slate-600 ring-slate-500/20" },
  submitted: { label: "Submitted", badge: "bg-blue-50 text-blue-700 ring-blue-600/20" },
  approved: { label: "Approved", badge: "bg-brand-teal/10 text-brand-teal ring-brand-teal/30" },
  paid: { label: "Paid", badge: "bg-brand-green/15 text-brand-green ring-brand-green/30" },
  rejected: { label: "Rejected", badge: "bg-red-50 text-red-700 ring-red-600/20" },
};

// Stable order for the state filter.
export const CONTRACTOR_INVOICE_STATES: ContractorInvoiceState[] = [
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

// An approved-but-unpaid invoice is overdue once past its due date (Build 12).
// "Today" is computed in Africa/Johannesburg so the banner matches the server
// sweep + due-date stamping (both use current_sast_date()), not the viewer's TZ.
export function isPayoutOverdue(state: string, dueDate: string | null): boolean {
  if (state !== "approved" || !dueDate) return false;
  const sastToday = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg" }).format(
    new Date(),
  ); // 'YYYY-MM-DD'
  return dueDate.slice(0, 10) < sastToday;
}

// "1 Jul 2026 – 31 Jul 2026" period range label.
export function formatPeriodRange(
  start: string | null | undefined,
  end: string | null | undefined,
): string {
  return `${formatPeriodDate(start)} – ${formatPeriodDate(end)}`;
}

function localIsoDate(dt: Date): string {
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(
    dt.getDate(),
  ).padStart(2, "0")}`;
}

// Default to the current calendar month (commission becomes invoiceable when FNC
// receives the funder's payment — the current-month default surfaces newly
// payable money without the contractor guessing a period).
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

// Owner-only signed URL for an EFT proof-of-payment file in the private
// `contractor-invoice-proofs` bucket. Minted with the owner's own session (the
// owner-all bucket RLS backs it) — no service-role secret in the browser.
export async function getContractorEftProofUrl(path: string, expiresIn = 3600): Promise<string> {
  const { data, error } = await supabase.storage
    .from("contractor-invoice-proofs")
    .createSignedUrl(path, expiresIn);
  if (error || !data?.signedUrl) {
    throw new Error(error?.message ?? "Could not create a link for this proof file.");
  }
  if (!/^https:\/\//i.test(data.signedUrl)) {
    throw new Error("Refusing to open a non-HTTPS link.");
  }
  return data.signedUrl;
}

// Upload an EFT proof-of-payment file to the private bucket (owner only, per the
// owner-all bucket RLS) and return its storage path. Path namespaces by invoice.
export async function uploadContractorEftProof(invoiceId: string, file: File): Promise<string> {
  const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, "_").slice(-80);
  const path = `${invoiceId}/${Date.now()}-${safeName}`;
  const { error } = await supabase.storage
    .from("contractor-invoice-proofs")
    .upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
  if (error) throw new Error(error.message || "Could not upload the proof file.");
  return path;
}

// Remove an uploaded EFT proof object. Best-effort — used to clean up a file that
// was uploaded but never recorded on the invoice (the mark-paid RPC threw or was
// an idempotent no-op), so it doesn't linger as an orphan in the private bucket.
export async function deleteContractorEftProof(path: string): Promise<void> {
  // Supabase Storage returns errors in the result rather than throwing; surface
  // a failed cleanup at warning level so an orphaned object isn't fully silent.
  const { error } = await supabase.storage.from("contractor-invoice-proofs").remove([path]);
  if (error) {
    console.warn("Could not remove orphaned EFT proof object", { path, message: error.message });
  }
}

// Render + download a contractor-invoice PDF on demand. The Edge Function
// authenticates the caller's session (functions.invoke attaches the JWT), scopes
// every read to the caller's RLS (owner or the owning contractor), and returns
// the PDF inline as base64 — nothing is stored server-side. We turn that into a
// Blob and trigger a same-tab download so no popup blocker is involved.
export async function downloadContractorInvoicePdf(
  invoiceId: string,
  invoiceNumber: string,
): Promise<void> {
  const { data, error } = await supabase.functions.invoke("generate-contractor-invoice-pdf", {
    body: { contractor_invoice_id: invoiceId },
  });
  if (error) {
    // supabase-js wraps a non-2xx body in FunctionsHttpError; surface the JSON error if present.
    let detail = error.message;
    const ctx = (error as unknown as { context?: Response })?.context;
    if (ctx && typeof ctx.json === "function") {
      try {
        const body = await ctx.json();
        if (body?.error) detail = body.error;
      } catch {
        /* keep the generic message */
      }
    }
    throw new Error(detail || "Could not generate the PDF.");
  }
  const b64 = (data as { pdf_base64?: string } | null)?.pdf_base64;
  if (!b64) throw new Error("The PDF could not be generated.");

  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = `${invoiceNumber || "contractor-invoice"}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // Revoke on the next tick so the click-driven navigation isn't cancelled.
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
}
