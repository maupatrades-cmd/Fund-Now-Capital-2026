import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Plus, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useFunders, type Funder } from "@/hooks/useFunders";
import {
  agreementMeta,
  funderTypeLabel,
  formatTicketRange,
} from "@/lib/funders";

type SortKey = "name" | "type" | "ticket" | "status";
type SortDir = "asc" | "desc";

function ticketMin(f: Funder): number {
  return f.ticket_min == null ? Number.POSITIVE_INFINITY : Number(f.ticket_min);
}

export default function FundersPage() {
  const navigate = useNavigate();
  const { data: funders, isLoading, isError, error } = useFunders();
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const rows = useMemo(() => {
    const list = funders ?? [];
    const q = search.trim().toLowerCase();
    const filtered = q
      ? list.filter(
          (f) =>
            f.name.toLowerCase().includes(q) ||
            funderTypeLabel(f.funder_type).toLowerCase().includes(q),
        )
      : list;

    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "name":
          cmp = a.name.localeCompare(b.name);
          break;
        case "type":
          cmp = funderTypeLabel(a.funder_type).localeCompare(funderTypeLabel(b.funder_type));
          break;
        case "ticket":
          cmp = ticketMin(a) - ticketMin(b);
          break;
        case "status":
          cmp = (a.agreement_status ?? "").localeCompare(b.agreement_status ?? "");
          break;
      }
      return cmp * dir;
    });
  }, [funders, search, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search funders by name or product…"
            className="w-full rounded-lg border border-border bg-white py-2.5 pl-10 pr-3 text-sm outline-none focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/20"
          />
        </div>
        <button
          type="button"
          onClick={() => navigate("/funders/new")}
          className="flex items-center gap-2 rounded-lg bg-brand-teal px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-teal/90"
        >
          <Plus className="h-4 w-4" />
          Add funder
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <SortHeader label="Funder" col="name" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <SortHeader label="Product type" col="type" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <SortHeader label="Ticket range" col="ticket" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <SortHeader label="Agreement" col="status" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                  Loading funders…
                </td>
              </tr>
            )}
            {isError && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-red-600">
                  Couldn't load funders: {(error as Error)?.message}
                </td>
              </tr>
            )}
            {!isLoading && !isError && rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                  No funders match "{search}".
                </td>
              </tr>
            )}
            {rows.map((f) => {
              const meta = agreementMeta(f.agreement_status);
              return (
                <tr
                  key={f.id}
                  onClick={() => navigate(`/funders/${f.id}`)}
                  className="cursor-pointer border-b border-border last:border-0 hover:bg-slate-50"
                >
                  <td className="px-4 py-3 font-medium text-brand-navy">{f.name}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {funderTypeLabel(f.funder_type)}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {formatTicketRange(f.ticket_min, f.ticket_max)}
                  </td>
                  <td className="px-4 py-3">
                    <Badge className={meta.badgeClass}>{meta.label}</Badge>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        {rows.length} funder{rows.length === 1 ? "" : "s"} · real names are visible to
        owners only.
      </p>
    </div>
  );
}

function SortHeader({
  label,
  col,
  sortKey,
  sortDir,
  onClick,
}: {
  label: string;
  col: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onClick: (k: SortKey) => void;
}) {
  const active = col === sortKey;
  const Icon = !active ? ArrowUpDown : sortDir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th className="px-4 py-3 font-semibold">
      <button
        type="button"
        onClick={() => onClick(col)}
        className="flex items-center gap-1.5 hover:text-brand-navy"
      >
        {label}
        <Icon className="h-3.5 w-3.5" />
      </button>
    </th>
  );
}
