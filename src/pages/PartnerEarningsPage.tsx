import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { formatZAR } from "@/lib/format";
import { formatInvoiceDate } from "@/lib/invoices";
import {
  computePartnerTotals,
  computeStateBuckets,
  EARNING_STATES,
  earningStateLabel,
  filterEarnings,
  firstOfMonthISO,
  firstOfYearISO,
  LIVE_EARNING_STATES,
  todayISO,
  type EarningRow,
  type EarningState,
  type LiveEarningState,
  type StateBucket,
} from "@/lib/partnerEarnings";
import { EarningStateChip } from "@/components/earnings/EarningStateChip";
import { EarningDetailModal } from "@/components/earnings/EarningDetailModal";
import { usePartnerEarnings } from "@/hooks/usePartnerEarnings";
import { useReferralPartners } from "@/hooks/useClients";

const inputCls =
  "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/20";

export default function PartnerEarningsPage() {
  const { rows, isLoading, isError, error } = usePartnerEarnings();
  const { data: partners } = useReferralPartners();

  const [partnerId, setPartnerId] = useState<string>("");
  const [states, setStates] = useState<Set<EarningState>>(new Set());
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  const [showVoid, setShowVoid] = useState<boolean>(false);
  const [selected, setSelected] = useState<EarningRow | null>(null);

  // The tiles + per-partner card reflect the selected partner's full backlog
  // (all-time, void excluded) — independent of the table's date/state filters,
  // so "how much is sitting where right now" stays truthful.
  const partnerScoped = useMemo(
    () => (partnerId ? rows.filter((r) => r.partnerId === partnerId) : rows),
    [rows, partnerId],
  );
  const buckets = useMemo(() => computeStateBuckets(partnerScoped), [partnerScoped]);
  const partnerTotals = useMemo(() => computePartnerTotals(partnerScoped), [partnerScoped]);

  const tableRows = useMemo(
    () => filterEarnings(rows, { partnerId, states, from, to, search, showVoid }),
    [rows, partnerId, states, from, to, search, showVoid],
  );

  const filtersActive =
    !!partnerId || states.size > 0 || !!from || !!to || !!search.trim() || showVoid;

  const focusState = (s: LiveEarningState) => setStates(new Set([s]));
  const toggleState = (s: EarningState) =>
    setStates((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  const clearFilters = () => {
    setPartnerId("");
    setStates(new Set());
    setFrom("");
    setTo("");
    setSearch("");
    setShowVoid(false);
  };
  const setRange = (f: string, t: string) => {
    setFrom(f);
    setTo(t);
  };

  const selectedPartnerName =
    partnerId && partners ? (partners.find((p) => p.id === partnerId)?.name ?? "partner") : null;

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading partner earnings…</div>;
  if (isError) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Couldn't load partner earnings: {error?.message ?? "unknown error"}
      </div>
    );
  }

  // Global empty state — no commissions or bonuses exist yet.
  if (rows.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold text-brand-navy">Partner Earnings</h1>
        <div className="rounded-xl border border-border bg-white p-10 text-center shadow-sm">
          <p className="text-sm text-muted-foreground">
            No partner earnings yet. They appear automatically when a deal is funded with a referral
            partner, and progress through Earned → Outstanding → Payable → Settled as the funder
            invoice is issued and paid.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-bold text-brand-navy">Partner Earnings</h1>
        {selectedPartnerName && (
          <span className="text-sm text-muted-foreground">
            Showing <span className="font-medium text-brand-navy">{selectedPartnerName}</span>
          </span>
        )}
      </div>

      {/* KPI + aging tiles — current backlog per state (void excluded) */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {LIVE_EARNING_STATES.map((s) => (
          <StateTile key={s} bucket={buckets[s]} onClick={() => focusState(s)} />
        ))}
      </div>

      {/* Per-partner totals card — only when a single partner is selected */}
      {partnerId && (
        <div className="grid grid-cols-2 gap-3 rounded-xl border border-brand-teal/30 bg-brand-teal/5 p-4 sm:grid-cols-4">
          <PartnerStat label="Earned (this month)" value={partnerTotals.earnedMtd} />
          <PartnerStat label="Outstanding" value={partnerTotals.outstanding} />
          <PartnerStat label="Payable now" value={partnerTotals.payable} tone="action" />
          <PartnerStat label="Settled (YTD)" value={partnerTotals.settledYtd} tone="done" />
        </div>
      )}

      {/* Filters */}
      <div className="space-y-3 rounded-xl border border-border bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          {EARNING_STATES.map((s) => (
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
              {earningStateLabel(s)}
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
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Partner</label>
            <select className={inputCls} value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
              <option value="">All partners</option>
              {(partners ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">From</label>
            <input type="date" className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">To</label>
            <input type="date" className={inputCls} value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Deal or client</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                className={inputCls + " pl-9"}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="DEAL-001 or business name…"
              />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">Quick range:</span>
          <RangeChip label="This month" onClick={() => setRange(firstOfMonthISO(), todayISO())} />
          <RangeChip label="This year" onClick={() => setRange(firstOfYearISO(), todayISO())} />
          <RangeChip label="All time" onClick={() => setRange("", "")} />
          <label className="ml-auto flex cursor-pointer items-center gap-2 text-muted-foreground">
            <input type="checkbox" checked={showVoid} onChange={(e) => setShowVoid(e.target.checked)} />
            Show voided
          </label>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-border bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-3 font-semibold">Partner</th>
              <th className="px-4 py-3 font-semibold">Deal</th>
              <th className="px-4 py-3 font-semibold">Funder</th>
              <th className="px-4 py-3 font-semibold">Client</th>
              <th className="px-4 py-3 text-right font-semibold">Amount</th>
              <th className="px-4 py-3 font-semibold">State</th>
              <th className="px-4 py-3 font-semibold">Since</th>
            </tr>
          </thead>
          <tbody>
            {tableRows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  No earnings match these filters.
                </td>
              </tr>
            ) : (
              tableRows.map((row) => (
                <tr
                  key={`${row.kind}:${row.id}`}
                  onClick={() => setSelected(row)}
                  className="cursor-pointer border-b border-border last:border-0 hover:bg-slate-50"
                >
                  <td className="px-4 py-3 text-muted-foreground">{row.partnerName ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span className="font-medium text-brand-navy">{row.dealReference ?? "—"}</span>
                    {row.kind === "bonus" && (
                      <span className="ml-2 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700">
                        Bonus
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{row.funderName ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{row.clientName ?? "—"}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-brand-navy">
                    {formatZAR(row.amount, { cents: true })}
                  </td>
                  <td className="px-4 py-3">
                    <EarningStateChip state={row.state} />
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {row.state === "void" ? "—" : formatInvoiceDate(stateTimestamp(row))}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {selected && <EarningDetailModal row={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

// The lifecycle timestamp for the row's current state (for the "Since" column).
function stateTimestamp(row: EarningRow): string | null {
  switch (row.state) {
    case "earned":
      return row.earnedAt;
    case "outstanding":
      return row.outstandingAt;
    case "payable":
      return row.payableAt;
    case "settled":
      return row.settledAt;
    default:
      return null;
  }
}

function StateTile({ bucket, onClick }: { bucket: StateBucket; onClick: () => void }) {
  const isAction = bucket.state === "payable";
  const isDone = bucket.state === "settled";
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "rounded-xl border bg-white p-4 text-left shadow-sm transition hover:shadow-md " +
        (isAction ? "border-amber-200" : "border-border")
      }
    >
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {earningStateLabel(bucket.state)}
        </span>
        <span
          className={
            "text-lg font-bold " +
            (isAction ? "text-amber-700" : isDone ? "text-brand-green" : "text-brand-navy")
          }
        >
          {bucket.count}
        </span>
      </div>
      <p className="mt-1 text-sm font-medium text-brand-navy">
        {formatZAR(bucket.total)} <span className="text-xs font-normal text-muted-foreground">total</span>
      </p>
      {bucket.count > 0 && (
        <p className="mt-0.5 text-xs text-muted-foreground">oldest {bucket.oldestDays}d</p>
      )}
    </button>
  );
}

function PartnerStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "action" | "done";
}) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p
        className={
          "text-lg font-bold " +
          (tone === "action" ? "text-amber-700" : tone === "done" ? "text-brand-green" : "text-brand-navy")
        }
      >
        {formatZAR(value)}
      </p>
    </div>
  );
}

function RangeChip({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full border border-border px-2.5 py-1 font-medium text-muted-foreground hover:bg-slate-50"
    >
      {label}
    </button>
  );
}
