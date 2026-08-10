import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, XCircle, Eye, ReceiptText } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { formatZAR } from "@/lib/format";
import { EmptyState } from "@/components/ui/empty-state";
import { ContractorInvoiceStateChip } from "@/components/contractor-invoices/ContractorInvoiceStateChip";
import { ContractorLineItemsTable } from "@/components/contractor-invoices/ContractorLineItemsTable";
import { ContractorInvoicePdfButton } from "@/components/contractor-invoices/ContractorInvoicePdfButton";
import {
  formatPeriodRange,
  formatPeriodDate,
  CONTRACTOR_INVOICE_STATES,
  type OwnerContractorInvoiceRow,
  type ContractorInvoiceState,
} from "@/lib/contractorInvoices";
import {
  useOwnerContractorInvoices,
  useContractorInvoiceLineItems,
  useApproveContractorInvoice,
  useRejectContractorInvoice,
} from "@/hooks/useContractorInvoices";

const successBtn =
  "inline-flex items-center gap-1.5 rounded-lg bg-brand-green px-4 py-2 text-sm font-semibold text-white hover:bg-brand-green/90 disabled:opacity-60";
const dangerBtn =
  "inline-flex items-center gap-1.5 rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60";
const secondaryBtn =
  "rounded-lg border border-border px-4 py-2 text-sm font-medium text-brand-navy hover:bg-slate-50";
const inputCls =
  "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/20";

type Filter = "all" | ContractorInvoiceState;

// Owner review surface for contractor invoices (Build 8 RPCs). The owner sees the
// real contractor name here and the neutral line-item detail (contractor take;
// contractor tier rows carry no funder name). Approve/reject only — mark-paid +
// EFT proof + atomic settle land in Build 10.
export default function ContractorApprovalsPage() {
  const { data: invoices, isLoading, isError, error } = useOwnerContractorInvoices();
  // Default to the queue that needs action.
  const [filter, setFilter] = useState<Filter>("submitted");
  const [selected, setSelected] = useState<OwnerContractorInvoiceRow | null>(null);

  const rows = useMemo(() => {
    const all = invoices ?? [];
    return filter === "all" ? all : all.filter((i) => i.state === filter);
  }, [invoices, filter]);

  const submittedCount = (invoices ?? []).filter((i) => i.state === "submitted").length;

  return (
    <div className="max-w-5xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-brand-navy">Contractor Invoices</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Review and approve invoices your contractors raise for their commission.
          {submittedCount > 0 && (
            <span className="ml-1 font-medium text-brand-navy">
              {submittedCount} awaiting your approval.
            </span>
          )}
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {(["all", ...CONTRACTOR_INVOICE_STATES] as Filter[]).map((f) => (
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

      {isLoading && <p className="text-sm text-muted-foreground">Loading contractor invoices…</p>}
      {isError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Couldn't load contractor invoices: {(error as Error)?.message ?? "unknown error"}
        </div>
      )}

      {!isLoading && !isError && rows.length === 0 && (
        <EmptyState
          icon={ReceiptText}
          title={filter === "submitted" ? "Nothing awaiting approval" : `No ${filter} invoices`}
          description={
            filter === "submitted"
              ? "When a contractor submits an invoice for their commission, it lands here for your approval."
              : "Try a different filter."
          }
        />
      )}

      {!isLoading && !isError && rows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-border bg-white">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-medium">Contractor</th>
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
                  <td className="px-4 py-3 font-medium text-brand-navy">
                    {inv.contractor?.full_name ?? "—"}
                  </td>
                  <td className="px-4 py-3 font-semibold text-brand-navy">{inv.invoice_number}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {formatPeriodRange(inv.invoice_period_start, inv.invoice_period_end)}
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-brand-navy">
                    {formatZAR(inv.total_amount, { cents: true })}
                  </td>
                  <td className="px-4 py-3">
                    <ContractorInvoiceStateChip state={inv.state} />
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

      {selected && <InvoiceReviewModal invoice={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

type ActionKind = "reject" | null;

function InvoiceReviewModal({
  invoice,
  onClose,
}: {
  invoice: OwnerContractorInvoiceRow;
  onClose: () => void;
}) {
  const { data: items, isLoading, isError: itemsError } = useContractorInvoiceLineItems(invoice.id);
  const [action, setAction] = useState<ActionKind>(null);
  const [reason, setReason] = useState("");

  const approve = useApproveContractorInvoice();
  const reject = useRejectContractorInvoice();
  const busyRef = useRef(false);

  // Never let the owner approve while the line items are silently unavailable —
  // approving requires a clean line-item load.
  const canFinancialAct = !itemsError && !isLoading;
  const contractorName = invoice.contractor?.full_name ?? "Contractor";

  const runApprove = async () => {
    if (busyRef.current) return; // synchronous double-submit guard
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

  const pending = approve.isPending || reject.isPending;

  return (
    <Modal title={`${contractorName} · ${invoice.invoice_number}`} onClose={onClose} maxWidth="max-w-2xl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-muted-foreground">
          Period {formatPeriodRange(invoice.invoice_period_start, invoice.invoice_period_end)}
        </div>
        <div className="flex items-center gap-3">
          {invoice.state !== "draft" && (
            <ContractorInvoicePdfButton invoiceId={invoice.id} invoiceNumber={invoice.invoice_number} />
          )}
          <ContractorInvoiceStateChip state={invoice.state} />
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading line items…</p>
      ) : itemsError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          Couldn't load this invoice's line items. Approve is disabled until they load — reload the
          page to try again.
        </div>
      ) : (
        <ContractorLineItemsTable invoiceId={invoice.id} items={items ?? []} />
      )}

      {invoice.state === "rejected" && invoice.rejected_reason && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <span className="font-medium">Rejected:</span> {invoice.rejected_reason}
        </div>
      )}
      {invoice.state === "approved" && (
        <div className="rounded-lg border border-brand-teal/30 bg-brand-teal/5 p-3 text-sm text-brand-navy">
          Approved {formatPeriodDate(invoice.approved_at)} — awaiting payment. Recording the EFT
          payment and settling the contractor's commission arrives in the next build.
        </div>
      )}
      {invoice.state === "paid" && (
        <div className="rounded-lg border border-brand-green/30 bg-brand-green/5 p-3 text-sm text-brand-navy">
          Paid {formatPeriodDate(invoice.paid_at)}
          {invoice.paid_reference ? ` — reference ${invoice.paid_reference}` : ""}.
        </div>
      )}

      {/* Reject reason sub-form */}
      {action === "reject" && (
        <div>
          <label className="mb-1 block text-xs font-medium text-brand-navy" htmlFor="ci-reject-reason">
            Rejection reason (required)
          </label>
          <textarea
            id="ci-reject-reason"
            rows={2}
            className={inputCls}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Explain what needs to change so the contractor can re-invoice."
          />
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
        {invoice.state === "submitted" && action === null && (
          <>
            <button
              type="button"
              className={successBtn}
              onClick={() => void runApprove()}
              disabled={pending || !canFinancialAct}
            >
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
        <button type="button" className={secondaryBtn} onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}
