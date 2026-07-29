import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Plus, ArrowUpDown, ArrowUp, ArrowDown, Building2, SearchX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { useClients, one, type ClientListRow } from "@/hooks/useClients";
import { referredByMeta } from "@/lib/clients";

type SortKey = "name" | "sector" | "deals" | "added";
type SortDir = "asc" | "desc";

function primaryContact(c: ClientListRow): string {
  const list = c.contacts ?? [];
  const primary = list.find((x) => x.is_primary_director) ?? list[0];
  return primary?.full_name ?? "—";
}
function dealCount(c: ClientListRow): number {
  return c.deals?.[0]?.count ?? 0;
}
function partnerName(c: ClientListRow): string | null {
  return one(c.referral_partner)?.name ?? null;
}
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function ClientsPage() {
  const navigate = useNavigate();
  const { data, isLoading, isError, error } = useClients();
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const rows = useMemo(() => {
    const list = data ?? [];
    const q = search.trim().toLowerCase();
    const filtered = q
      ? list.filter(
          (c) =>
            c.business_name.toLowerCase().includes(q) ||
            (c.sector ?? "").toLowerCase().includes(q) ||
            primaryContact(c).toLowerCase().includes(q),
        )
      : list;

    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "name":
          cmp = a.business_name.localeCompare(b.business_name);
          break;
        case "sector":
          cmp = (a.sector ?? "").localeCompare(b.sector ?? "");
          break;
        case "deals":
          cmp = dealCount(a) - dealCount(b);
          break;
        case "added":
          cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
          break;
      }
      return cmp * dir;
    });
  }, [data, search, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
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
            placeholder="Search clients by name, sector or contact…"
            className="w-full rounded-lg border border-border bg-white py-2.5 pl-10 pr-3 text-sm outline-none focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/20"
          />
        </div>
        <button
          type="button"
          onClick={() => navigate("/clients/new")}
          className="flex items-center gap-2 rounded-lg bg-brand-teal px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-teal/90"
        >
          <Plus className="h-4 w-4" />
          Add client
        </button>
      </div>

      {!isLoading && !isError && rows.length === 0 ? (
        search ? (
          <EmptyState
            icon={SearchX}
            title={`No clients match "${search}"`}
            description="Try a different name, sector, or contact."
            action={
              <button
                type="button"
                onClick={() => setSearch("")}
                className="inline-flex items-center rounded-lg border border-border px-4 py-2 text-sm font-medium text-brand-navy hover:bg-slate-50"
              >
                Clear search
              </button>
            }
          />
        ) : (
          <EmptyState
            icon={Building2}
            title="No clients yet"
            description="Add a client to start tracking their deals, documents and story."
            action={
              <button
                type="button"
                onClick={() => navigate("/clients/new")}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand-teal px-4 py-2 text-sm font-semibold text-white hover:bg-brand-teal/90"
              >
                <Plus className="h-4 w-4" /> Add your first client
              </button>
            }
          />
        )
      ) : (
        <>
      <div className="overflow-x-auto rounded-xl border border-border bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <SortHeader label="Business" col="name" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <SortHeader label="Sector" col="sector" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <th className="px-4 py-3 font-semibold">Primary contact</th>
              <th className="px-4 py-3 font-semibold">Referred by</th>
              <SortHeader label="Deals" col="deals" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <SortHeader label="Added" col="added" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  Loading clients…
                </td>
              </tr>
            )}
            {isError && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-red-600">
                  Couldn't load clients: {(error as Error)?.message}
                </td>
              </tr>
            )}
            {rows.map((c) => {
              const meta = referredByMeta(partnerName(c));
              return (
                <tr
                  key={c.id}
                  onClick={() => navigate(`/clients/${c.id}`)}
                  className="cursor-pointer border-b border-border last:border-0 hover:bg-slate-50"
                >
                  <td className="px-4 py-3 font-medium text-brand-navy">{c.business_name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{c.sector || "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{primaryContact(c)}</td>
                  <td className="px-4 py-3">
                    <Badge className={meta.className}>{meta.label}</Badge>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{dealCount(c)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{fmtDate(c.created_at)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">{rows.length} client{rows.length === 1 ? "" : "s"}</p>
        </>
      )}
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
      <button type="button" onClick={() => onClick(col)} className="flex items-center gap-1.5 hover:text-brand-navy">
        {label}
        <Icon className="h-3.5 w-3.5" />
      </button>
    </th>
  );
}
