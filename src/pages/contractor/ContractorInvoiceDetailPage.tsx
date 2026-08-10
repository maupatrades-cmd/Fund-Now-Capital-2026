import { useRef } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, Send, CheckCircle2, Banknote, Info } from "lucide-react";
import PortalShell from "@/components/portal/PortalShell";
import { formatZAR } from "@/lib/format";
import { formatPeriodRange, formatPeriodDate } from "@/lib/contractorInvoices";
import { ContractorInvoiceStateChip } from "@/components/contractor-invoices/ContractorInvoiceStateChip";
import { ContractorLineItemsTable } from "@/components/contractor-invoices/ContractorLineItemsTable";
import { ContractorInvoicePdfButton } from "@/components/contractor-invoices/ContractorInvoicePdfButton";
import {
  useContractorInvoice,
  useContractorInvoiceLineItems,
  useContractorInvoiceSupersessions,
  useSubmitContractorInvoice,
} from "@/hooks/useContractorInvoices";

export default function ContractorInvoiceDetailPage() {
  const { invoiceId } = useParams();
  const { data: invoice, isLoading, isError, error } = useContractorInvoice(invoiceId);
  const { data: items, isError: itemsError } = useContractorInvoiceLineItems(invoiceId);
  const { data: supersessions } = useContractorInvoiceSupersessions(invoiceId);
  const submit = useSubmitContractorInvoice();
  const submittingRef = useRef(false);

  // A downloadable PDF exists once the invoice leaves draft (draft/rejected have
  // no billable artifact to send FNC).
  const hasPdf =
    invoice?.state === "submitted" || invoice?.state === "approved" || invoice?.state === "paid";

  const onSubmit = async () => {
    if (!invoice || submittingRef.current) return; // synchronous double-submit guard
    // Don't confuse a load failure with an empty invoice.
    if (itemsError) {
      toast.error("Couldn't load the line items — reload the page before submitting.");
      return;
    }
    if ((items?.length ?? 0) === 0) {
      toast.error("Add at least one commission before submitting.");
      return;
    }
    submittingRef.current = true;
    try {
      await submit.mutateAsync({ invoiceId: invoice.id });
      toast.success(`Invoice ${invoice.invoice_number} submitted for approval`);
    } catch (e) {
      toast.error((e as Error).message || "Could not submit the invoice");
    } finally {
      submittingRef.current = false;
    }
  };

  return (
    <PortalShell portal="contractor">
      <div className="space-y-5">
        <Link
          to="/contractor/invoices"
          className="inline-flex items-center gap-1.5 text-sm text-brand-teal hover:underline"
        >
          <ArrowLeft className="h-4 w-4" /> Back to my invoices
        </Link>

        {isLoading && <p className="text-sm text-muted-foreground">Loading invoice…</p>}
        {isError && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            Couldn't load this invoice: {(error as Error)?.message ?? "not found"}
          </div>
        )}

        {invoice && (
          <>
            {/* Header */}
            <div className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-border bg-white p-6 shadow-sm">
              <div>
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="text-2xl font-bold text-brand-navy">{invoice.invoice_number}</h1>
                  <ContractorInvoiceStateChip state={invoice.state} />
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Period {formatPeriodRange(invoice.invoice_period_start, invoice.invoice_period_end)}
                </p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <div className="text-right">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Total</p>
                  <p className="text-2xl font-bold text-brand-navy">
                    {formatZAR(invoice.total_amount, { cents: true })}
                  </p>
                </div>
                {hasPdf && (
                  <ContractorInvoicePdfButton
                    invoiceId={invoice.id}
                    invoiceNumber={invoice.invoice_number}
                  />
                )}
              </div>
            </div>

            {/* State-specific banners */}
            {invoice.state === "submitted" && (
              <Banner tone="info" icon={Info}>
                Submitted {formatPeriodDate(invoice.submitted_at)} — awaiting Fund Now Capital's approval.
              </Banner>
            )}
            {invoice.state === "approved" && (
              <Banner tone="success" icon={CheckCircle2}>
                Approved {formatPeriodDate(invoice.approved_at)} — awaiting payment.
              </Banner>
            )}
            {invoice.state === "paid" && (
              <Banner tone="success" icon={Banknote}>
                Paid {formatPeriodDate(invoice.paid_at)}
                {invoice.paid_reference ? ` — payment reference ${invoice.paid_reference}` : ""}.
              </Banner>
            )}
            {invoice.state === "rejected" && (
              <Banner tone="error" icon={Info}>
                Not approved{invoice.rejected_reason ? `: ${invoice.rejected_reason}` : "."} You can
                generate a new invoice for those commissions.
              </Banner>
            )}

            {/* Line items */}
            <section className="space-y-3 rounded-xl border border-border bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-brand-navy">Commissions on this invoice</h2>
                {invoice.state === "draft" && (
                  <span className="text-xs text-muted-foreground">Remove any you don't want to bill yet</span>
                )}
              </div>
              {itemsError ? (
                <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                  Couldn't load the line items on this invoice. Reload the page to try again.
                </div>
              ) : (
                <ContractorLineItemsTable
                  invoiceId={invoice.id}
                  items={items ?? []}
                  editable={invoice.state === "draft"}
                />
              )}
            </section>

            {/* Resubmission trail — rejected invoices this one re-bills (Build 14) */}
            {supersessions && supersessions.length > 0 && (
              <section className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-5">
                <h2 className="text-sm font-semibold text-amber-900">Replaces a rejected invoice</h2>
                <ul className="space-y-1 text-sm text-amber-900">
                  {supersessions.map((s) => (
                    <li key={s.invoice_id}>
                      <span className="font-medium">{s.invoice_number}</span> — rejected
                      {s.rejected_at ? ` ${formatPeriodDate(s.rejected_at)}` : ""}
                      {s.rejected_reason ? `: ${s.rejected_reason}` : "."}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Draft → submit */}
            {invoice.state === "draft" && (
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => void onSubmit()}
                  disabled={submit.isPending || (!itemsError && (items?.length ?? 0) === 0)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-brand-teal px-4 py-2 text-sm font-semibold text-white hover:bg-brand-teal/90 disabled:opacity-60"
                >
                  <Send className="h-4 w-4" />
                  {submit.isPending ? "Submitting…" : "Submit for approval"}
                </button>
                <span className="text-xs text-muted-foreground">
                  Once submitted, the invoice is locked while Fund Now Capital reviews it.
                </span>
              </div>
            )}

            {/* Payment details — shown once approved (awaiting/received payment) */}
            {(invoice.state === "approved" || invoice.state === "paid") && (
              <section className="space-y-2 rounded-xl border border-border bg-slate-50 p-5">
                <h2 className="text-sm font-semibold text-brand-navy">Payment details</h2>
                <p className="text-sm text-muted-foreground">
                  Fund Now Capital pays by EFT to the banking details on your payment profile, per your
                  Independent Contractor Agreement. VAT is added only if your business is VAT-registered.
                </p>
                {invoice.state === "paid" && invoice.paid_reference && (
                  <p className="text-sm text-brand-navy">
                    <span className="font-medium">Payment reference:</span> {invoice.paid_reference}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Keep your banking &amp; VAT details current under Payment settings.
                </p>
              </section>
            )}
          </>
        )}
      </div>
    </PortalShell>
  );
}

function Banner({
  tone,
  icon: Icon,
  children,
}: {
  tone: "info" | "success" | "error";
  icon: typeof Info;
  children: React.ReactNode;
}) {
  const cls =
    tone === "success"
      ? "border-brand-green/30 bg-brand-green/5 text-brand-navy"
      : tone === "error"
        ? "border-red-200 bg-red-50 text-red-700"
        : "border-brand-teal/30 bg-brand-teal/5 text-brand-navy";
  return (
    <div className={"flex items-start gap-2 rounded-xl border p-4 text-sm " + cls}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <p>{children}</p>
    </div>
  );
}
