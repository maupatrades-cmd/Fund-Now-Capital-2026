import { useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { FilePlus2, ChevronRight, ReceiptText, CircleCheck, Clock3 } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { formatZAR } from "@/lib/format";
import { EmptyState } from "@/components/ui/empty-state";
import { ContractorInvoiceStateChip } from "@/components/contractor-invoices/ContractorInvoiceStateChip";
import {
  defaultInvoicePeriod,
  formatPeriodRange,
  formatPeriodDate,
  CONTRACTOR_INVOICE_STATES,
  previousInvoicePeriod,
  type ContractorInvoiceState,
  type ContractorInvoiceableSummary,
} from "@/lib/contractorInvoices";
import {
  useContractorInvoices,
  useContractorInvoiceableSummary,
  useGenerateContractorInvoice,
} from "@/hooks/useContractorInvoices";

const primaryBtn =
  "inline-flex items-center gap-1.5 rounded-lg bg-brand-teal px-4 py-2 text-sm font-semibold text-white hover:bg-brand-teal/90 disabled:opacity-60";
const secondaryBtn =
  "rounded-lg border border-border px-4 py-2 text-sm font-medium text-brand-navy hover:bg-slate-50";
const inputCls =
  "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/20";

type Filter = "all" | ContractorInvoiceState;

// The contractor's own invoices — list, filter, and the "Generate New Invoice"
// entry point. Money shown is the contractor's own take only (S7C).
export default function ContractorInvoicesView() {
  const { data: invoices, isLoading, isError, error } = useContractorInvoices();
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
              ? "Once Fund Now Capital has received a funder's payment on one of your deals, your commission becomes payable — generate an invoice to get paid."
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
                    <Link to={`/contractor/invoices/${inv.id}`} className="hover:text-brand-teal">
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
                    <ContractorInvoiceStateChip state={inv.state} />
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{formatPeriodDate(inv.submitted_at)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{formatPeriodDate(inv.paid_at)}</td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      to={`/contractor/invoices/${inv.id}`}
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
  const generate = useGenerateContractorInvoice();
  const defaults = defaultInvoicePeriod();
  const [start, setStart] = useState(defaults.start);
  const [end, setEnd] = useState(defaults.end);
  const submittingRef = useRef(false);
  const eligibility = useContractorInvoiceableSummary(start, end);
  const summary = eligibility.data ?? null;

  const setPeriod = (period: { start: string; end: string }) => {
    setStart(period.start);
    setEnd(period.end);
  };

  const create = async () => {
    if (submittingRef.current) return; // synchronous double-submit guard
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
        navigate(`/contractor/invoices/${res.invoice_id as string}`);
      } else {
        toast.info(
          summary && summary.ready_count > 0
            ? "Commission is payable, but it falls outside the selected period. Choose ‘Use ready period’."
            : "No commission is payable in that period yet. Commission becomes payable once Fund Now Capital has received the funder's payment on your deal — try a wider period.",
        );
      }
    } catch (e) {
      toast.error((e as Error).message || "Could not generate the invoice");
    } finally {
      submittingRef.current = false;
    }
  };

  // Only hard-disable when we KNOW the selected period is empty (a successful
  // preview with 0 selected). If the preview errored (RPC not deployed yet) or is
  // still loading, keep Generate enabled — the generate RPC no-ops safely.
  const knownEmpty = !!summary && summary.selected_count === 0;

  return (
    <Modal title="Generate a new invoice" onClose={onClose} maxWidth="max-w-md">
      <p className="text-sm text-muted-foreground">
        Pick the period to invoice. We'll gather every commission that became payable in that window
        into a draft you can review before submitting.
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={secondaryBtn} onClick={() => setPeriod(defaultInvoicePeriod())}>
          Current month
        </button>
        <button type="button" className={secondaryBtn} onClick={() => setPeriod(previousInvoicePeriod())}>
          Previous month
        </button>
        {summary?.ready_start && summary.ready_end && (
          <button
            type="button"
            className={secondaryBtn}
            onClick={() => setPeriod({ start: summary.ready_start!, end: summary.ready_end! })}
          >
            Use ready period
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-brand-navy" htmlFor="ci-period-start">
            Period start
          </label>
          <input
            id="ci-period-start"
            type="date"
            className={inputCls}
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-brand-navy" htmlFor="ci-period-end">
            Period end
          </label>
          <input
            id="ci-period-end"
            type="date"
            className={inputCls}
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </div>
      </div>
      <EligibilitySummary
        isLoading={eligibility.isLoading}
        isError={eligibility.isError}
        summary={summary}
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          className={primaryBtn}
          disabled={generate.isPending || knownEmpty}
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

// Take-only eligibility preview (S7C). Silent when the RPC isn't available yet
// (isError) — the generate action still works and reports its own result.
function EligibilitySummary({
  isLoading,
  isError,
  summary,
}: {
  isLoading: boolean;
  isError: boolean;
  summary: ContractorInvoiceableSummary | null;
}) {
  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Checking what's ready to invoice…</p>;
  }
  if (isError || !summary) return null;

  if (summary.selected_count > 0) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
        <div className="flex items-center gap-2 font-semibold">
          <CircleCheck className="h-4 w-4" />
          {summary.selected_count} commission{summary.selected_count === 1 ? "" : "s"} ready —{" "}
          {formatZAR(summary.selected_amount, { cents: true })}
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
      {summary.ready_count > 0 ? (
        <p className="mt-1">
          {summary.ready_count} commission{summary.ready_count === 1 ? " is" : "s are"} ready outside
          this period ({formatZAR(summary.ready_amount, { cents: true })}). Choose{" "}
          <strong>Use ready period</strong>.
        </p>
      ) : (
        <p className="mt-1">
          Commission becomes payable once Fund Now Capital has received the funder's payment on your
          deal.
        </p>
      )}
    </div>
  );
}
