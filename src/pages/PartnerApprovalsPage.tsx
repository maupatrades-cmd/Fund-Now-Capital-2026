import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, XCircle, Banknote, Eye, ReceiptText } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { formatZAR } from "@/lib/format";
import { EmptyState } from "@/components/ui/empty-state";
import { PartnerInvoiceStateChip } from "@/components/partner-invoices/PartnerInvoiceStateChip";
import { LineItemsTable } from "@/components/partner-invoices/LineItemsTable";
import { DownloadPdfButton } from "@/components/partner-invoices/DownloadPdfButton";
import {
  formatPeriodRange,
  formatPeriodDate,
  PARTNER_INVOICE_STATES,
  type OwnerPartnerInvoiceRow,
  type PartnerInvoiceState,
} from "@/lib/partnerInvoices";
import {
  useOwnerPartnerInvoices,
  usePartnerInvoice,
  usePartnerInvoiceLineItems,
  useApprovePartnerInvoice,
  useRejectPartnerInvoice,
  useMarkPartnerInvoicePaid,
} from "@/hooks/usePartnerInvoices";

const primaryBtn =
  "inline-flex items-center gap-1.5 rounded-lg bg-brand-teal px-4 py-2 text-sm font-semibold text-white hover:bg-brand-teal/90 disabled:opacity-60";
const successBtn =
  "inline-flex items-center gap-1.5 rounded-lg bg-brand-green px-4 py-2 text-sm font-semibold text-white hover:bg-brand-green/90 disabled:opacity-60";
const dangerBtn =
  "inline-flex items-center gap-1.5 rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60";
const secondaryBtn =
  "rounded-lg border border-border px-4 py-2 text-sm font-medium text-brand-navy hover:bg-slate-50";
const inputCls =
  "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/20";

type Filter = "all" | PartnerInvoiceState;

// Owner review surface for partner (Doctor) invoices. Unlike the partner side,
// the owner sees the REAL partner name here and the REAL funder names in the
// line-item detail (owner privilege — the enrichment RPC resolves them by the
// owner's auth.uid()).
export default function PartnerApprovalsPage() {
  const { data: invoices, isLoading, isError, error } = useOwnerPartnerInvoices();
  // Default to the queue that needs action.
  const [filter, setFilter] = useState<Filter>("submitted");
  const [selected, setSelected] = useState<OwnerPartnerInvoiceRow | null>(null);

  const rows = useMemo(() => {
    const all = invoices ?? [];
    return filter === "all" ? all : all.filter((i) => i.state === filter);
  }, [invoices, filter]);

  const submittedCount = (invoices ?? []).filter((i) => i.state === "submitted").length;

  return (
    <div className="max-w-5xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-brand-navy">Partner Invoices</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Review, approve, and pay invoices your referral partners raise for their commission.
          {submittedCount > 0 && (
            <span className="ml-1 font-medium text-brand-navy">
              {submittedCount} awaiting your approval.
            </span>
          )}
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {(["all", ...PARTNER_INVOICE_STATES] as Filter[]).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={
              "rounded-full px-3 py-1 text-xs font-medium capitalize transition-colors " +
              (filter === f
                ? "bg-brand-navy text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200")
            }
          >
            {f}
          </button>
        ))}
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading partner invoices…</p>}
      {isError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Couldn't load partner invoices: {(error as Error)?.message ?? "unknown error"}
        </div>
      )}

      {!isLoading && !isError && rows.length === 0 && (
        <EmptyState
          icon={ReceiptText}
          title={filter === "submitted" ? "Nothing awaiting approval" : `No ${filter} invoices`}
          description={
            filter === "submitted"
              ? "When a partner submits an invoice for their commission, it lands here for your approval."
              : "Try a different filter."
          }
        />
      )}

      {!isLoading && !isError && rows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-border bg-white">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-medium">Partner</th>
                <th className="px-4 py-3 font-medium">Number</th>
                <th className="px-4 py-3 font-medium">Period</th>
                <th className="px-4 py-3 text-right font-medium">Total</th>
                <th className="px-4 py-3 font-medium">State</th>
                <th className="px-4 py-3 font-medium">Submitted</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((inv) => (
                <tr key={inv.id} className="border-b border-border/60 hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-brand-navy">{inv.partner?.name ?? "—"}</td>
                  <td className="px-4 py-3 font-semibold text-brand-navy">{inv.invoice_number}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {formatPeriodRange(inv.invoice_period_start, inv.invoice_period_end)}
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-brand-navy">
                    {formatZAR(inv.total_amount, { cents: true })}
                  </td>
                  <td className="px-4 py-3">
                    <PartnerInvoiceStateChip state={inv.state} />
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{formatPeriodDate(inv.submitted_at)}</td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => setSelected(inv)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-brand-navy hover:bg-slate-50"
                    >
                      <Eye className="h-3.5 w-3.5" /> View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <InvoiceReviewModal
          invoice={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

type ActionKind = "approve" | "reject" | "pay" | null;

function InvoiceReviewModal({
  invoice,
  onClose,
}: {
  invoice: OwnerPartnerInvoiceRow;
  onClose: () => void;
}) {
  const { data: items, isLoading, isError: itemsError } = usePartnerInvoiceLineItems(invoice.id);
  // The list row was captured when the modal opened, so its pdf_storage_path can
  // be stale (the PDF renders async after submit). Read the LIVE row (which polls
  // while the PDF is pending) so the Download button appears without a reload.
  const { data: liveInvoice } = usePartnerInvoice(invoice.id);
  const pdfPath = liveInvoice?.pdf_storage_path ?? invoice.pdf_storage_path;
  const [action, setAction] = useState<ActionKind>(null);
  const [reason, setReason] = useState("");
  const [reference, setReference] = useState("");

  const approve = useApprovePartnerInvoice();
  const reject = useRejectPartnerInvoice();
  const markPaid = useMarkPartnerInvoicePaid();
  const busyRef = useRef(false);

  // Never let the owner take a financial action while the line items are silently
  // unavailable (Macroscope #1) — approve/pay require a clean line-item load.
  const canFinancialAct = !itemsError && !isLoading;

  const runApprove = async () => {
    if (busyRef.current) return; // FIX #4 synchronous guard
    if (!canFinancialAct) {
      toast.error("Load the invoice's line items before approving.");
      return;
    }
    busyRef.current = true;
    try {
      await approve.mutateAsync({ invoiceId: invoice.id });
      toast.success(`Invoice ${invoice.invoice_number} approved`);
      onClose();
    } catch (e) {
      toast.error((e as Error).message || "Could not approve the invoice");
    } finally {
      busyRef.current = false;
    }
  };

  const runReject = async () => {
    if (busyRef.current) return;
    if (!reason.trim()) {
      toast.error("A rejection reason is required.");
      return;
    }
    busyRef.current = true;
    try {
      await reject.mutateAsync({ invoiceId: invoice.id, reason: reason.trim() });
      toast.success(`Invoice ${invoice.invoice_number} rejected`);
      onClose();
    } catch (e) {
      toast.error((e as Error).message || "Could not reject the invoice");
    } finally {
      busyRef.current = false;
    }
  };

  const runPay = async () => {
    if (busyRef.current) return;
    if (!canFinancialAct) {
      toast.error("Load the invoice's line items before marking it paid.");
      return;
    }
    if (!reference.trim()) {
      toast.error("An EFT payment reference is required.");
      return;
    }
    busyRef.current = true;
    try {
      await markPaid.mutateAsync({ invoiceId: invoice.id, paidReference: reference.trim() });
      toast.success(`Invoice ${invoice.invoice_number} marked paid`);
      onClose();
    } catch (e) {
      toast.error((e as Error).message || "Could not mark the invoice paid");
    } finally {
      busyRef.current = false;
    }
  };

  const pending = approve.isPending || reject.isPending || markPaid.isPending;

  return (
    <Modal title={`${invoice.partner?.name ?? "Partner"} · ${invoice.invoice_number}`} onClose={onClose} maxWidth="max-w-2xl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-muted-foreground">
          Period {formatPeriodRange(invoice.invoice_period_start, invoice.invoice_period_end)}
        </div>
        <div className="flex items-center gap-3">
          {invoice.state !== "draft" && <DownloadPdfButton path={pdfPath} />}
          <PartnerInvoiceStateChip state={invoice.state} />
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading line items…</p>
      ) : itemsError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          Couldn't load this invoice's line items. Approve and Mark-paid are disabled until they load
          — reload the page to try again.
        </div>
      ) : (
        <LineItemsTable invoiceId={invoice.id} items={items ?? []} />
      )}

      {invoice.state === "rejected" && invoice.rejected_reason && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <span className="font-medium">Rejected:</span> {invoice.rejected_reason}
        </div>
      )}
      {invoice.state === "paid" && (
        <div className="rounded-lg border border-brand-green/30 bg-brand-green/5 p-3 text-sm text-brand-navy">
          Paid {formatPeriodDate(invoice.paid_at)}
          {invoice.paid_reference ? ` — reference ${invoice.paid_reference}` : ""}.
        </div>
      )}

      {/* Reject reason / pay reference sub-forms */}
      {action === "reject" && (
        <div>
          <label className="mb-1 block text-xs font-medium text-brand-navy">Rejection reason (required)</label>
          <textarea
            rows={2}
            className={inputCls}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Explain what needs to change so the partner can re-invoice."
          />
        </div>
      )}
      {action === "pay" && (
        <div>
          <label className="mb-1 block text-xs font-medium text-brand-navy">EFT payment reference (required)</label>
          <input
            type="text"
            className={inputCls}
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="e.g. FNC-2026-08-01"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Marking paid settles the partner's commissions and notifies them.
          </p>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
        {invoice.state === "submitted" && action === null && (
          <>
            <button type="button" className={successBtn} onClick={() => void runApprove()} disabled={pending || !canFinancialAct}>
              <CheckCircle2 className="h-4 w-4" /> {approve.isPending ? "Approving…" : "Approve"}
            </button>
            <button type="button" className={dangerBtn} onClick={() => setAction("reject")} disabled={pending}>
              <XCircle className="h-4 w-4" /> Reject
            </button>
          </>
        )}
        {invoice.state === "submitted" && action === "reject" && (
          <>
            <button type="button" className={dangerBtn} onClick={() => void runReject()} disabled={pending}>
              {reject.isPending ? "Rejecting…" : "Confirm rejection"}
            </button>
            <button type="button" className={secondaryBtn} onClick={() => setAction(null)}>
              Back
            </button>
          </>
        )}
        {invoice.state === "approved" && action === null && (
          <button type="button" className={primaryBtn} onClick={() => setAction("pay")} disabled={pending || !canFinancialAct}>
            <Banknote className="h-4 w-4" /> Mark paid
          </button>
        )}
        {invoice.state === "approved" && action === "pay" && (
          <>
            <button type="button" className={primaryBtn} onClick={() => void runPay()} disabled={pending}>
              {markPaid.isPending ? "Saving…" : "Confirm payment"}
            </button>
            <button type="button" className={secondaryBtn} onClick={() => setAction(null)}>
              Back
            </button>
          </>
        )}
        <button type="button" className={secondaryBtn} onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}
