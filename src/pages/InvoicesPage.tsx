import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import { formatZAR, startOfMonth } from "@/lib/format";
import {
  computeAging,
  formatInvoiceDate,
  invoiceStateLabel,
  INVOICE_STATES,
  todaySastISO,
  type InvoiceState,
} from "@/lib/invoices";
import { InvoiceStateChip } from "@/components/invoices/InvoiceStateChip";
import { useInvoices } from "@/hooks/useInvoices";
import { useFunderOptions } from "@/hooks/useDeals";

const inputCls =
  "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/20";

export default function InvoicesPage() {
  const navigate = useNavigate();
  const { data: invoices, isLoading, isError, error } = useInvoices();
  const { data: funders } = useFunderOptions();

  const [states, setStates] = useState<Set<InvoiceState>>(new Set());
  const [funderId, setFunderId] = useState<string>("");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [clientSearch, setClientSearch] = useState<string>("");

  const all = useMemo(() => invoices ?? [], [invoices]);
  const aging = useMemo(() => computeAging(all), [all]);

  // Aging-tile click → focus the table on that state. Paid MTD also sets the
  // issued-date range to first-of-month → today.
  const focusState = (state: InvoiceState, paidMtd = false) => {
    setStates(new Set([state]));
    if (paidMtd) {
      const start = startOfMonth();
      setFrom(
        `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-01`,
      );
      setTo(todaySastISO());
    }
  };

  const toggleState = (s: InvoiceState) => {
    setStates((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  };

  const clearFilters = () => {
    setStates(new Set());
    setFunderId("");
    setFrom("");
    setTo("");
    setClientSearch("");
  };

  const rows = useMemo(() => {
    const q = clientSearch.trim().toLowerCase();
    return all.filter((inv) => {
      if (states.size > 0 && !states.has(inv.state)) return false;
      if (funderId && inv.funder_id !== funderId) return false;
      if (from && inv.issued_date.slice(0, 10) < from) return false;
      if (to && inv.issued_date.slice(0, 10) > to) return false;
      if (q && !inv.client_reference.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [all, states, funderId, from, to, clientSearch]);

  const filtersActive =
    states.size > 0 || !!funderId || !!from || !!to || !!clientSearch.trim();

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading invoices…</div>;
  if (isError) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Couldn't load invoices: {(error as Error)?.message ?? "unknown error"}
      </div>
    );
  }

  // Global empty state — no invoices exist at all.
  if (all.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold text-brand-navy">Invoices</h1>
        <div className="rounded-xl border border-border bg-white p-10 text-center shadow-sm">
          <p className="text-sm text-muted-foreground">
            No invoices yet. Generate your first from a Funded deal.
          </p>
          <Link
            to="/pipeline"
            className="mt-3 inline-block rounded-lg bg-brand-teal px-4 py-2 text-sm font-semibold text-white hover:bg-brand-teal/90"
          >
            Go to pipeline
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold text-brand-navy">Invoices</h1>

      {/* Aging tiles */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <AgingTile
          label="Draft"
          count={aging.draft.count}
          amount={aging.draft.total}
          onClick={() => focusState("draft")}
        />
        <AgingTile
          label="Issued"
          count={aging.issued.count}
          amount={aging.issued.total}
          onClick={() => focusState("issued")}
        />
        <AgingTile
          label="Paid (MTD)"
          count={aging.paidMtd.count}
          amount={aging.paidMtd.total}
          amountLabel="received"
          onClick={() => focusState("paid", true)}
        />
        <AgingTile
          label="Overdue"
          count={aging.overdue.count}
          amount={aging.overdue.total}
          note={aging.overdue.over30 > 0 ? `${aging.overdue.over30} over 30 days` : undefined}
          tone="warn"
          onClick={() => focusState("overdue")}
        />
      </div>

      {/* Filters */}
      <div className="space-y-3 rounded-xl border border-border bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          {INVOICE_STATES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => toggleState(s)}
              className={
                "rounded-full border px-3 py-1 text-xs font-medium " +
                (states.has(s)
                  ? "border-brand-teal bg-brand-teal/10 text-brand-teal"
                  : "border-border text-muted-foreground hover:bg-slate-50")
              }
            >
              {invoiceStateLabel(s)}
            </button>
          ))}
          {filtersActive && (
            <button
              type="button"
              onClick={clearFilters}
              className="ml-auto text-xs font-medium text-brand-teal hover:underline"
            >
              Clear filters
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Funder</label>
            <select className={inputCls} value={funderId} onChange={(e) => setFunderId(e.target.value)}>
              <option value="">All funders</option>
              {(funders ?? []).map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Issued from</label>
            <input type="date" className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Issued to</label>
            <input type="date" className={inputCls} value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Client</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                className={inputCls + " pl-9"}
                value={clientSearch}
                onChange={(e) => setClientSearch(e.target.value)}
                placeholder="Search by name…"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-border bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-3 font-semibold">Invoice</th>
              <th className="px-4 py-3 font-semibold">Client</th>
              <th className="px-4 py-3 font-semibold">Funder</th>
              <th className="px-4 py-3 font-semibold">Amount</th>
              <th className="px-4 py-3 font-semibold">Due</th>
              <th className="px-4 py-3 font-semibold">State</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  No invoices match these filters.
                </td>
              </tr>
            ) : (
              rows.map((inv) => (
                <tr
                  key={inv.id}
                  onClick={() => navigate(`/invoices/${inv.id}`)}
                  className="cursor-pointer border-b border-border last:border-0 hover:bg-slate-50"
                >
                  <td className="px-4 py-3 font-medium text-brand-navy">{inv.invoice_number}</td>
                  <td className="px-4 py-3 text-muted-foreground">{inv.client_reference}</td>
                  <td className="px-4 py-3 text-muted-foreground">{inv.funder?.name ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{formatZAR(inv.total_amount, { cents: true })}</td>
                  <td className="px-4 py-3 text-muted-foreground">{formatInvoiceDate(inv.due_date)}</td>
                  <td className="px-4 py-3">
                    <InvoiceStateChip state={inv.state} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      to={`/invoices/${inv.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="text-sm font-medium text-brand-teal hover:underline"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AgingTile({
  label,
  count,
  amount,
  amountLabel,
  note,
  tone,
  onClick,
}: {
  label: string;
  count: number;
  amount: number;
  amountLabel?: string;
  note?: string;
  tone?: "warn";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "rounded-xl border bg-white p-4 text-left shadow-sm transition hover:shadow-md " +
        (tone === "warn" ? "border-amber-200" : "border-border")
      }
    >
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
        <span className={"text-lg font-bold " + (tone === "warn" ? "text-amber-700" : "text-brand-navy")}>
          {count}
        </span>
      </div>
      <p className="mt-1 text-sm font-medium text-brand-navy">
        {formatZAR(amount)} <span className="text-xs font-normal text-muted-foreground">{amountLabel ?? "total"}</span>
      </p>
      {note && <p className="mt-0.5 text-xs font-medium text-amber-700">{note}</p>}
    </button>
  );
}
