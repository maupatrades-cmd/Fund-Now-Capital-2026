// C1.2 Invoicing UI — shared types, state metadata, aging math, the generate
// preview mirror, and the PDF signed-URL helper. SPEC S7.
//
// The commission preview here is a CLIENT-SIDE MIRROR of generate_funder_invoice
// (migration 20260721100100). It exists only so the owner sees the numbers
// before committing; the DB RPC is the single source of truth and recomputes +
// snapshots the rate authoritatively on generate. Keep the two in lockstep.
import { supabase } from "@/lib/supabase";
import { formatZAR, startOfMonth } from "@/lib/format";
import type { DealType, FunderRateType, RateStructure } from "@/lib/funderCommissions";

// ---- state -----------------------------------------------------------------
export type InvoiceState = "draft" | "issued" | "paid" | "overdue" | "void";

export type FunderInvoice = {
  id: string;
  invoice_number: string;
  deal_id: string;
  deal_funder_submission_id: string;
  funder_id: string;
  client_reference: string;
  facility_advanced: string | number;
  finance_charge_amount: string | number | null;
  commission_amount: string | number;
  vat_amount: string | number | null;
  total_amount: string | number;
  rate_snapshot: Record<string, unknown> | null;
  commission_description: string;
  contract_reference: string | null;
  payment_reference_expected: string;
  issued_date: string;
  payment_terms: string;
  due_date: string;
  state: InvoiceState;
  paid_at: string | null;
  paid_amount: string | number | null;
  payment_reference_received: string | null;
  pdf_storage_path: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

// Row shape for the /invoices table + deal section (invoice + embedded funder).
export type InvoiceListRow = FunderInvoice & {
  funder: { id: string; name: string; short_code: string | null } | null;
};

// State chip styling — mirrors the Badge ring convention used elsewhere.
export const INVOICE_STATE_META: Record<
  InvoiceState,
  { label: string; badge: string }
> = {
  draft: { label: "Draft", badge: "bg-slate-100 text-slate-600 ring-slate-500/20" },
  issued: { label: "Issued", badge: "bg-brand-teal/10 text-brand-teal ring-brand-teal/30" },
  paid: { label: "Paid", badge: "bg-brand-green/15 text-brand-green ring-brand-green/30" },
  overdue: { label: "Overdue", badge: "bg-amber-100 text-amber-700 ring-amber-500/30" },
  void: { label: "Void", badge: "bg-slate-100 text-slate-400 ring-slate-400/20 line-through" },
};

export function invoiceStateLabel(state: InvoiceState): string {
  return INVOICE_STATE_META[state]?.label ?? state;
}

// The five states in a stable order for the filter multi-select.
export const INVOICE_STATES: InvoiceState[] = ["draft", "issued", "paid", "overdue", "void"];

// ---- number coercion (PostgREST returns numeric as string) -----------------
export function toNum(value: string | number | null | undefined): number {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

// ---- date formatting (invoice dates are plain 'YYYY-MM-DD') -----------------
export function formatInvoiceDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  // Parse the date part only so timezone never shifts the calendar day.
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return "—";
  return new Date(y, m - 1, d).toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// Whole days a date is in the past relative to today (negative = future).
export function daysPast(iso: string | null | undefined, now = new Date()): number {
  if (!iso) return 0;
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return 0;
  const then = new Date(y, m - 1, d).getTime();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.floor((today - then) / 86_400_000);
}

// ---- aging tiles -----------------------------------------------------------
export type AgingSummary = {
  draft: { count: number; total: number };
  issued: { count: number; total: number };
  paidMtd: { count: number; total: number };
  overdue: { count: number; total: number; over30: number };
};

// Computed client-side from the fetched invoice set (owner volume is small; an
// aggregate RPC is deferred per the locked C1.2 scope). "Paid MTD" counts
// invoices whose paid_at falls in the current calendar month.
export function computeAging(rows: FunderInvoice[], now = new Date()): AgingSummary {
  const monthStart = startOfMonth(now).getTime();
  const summary: AgingSummary = {
    draft: { count: 0, total: 0 },
    issued: { count: 0, total: 0 },
    paidMtd: { count: 0, total: 0 },
    overdue: { count: 0, total: 0, over30: 0 },
  };
  for (const r of rows) {
    const total = toNum(r.total_amount);
    if (r.state === "draft") {
      summary.draft.count += 1;
      summary.draft.total += total;
    } else if (r.state === "issued") {
      summary.issued.count += 1;
      summary.issued.total += total;
    } else if (r.state === "overdue") {
      summary.overdue.count += 1;
      summary.overdue.total += total;
      if (daysPast(r.due_date, now) > 30) summary.overdue.over30 += 1;
    }
    // Paid MTD is orthogonal to state buckets above — a paid invoice counts here
    // when it was settled this month.
    if (r.state === "paid" && r.paid_at) {
      const paidMs = new Date(r.paid_at).getTime();
      if (Number.isFinite(paidMs) && paidMs >= monthStart) {
        summary.paidMtd.count += 1;
        summary.paidMtd.total += toNum(r.paid_amount ?? r.total_amount);
      }
    }
  }
  return summary;
}

// ---- effective rate resolution (mirrors funder_rate_at) --------------------
// Picks the rate row in force for (funder, deal_type) as-of a date: the latest
// effective_from whose [effective_from, effective_to] window contains as_of.
export function resolveEffectiveRate(
  rates: RateStructure[] | undefined,
  funderId: string,
  dealType: DealType,
  asOf: string,
): RateStructure | null {
  if (!rates) return null;
  const asOfDate = asOf.slice(0, 10);
  const candidates = rates
    .filter(
      (r) =>
        r.funder_id === funderId &&
        r.deal_type === dealType &&
        r.effective_from.slice(0, 10) <= asOfDate &&
        (r.effective_to === null || r.effective_to.slice(0, 10) >= asOfDate),
    )
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from));
  return candidates[0] ?? null;
}

// ---- generate preview (mirror of generate_funder_invoice) ------------------
export type InvoicePreview =
  | {
      ok: true;
      rateType: FunderRateType;
      rateDisplay: string;
      basis: string;
      facilityAdvanced: number;
      financeCharge: number | null;
      commission: number;
      total: number;
      paymentTerms: string;
      dueDate: string; // YYYY-MM-DD
      paymentReferencePattern: string;
      description: string;
    }
  | { ok: false; reason: string };

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Percent display: 0.10 → "10%", 0.335 → "33.5%" (matches the DB's trimmed form).
function ratePercentDisplay(frac: number): string {
  return `${Number((frac * 100).toFixed(2))}%`;
}

export function todaySastISO(now = new Date()): string {
  // The DB uses current_sast_date(); for a same-day preview the browser's local
  // date is close enough (owner works in SAST). Authoritative date is set on generate.
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;
}

function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(
    dt.getDate(),
  ).padStart(2, "0")}`;
}

// The subset of a rate the preview actually reads. Both a live RateStructure
// (from resolveEffectiveRate) and a submission's applied_rate_snapshot satisfy
// it, so the preview can prefer the snapshot exactly as the RPC does.
export type PreviewRate = Pick<
  RateStructure,
  "rate_type" | "rate_fraction" | "flat_amount" | "payment_terms_days" | "contract_reference"
>;

// Build a preview rate from a submission's applied_rate_snapshot, reading the
// same fields generate_funder_invoice reads (snapshot-first). Keeps the preview
// in exact agreement with the invoice the RPC creates; when C2.1's shared gross
// helper lands, both the preview and the RPC can resolve gross the same way.
// Returns null when there is no usable snapshot (→ caller falls back to the live
// rate via resolveEffectiveRate). applied_rate_snapshot is null in production
// today (C2 not shipped), so this is currently always a no-op fallback.
export function rateFromSnapshot(
  snapshot: Record<string, unknown> | null | undefined,
): PreviewRate | null {
  if (!snapshot) return null;
  const rateType = snapshot.rate_type as FunderRateType | undefined;
  if (!rateType) return null;
  return {
    rate_type: rateType,
    rate_fraction: (snapshot.rate_fraction as number | string | null) ?? null,
    flat_amount: (snapshot.flat_amount as number | string | null) ?? null,
    payment_terms_days: Number(snapshot.payment_terms_days ?? 0),
    contract_reference: (snapshot.contract_reference as string | null) ?? null,
  };
}

export function computeInvoicePreview(args: {
  rate: PreviewRate | null;
  amountFunded: number;
  financeCharge: number | null;
  funderName: string;
  funderShort: string | null;
  clientBusinessName: string;
  clientShort: string | null;
  now?: Date;
}): InvoicePreview {
  const { rate, amountFunded, financeCharge, funderName, funderShort, clientShort, clientBusinessName } = args;
  if (!rate) {
    return { ok: false, reason: "No commission rate structure for this funder/deal type. Capture it in Settings → Funder rates first." };
  }

  const frac = toNum(rate.rate_fraction);
  const flat = toNum(rate.flat_amount);
  let commission: number;
  let rateDisplay: string;
  let basis: string;

  switch (rate.rate_type) {
    case "percent_of_gross_funded":
      commission = round2(frac * amountFunded);
      rateDisplay = ratePercentDisplay(frac);
      basis = "funded amount";
      break;
    case "percent_of_finance_charge":
      if (financeCharge == null) {
        return { ok: false, reason: "This funder charges commission on the finance charge — enter the finance charge amount first." };
      }
      // Reject negatives here (the single gate for preview/canGenerate/doGenerate).
      // input min="0" doesn't stop a typed/pasted -1, which would otherwise persist
      // to the submission and have the RPC create a negative-commission invoice.
      if (financeCharge < 0) {
        return { ok: false, reason: "Finance charge cannot be negative." };
      }
      commission = round2(frac * financeCharge);
      rateDisplay = ratePercentDisplay(frac);
      basis = "finance charge on the facility";
      break;
    case "flat_rand_per_deal":
      commission = round2(flat);
      rateDisplay = formatZAR(flat, { cents: true });
      basis = "deal (flat fee)";
      break;
    case "percent_of_mdr":
      return { ok: false, reason: "% of MDR commission is not supported yet (deferred to the first MCA deal)." };
    default:
      return { ok: false, reason: `Unknown rate type ${rate.rate_type}.` };
  }

  const termsDays = rate.payment_terms_days ?? 0;
  const today = todaySastISO(args.now);
  const paymentTerms = termsDays === 0 ? "Due on receipt" : `${termsDays} days from invoice date`;
  const dueDate = termsDays === 0 ? today : addDaysISO(today, termsDays);

  // Both short codes must exist — generate_funder_invoice rejects null short
  // codes, and they form the payment reference. Gate here with a clear setup
  // message instead of letting Generate hit a server error.
  if (!funderShort || !clientShort) {
    const missing =
      !funderShort && !clientShort
        ? "The funder and client both need a short code"
        : !funderShort
          ? "This funder has no short code"
          : "This client has no short code";
    return {
      ok: false,
      reason: `${missing} — set it before invoicing (funder: Settings → Funder rates; client: the client page).`,
    };
  }
  const paymentReferencePattern = `${funderShort}-INV####-${clientShort}`;

  const contract = rate.contract_reference ?? "Lead Provider Agreement";
  const description =
    `Lead Provider Commission — commission earned per the ${contract}, calculated as ` +
    `${rateDisplay} of the ${basis} advanced by ${funderName} to the client ${clientBusinessName}.`;

  return {
    ok: true,
    rateType: rate.rate_type,
    rateDisplay,
    basis,
    facilityAdvanced: amountFunded,
    financeCharge,
    commission,
    total: commission,
    paymentTerms,
    dueDate,
    paymentReferencePattern,
    description,
  };
}

// ---- PDF signed URL --------------------------------------------------------
// The `invoices` bucket is private with owner-only RLS (invoices_owner_all).
// The owner's own authenticated client mints the signed URL directly — no
// service-role secret in the browser (that is why sign-invoice-url, which holds
// the webhook secret, is deliberately NOT wired into the frontend). SPEC S7 / C1.2.
export async function getInvoicePdfUrl(path: string, expiresIn = 3600): Promise<string> {
  const { data, error } = await supabase.storage.from("invoices").createSignedUrl(path, expiresIn);
  if (error || !data?.signedUrl) {
    throw new Error(error?.message ?? "Could not create a download link for this PDF.");
  }
  // https-only allow-list before we hand the URL to window navigation. The full
  // URL is returned untouched — Supabase signed URLs carry a required `?token=…`
  // query param, so we must never strip the query string.
  if (!/^https:\/\//i.test(data.signedUrl)) {
    throw new Error("Refusing to open a non-HTTPS PDF link.");
  }
  return data.signedUrl;
}

export function isInvoicePdfAvailable(inv: Pick<FunderInvoice, "pdf_storage_path">): boolean {
  return !!inv.pdf_storage_path;
}
