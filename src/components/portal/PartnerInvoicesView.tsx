import { useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { FilePlus2, ChevronRight, CircleCheck, Clock3, ReceiptText } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { formatZAR } from "@/lib/format";
import { EmptyState } from "@/components/ui/empty-state";
import { PartnerInvoiceStateChip } from "@/components/partner-invoices/PartnerInvoiceStateChip";
import {
  defaultInvoicePeriod,
  formatPeriodRange,
  formatPeriodDate,
  PARTNER_INVOICE_STATES,
  previousInvoicePeriod,
  type PartnerInvoiceState,
} from "@/lib/partnerInvoices";
import {
  useGeneratePartnerInvoice,
  usePartnerInvoiceEligibility,
  usePartnerInvoices,
} from "@/hooks/usePartnerInvoices";

const primaryBtn =
  "inline-flex items-center gap-1.5 rounded-lg bg-brand-teal px-4 py-2 text-sm font-semibold text-white hover:bg-brand-teal/90 disabled:opacity-60";
const secondaryBtn =
  "rounded-lg border border-border px-4 py-2 text-sm font-medium text-brand-navy hover:bg-slate-50";
const inputCls =
  "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/20";

type Filter = "all" | PartnerInvoiceState;

// The partner's own invoices — list, filter, and the "Generate New Invoice"
// entry point. Money shown is the partner's own take only (S7C).
export default function PartnerInvoicesView() {
  const { data: invoices, isLoading, isError, error } = usePartnerInvoices();
  const [filter, setFilter] = useState<Filter>("all");
  const [showGenerate, setShowGenerate] = useState(false);

  const rows = useMemo(() => {
    const all = invoices ?? [];
    return filter === "all" ? all : all.filter((i) => i.state === filter);
  }, [invoices, filter]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-brand-navy">My Invoices</h1>
          <p className="text-sm text-muted-foreground">
            Invoice Fund Now Capital for the commission you've earned.
          </p>
        </div>
        <button type="button" className={primaryBtn} onClick={() => setShowGenerate(true)}>
          <FilePlus2 className="h-4 w-4" />
          Generate New Invoice
        </button>
      </div>

      {/* State filter */}
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

      {isLoading && <p className="text-sm text-muted-foreground">Loading your invoices…</p>}
      {isError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Couldn't load your invoices: {(error as Error)?.message ?? "unknown error"}
        </div>
      )}

      {!isLoading && !isError && rows.length === 0 && (
        <EmptyState
          icon={ReceiptText}
          title={filter === "all" ? "No invoices yet" : `No ${filter} invoices`}
          description={
            filter === "all"
              ? "When Fund Now Capital has received a funder's payment on one of your deals, generate an invoice to get paid your share."
              : "Try a different filter."
          }
        />
      )}

      {!isLoading && !isError && rows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-border bg-white">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-medium">Number</th>
                <th className="px-4 py-3 font-medium">Period</th>
                <th className="px-4 py-3 text-right font-medium">Amount</th>
                <th className="px-4 py-3 font-medium">State</th>
                <th className="px-4 py-3 font-medium">Submitted</th>
                <th className="px-4 py-3 font-medium">Paid</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((inv) => (
                <tr key={inv.id} className="border-b border-border/60 hover:bg-slate-50">
                  <td className="px-4 py-3 font-semibold text-brand-navy">
                    <Link to={`/partner/invoices/${inv.id}`} className="hover:text-brand-teal">
                      {inv.invoice_number}
                    </Link>
                  </td>
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
                  <td className="px-4 py-3 text-muted-foreground">{formatPeriodDate(inv.paid_at)}</td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      to={`/partner/invoices/${inv.id}`}
                      className="inline-flex items-center text-brand-teal hover:underline"
                      aria-label={`Open ${inv.invoice_number}`}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showGenerate && <GenerateDialog onClose={() => setShowGenerate(false)} />}
    </div>
  );
}

function GenerateDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const generate = useGeneratePartnerInvoice();
  const defaults = defaultInvoicePeriod();
  const [start, setStart] = useState(defaults.start);
  const [end, setEnd] = useState(defaults.end);
  const submittingRef = useRef(false);
  const eligibility = usePartnerInvoiceEligibility(start, end);

  const setPeriod = (period: { start: string; end: string }) => {
    setStart(period.start);
    setEnd(period.end);
  };

  const create = async () => {
    if (submittingRef.current) return; // synchronous double-submit guard (FIX #4)
    if (!start || !end || end < start) {
      toast.error("Choose a valid period (end on or after start).");
      return;
    }
    submittingRef.current = true;
    try {
      const res = await generate.mutateAsync({ periodStart: start, periodEnd: end });
      if (res?.was_created) {
        toast.success(`Draft invoice ${res.invoice_number} created — ${res.count} item(s)`);
        onClose();
        navigate(`/partner/invoices/${res.invoice_id as string}`);
      } else {
        toast.info(
          eligibility.summary?.readyCount
            ? "Commission is ready, but it falls outside the selected period. Choose ‘Use ready period’."
            : "No commission is ready to invoice yet. See the status explanation in this window.",
        );
      }
    } catch (e) {
      toast.error((e as Error).message || "Could not generate the invoice");
    } finally {
      submittingRef.current = false;
    }
  };

  return (
    <Modal title="Generate a new invoice" onClose={onClose} maxWidth="max-w-md">
      <p className="text-sm text-muted-foreground">
        Pick the period to invoice. We'll gather every commission that became ready to pay in that
        window into a draft you can review before submitting.
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={secondaryBtn} onClick={() => setPeriod(defaultInvoicePeriod())}>
          Current month
        </button>
        <button type="button" className={secondaryBtn} onClick={() => setPeriod(previousInvoicePeriod())}>
          Previous month
        </button>
        {eligibility.summary?.readyStart && eligibility.summary.readyEnd && (
          <button
            type="button"
            className={secondaryBtn}
            onClick={() =>
              setPeriod({
                start: eligibility.summary!.readyStart!,
                end: eligibility.summary!.readyEnd!,
              })
            }
          >
            Use ready period
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-brand-navy">Period start</label>
          <input type="date" className={inputCls} value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-brand-navy">Period end</label>
          <input type="date" className={inputCls} value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
      </div>
      <EligibilitySummary
        isLoading={eligibility.isLoading}
        error={eligibility.error as Error | null}
        summary={eligibility.summary}
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          className={primaryBtn}
          disabled={generate.isPending || eligibility.isLoading || !eligibility.summary?.selectedCount}
          onClick={create}
        >
          {generate.isPending ? "Generating…" : "Generate draft"}
        </button>
        <button type="button" className={secondaryBtn} onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

function EligibilitySummary({
  isLoading,
  error,
  summary,
}: {
  isLoading: boolean;
  error: Error | null;
  summary: ReturnType<typeof usePartnerInvoiceEligibility>["summary"];
}) {
  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Checking commission eligibility…</p>;
  }
  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
        Couldn't check invoice eligibility: {error.message}
      </div>
    );
  }
  if (!summary) return null;

  if (summary.selectedCount > 0) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
        <div className="flex items-center gap-2 font-semibold">
          <CircleCheck className="h-4 w-4" />
          {summary.selectedCount} commission{summary.selectedCount === 1 ? "" : "s"} ready —{" "}
          {formatZAR(summary.selectedAmount, { cents: true })}
        </div>
        <p className="mt-1">Generate the draft, review its line items, then submit it to FNC.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
      <div className="flex items-center gap-2 font-semibold">
        <Clock3 className="h-4 w-4" />
        Nothing is ready in the selected period
      </div>
      {summary.readyCount > 0 ? (
        <p className="mt-1">
          {summary.readyCount} commission{summary.readyCount === 1 ? " is" : "s are"} ready outside
          this period ({formatZAR(summary.readyAmount, { cents: true })}). Choose{" "}
          <strong>Use ready period</strong>.
        </p>
      ) : (
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>{summary.awaitingFunderCount} awaiting the funder's payment</li>
          <li>{summary.awaitingInvoiceCount} funded but not yet on an issued funder invoice</li>
          <li>{summary.alreadyIncludedCount} already included in another partner invoice</li>
        </ul>
      )}
    </div>
  );
}
