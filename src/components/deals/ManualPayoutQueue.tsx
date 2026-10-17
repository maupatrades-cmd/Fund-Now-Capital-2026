import { useState } from "react";
import { Link } from "react-router-dom";
import { useManualPayouts } from "@/hooks/useManualPayouts";
import { effectiveCommission } from "@/lib/ownerCommission";

type Filter = "approved" | "draft" | "paid" | "void" | "all";
const kinds = { agent: "Agent", team_leader: "Team Leader", organisation: "Organisation", external_payee: "Other payee" };

export function ManualPayoutQueue() {
  const query = useManualPayouts();
  const [filter, setFilter] = useState<Filter>("approved");
  const data = query.data;
  const entries = data?.entries.filter((entry) => filter === "all" || entry.status === filter) ?? [];
  const flagCounts = new Map<string, number>();
  for (const flag of data?.flags ?? []) flagCounts.set(flag.entry_id, (flagCounts.get(flag.entry_id) ?? 0) + 1);

  return <section className="space-y-3 rounded-xl border border-border bg-white p-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="font-semibold text-brand-navy">Your manual allocations</h2>
      <div className="flex items-center gap-3">
        <label className="text-sm">Status <select className="ml-2 rounded border p-2" value={filter} onChange={(event) => setFilter(event.target.value as Filter)}>
          <option value="approved">Approved</option><option value="draft">Draft</option>
          <option value="paid">Payment recorded</option><option value="void">Voided</option><option value="all">All</option>
        </select></label>
        <button type="button" className="text-sm underline disabled:opacity-50" disabled={query.isFetching} onClick={() => void query.refetch()}>Refresh</button>
      </div>
    </div>
    <p className="text-sm text-muted-foreground">Approved allocations still need payment review. These amounts are separate from the automatic commission and invoice totals below. Open a deal to review its total, flags and allocation history.</p>
    <p className="text-xs text-muted-foreground">Current allocation includes later adjustments. For a payment recorded earlier, it is not a receipt of the amount transferred.</p>
    {query.isPending ? <p role="status" className="text-sm">Loading manual allocations…</p> : query.isError ?
      <p role="alert" className="text-sm text-red-700">Could not load manual allocations: {query.error.message}</p> :
      entries.length === 0 ? <p className="text-sm text-muted-foreground">No {filter === "all" ? "manual" : filter} allocations.</p> :
      <div className="overflow-x-auto"><table className="w-full min-w-[800px] text-left text-sm">
        <thead><tr className="border-b"><th className="p-2">Payee</th><th className="p-2">Status</th><th className="p-2">Original allocation</th><th className="p-2">Current allocation</th><th className="p-2">Review flags</th><th className="p-2">Payment reference</th><th className="p-2">Deal</th></tr></thead>
        <tbody>{entries.map((entry) => <tr key={entry.id} className="border-b">
          <td className="p-2">{entry.profile?.full_name || entry.organisation?.name || entry.beneficiary_name || "Name unavailable"}<span className="block text-xs text-muted-foreground">{kinds[entry.beneficiary_kind]}</span></td>
          <td className="p-2">{entry.status === "paid" ? "Payment recorded" : entry.status}</td>
          <td className="p-2 tabular-nums">{entry.currency} {effectiveCommission(entry, [])}</td>
          <td className="p-2 tabular-nums">{entry.currency} {effectiveCommission(entry, data?.adjustments ?? [])}</td>
          <td className="p-2">{flagCounts.get(entry.id) ?? 0} open</td>
          <td className="p-2">{entry.payment_reference || "—"}</td>
          <td className="p-2"><Link className="text-brand-teal underline" to={`/deals/${entry.deal_id}`} aria-label={`Review deal for allocation ${entry.id}`}>Review deal</Link></td>
        </tr>)}</tbody>
      </table></div>}
  </section>;
}
