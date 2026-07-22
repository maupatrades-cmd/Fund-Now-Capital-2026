import { Link, useParams } from "react-router-dom";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { formatZAR } from "@/lib/format";
import { formatInvoiceDate } from "@/lib/invoices";
import { InvoiceStateChip } from "@/components/invoices/InvoiceStateChip";
import { InvoicePdfButton } from "@/components/invoices/InvoicePdfButton";
import { InvoiceActions } from "@/components/invoices/InvoiceActions";
import { ActivityFeed } from "@/components/activity/ActivityFeed";
import { useInvoice } from "@/hooks/useInvoices";

export default function InvoiceDetailPage() {
  const { id } = useParams();
  const { data: invoice, isLoading, isError, error } = useInvoice(id);

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading invoice…</div>;
  if (isError || !invoice) {
    return (
      <div className="space-y-3">
        <BackLink />
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Couldn't load invoice: {(error as Error)?.message ?? "not found"}
        </div>
      </div>
    );
  }

  const paid = invoice.state === "paid";

  return (
    <div className="max-w-4xl space-y-5">
      <BackLink />

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-border bg-white p-6 shadow-sm">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold text-brand-navy">{invoice.invoice_number}</h1>
            <InvoiceStateChip state={invoice.state} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {invoice.client_reference} ·{" "}
            <Link to={`/funders/${invoice.funder_id}`} className="text-brand-teal hover:underline">
              {invoice.funder?.name ?? "funder"}
            </Link>
          </p>
        </div>
        <InvoicePdfButton invoice={invoice} />
      </div>

      {/* Detail + actions */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <section className="space-y-4 rounded-xl border border-border bg-white p-5 shadow-sm lg:col-span-2">
          <h3 className="text-sm font-semibold text-brand-navy">Invoice detail</h3>
          <dl className="space-y-2.5 text-sm">
            <Field label="Client reference" value={invoice.client_reference} />
            <Field
              label="Funder"
              value={
                <Link to={`/funders/${invoice.funder_id}`} className="text-brand-teal hover:underline">
                  {invoice.funder?.name ?? "—"}
                </Link>
              }
            />
            <Field label="Facility advanced" value={formatZAR(invoice.facility_advanced, { cents: true })} />
            {invoice.finance_charge_amount != null && (
              <Field label="Finance charge" value={formatZAR(invoice.finance_charge_amount, { cents: true })} />
            )}
            <Field label="Lead Provider Commission" value={formatZAR(invoice.commission_amount, { cents: true })} />
            <Field label="VAT" value="Not VAT registered" />
            <div className="border-t border-border pt-2">
              <Field label="Total due" value={<span className="font-semibold">{formatZAR(invoice.total_amount, { cents: true })}</span>} />
            </div>
            <Field label="Issued date" value={formatInvoiceDate(invoice.issued_date)} />
            <Field label="Payment terms" value={invoice.payment_terms} />
            <Field label="Due date" value={formatInvoiceDate(invoice.due_date)} />
            <Field label="Payment reference" value={invoice.payment_reference_expected} />
            {invoice.contract_reference && <Field label="Contract reference" value={invoice.contract_reference} />}
          </dl>

          <div className="rounded-lg border border-border bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Commission description</p>
            <p className="mt-1 text-sm text-brand-navy">{invoice.commission_description}</p>
          </div>

          {paid && (
            <div className="rounded-lg border border-brand-green/30 bg-brand-green/5 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Payment received</p>
              <dl className="mt-1 space-y-1.5 text-sm">
                <Field label="Amount paid" value={formatZAR(invoice.paid_amount ?? invoice.total_amount, { cents: true })} />
                <Field label="Paid at" value={invoice.paid_at ? new Date(invoice.paid_at).toLocaleString("en-ZA") : "—"} />
                <Field label="Reference received" value={invoice.payment_reference_received ?? "—"} />
              </dl>
            </div>
          )}

          {invoice.notes && (
            <div className="rounded-lg border border-border bg-white p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Notes</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-brand-navy">{invoice.notes}</p>
            </div>
          )}
        </section>

        <section className="space-y-4">
          <div className="rounded-xl border border-border bg-white p-5 shadow-sm">
            <h3 className="mb-3 text-sm font-semibold text-brand-navy">Actions</h3>
            <InvoiceActions invoice={invoice} />
          </div>
          <div className="rounded-xl border border-border bg-white p-5 shadow-sm">
            <h3 className="mb-3 text-sm font-semibold text-brand-navy">Linked</h3>
            <Link
              to={`/deals/${invoice.deal_id}`}
              className="inline-flex items-center gap-1.5 text-sm text-brand-teal hover:underline"
            >
              <ExternalLink className="h-4 w-4" /> {invoice.deal?.reference ?? "Deal"}
            </Link>
          </div>
        </section>
      </div>

      <section className="rounded-xl border border-border bg-white p-5 shadow-sm">
        <ActivityFeed entityId={invoice.id} />
      </section>
    </div>
  );
}

function BackLink() {
  return (
    <Link to="/invoices" className="inline-flex items-center gap-1.5 text-sm text-brand-teal hover:underline">
      <ArrowLeft className="h-4 w-4" /> Back to invoices
    </Link>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium text-brand-navy">{value}</dd>
    </div>
  );
}
