import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Banknote, CircleDollarSign, FileText, HandCoins, ReceiptText, Send } from "lucide-react";
import { DispatchInvoiceButton } from "@/components/invoices/DispatchInvoiceButton";
import { useDashboard, businessName } from "@/hooks/useDashboard";
import { useInvoiceDispatches, type InvoiceDispatch } from "@/hooks/useInvoiceDispatches";
import { useInvoices } from "@/hooks/useInvoices";
import { usePayoutReconciliation } from "@/hooks/usePayoutReconciliation";
import { formatZAR } from "@/lib/format";
import type { InvoiceListRow } from "@/lib/invoices";

export default function MoneyCommandCenterPage() {
  const dashboard = useDashboard();
  const invoices = useInvoices();
  const dispatches = useInvoiceDispatches();
  const payouts = usePayoutReconciliation();

  const latestDispatch = useMemo(() => {
    const byInvoice = new Map<string, InvoiceDispatch>();
    for (const attempt of dispatches.data ?? []) {
      const current = byInvoice.get(attempt.invoice_id);
      if (!current || attempt.attempt_number > current.attempt_number) byInvoice.set(attempt.invoice_id, attempt);
    }
    return byInvoice;
  }, [dispatches.data]);

  const allInvoices = invoices.data ?? [];
  const drafts = allInvoices.filter((invoice) => invoice.state === "draft");
  const awaitingReceipt = allInvoices.filter((invoice) => invoice.state === "issued" || invoice.state === "overdue");
  const dispatchAttention = awaitingReceipt.filter((invoice) => {
    const attempt = latestDispatch.get(invoice.id);
    return !attempt || attempt.status === "failed" || attempt.status === "bounced";
  });
  const fundedDeals = dashboard.metrics?.actions.fundedNotInvoiced ?? [];
  const payable = payouts.partnerTotals.payable + payouts.contractorTotals.payable;
  const awaitingPayoutApproval = payouts.partnerTotals.awaitingApproval + payouts.contractorTotals.awaitingApproval;
  const awaitingPayoutPayment = payouts.partnerTotals.awaitingPayment + payouts.contractorTotals.awaitingPayment;
  const isLoading = dashboard.isLoading || invoices.isLoading || dispatches.isLoading || payouts.isLoading;
  const error = dashboard.error ?? invoices.error ?? dispatches.error ?? payouts.error;

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading the money lifecycle…</p>;
  if (error) return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">Couldn&apos;t load the money lifecycle: {(error as Error).message}</div>;

  return (
    <div className="max-w-7xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-brand-navy">Money command centre</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          One owner-only path from recorded funding to the funder invoice, cleared receipt and downstream partner or contractor settlement.
        </p>
      </header>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <LifecycleTile icon={Banknote} step="1" label="Funded, needs invoice" value={String(fundedDeals.length)} href="/pipeline" />
        <LifecycleTile icon={FileText} step="2" label="Draft funder invoices" value={String(drafts.length)} href="/invoices" />
        <LifecycleTile icon={CircleDollarSign} step="3" label="Awaiting funder receipt" value={formatZAR(awaitingReceipt.reduce((sum, row) => sum + Number(row.total_amount), 0), { cents: true })} href="/invoices" />
        <LifecycleTile icon={HandCoins} step="4" label="Payable downstream" value={formatZAR(payable, { cents: true })} href="/payouts" />
      </div>

      <section className="grid gap-5 xl:grid-cols-2">
        <ActionPanel title="Next owner actions" icon={ReceiptText}>
          {fundedDeals.slice(0, 5).map((deal) => (
            <ActionRow key={deal.id} title={`${deal.reference ?? "Deal"} · ${businessName(deal.client)}`} note="Funding is recorded. Generate the funder invoice from the deal." href={`/deals/${deal.id}`} action="Open deal" />
          ))}
          {drafts.slice(0, 5).map((invoice) => (
            <ActionRow key={invoice.id} title={invoice.invoice_number} note="Review the PDF and issue this draft before dispatch." href={`/invoices/${invoice.id}`} action="Review & issue" />
          ))}
          {fundedDeals.length === 0 && drafts.length === 0 ? <EmptyLine text="No funded deals or draft invoices need action." /> : null}
        </ActionPanel>

        <ActionPanel title="Invoice delivery and receipts" icon={Send}>
          {dispatchAttention.slice(0, 6).map((invoice) => {
            const attempt = latestDispatch.get(invoice.id) ?? null;
            return <DispatchRow key={invoice.id} invoice={invoice} attempt={attempt} />;
          })}
          {dispatchAttention.length === 0 ? <EmptyLine text="No invoice delivery failures or unsent issued invoices." /> : null}
          {awaitingReceipt.filter((invoice) => !dispatchAttention.includes(invoice)).slice(0, 4).map((invoice) => {
            const attempt = latestDispatch.get(invoice.id);
            return <ActionRow key={invoice.id} title={invoice.invoice_number} note={`${attempt ? `Latest email: ${attempt.status}. ` : ""}Record cleared funds only after they appear in the bank.`} href={`/invoices/${invoice.id}`} action="Record receipt" />;
          })}
        </ActionPanel>
      </section>

      <section className="rounded-xl border border-border bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold text-brand-navy">Downstream settlement</h2>
            <p className="mt-1 text-sm text-muted-foreground">Funder payment moves locked eligible commissions to payable. Partner and contractor invoices remain separate approval records.</p>
          </div>
          <Link to="/payouts" className="rounded-lg bg-brand-navy px-4 py-2 text-sm font-semibold text-white">Open payouts</Link>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <MoneyStatus label="Payable, not invoiced" value={payable} />
          <MoneyStatus label="Invoices awaiting approval" value={awaitingPayoutApproval} />
          <MoneyStatus label="Approved, awaiting payment" value={awaitingPayoutPayment} />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link to="/invoices/partner-approvals" className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-brand-navy">Partner invoices</Link>
          <Link to="/invoices/contractor-approvals" className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-brand-navy">Contractor invoices</Link>
        </div>
      </section>

      <p className="text-xs text-muted-foreground">
        Amounts on this page are owner-private. Portal users continue to receive only their authorised share; no gross commission or other payee&apos;s amount is projected here.
      </p>
    </div>
  );
}

function DispatchRow({ invoice, attempt }: { invoice: InvoiceListRow; attempt: InvoiceDispatch | null }) {
  const failed = attempt?.status === "failed" || attempt?.status === "bounced";
  const message = failed && attempt
    ? attempt.failure_message || `Delivery ${attempt.status}.`
    : "Issued PDF has not been queued for email delivery.";
  return <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 py-3 last:border-0"><div><Link to={`/invoices/${invoice.id}`} className="text-sm font-semibold text-brand-navy hover:underline">{invoice.invoice_number}</Link><p className={`mt-0.5 text-xs ${failed ? "text-red-700" : "text-muted-foreground"}`}>{message}</p></div><DispatchInvoiceButton invoiceId={invoice.id} invoiceNumber={invoice.invoice_number} previousAttempt={attempt} /></div>;
}

function LifecycleTile({ icon: Icon, step, label, value, href }: { icon: typeof Banknote; step: string; label: string; value: string; href: string }) {
  return <Link to={href} className="rounded-xl border border-border bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"><div className="flex items-center justify-between"><span className="rounded-full bg-brand-teal/10 px-2 py-1 text-xs font-bold text-brand-teal">Step {step}</span><Icon className="h-5 w-5 text-brand-teal" /></div><p className="mt-4 text-xs font-medium text-muted-foreground">{label}</p><p className="mt-1 text-xl font-bold text-brand-navy">{value}</p></Link>;
}

function ActionPanel({ title, icon: Icon, children }: { title: string; icon: typeof ReceiptText; children: React.ReactNode }) {
  return <section className="rounded-xl border border-border bg-white p-5 shadow-sm"><div className="mb-2 flex items-center gap-2"><Icon className="h-5 w-5 text-brand-teal" /><h2 className="font-semibold text-brand-navy">{title}</h2></div>{children}</section>;
}

function ActionRow({ title, note, href, action }: { title: string; note: string; href: string; action: string }) {
  return <div className="flex items-center justify-between gap-3 border-b border-border/70 py-3 last:border-0"><div><p className="text-sm font-semibold text-brand-navy">{title}</p><p className="mt-0.5 text-xs text-muted-foreground">{note}</p></div><Link to={href} className="shrink-0 text-xs font-semibold text-brand-teal hover:underline">{action}</Link></div>;
}

function EmptyLine({ text }: { text: string }) {
  return <p className="py-6 text-center text-sm text-muted-foreground">{text}</p>;
}

function MoneyStatus({ label, value }: { label: string; value: number }) {
  return <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-lg font-bold text-brand-navy">{formatZAR(value, { cents: true })}</p></div>;
}
