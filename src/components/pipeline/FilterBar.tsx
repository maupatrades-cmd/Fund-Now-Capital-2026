import { X } from "lucide-react";

export type PipelineFilters = {
  funderId: string;
  clientId: string;
  referral: string; // "", "self", "partner"
  from: string;
  to: string;
};

export const EMPTY_FILTERS: PipelineFilters = {
  funderId: "",
  clientId: "",
  referral: "",
  from: "",
  to: "",
};

export function hasAnyFilter(f: PipelineFilters): boolean {
  return !!(f.funderId || f.clientId || f.referral || f.from || f.to);
}

const cls =
  "rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-brand-teal";

export function FilterBar({
  filters,
  onChange,
  clients,
  funders,
}: {
  filters: PipelineFilters;
  onChange: (f: PipelineFilters) => void;
  clients: { id: string; business_name: string }[];
  funders: { id: string; name: string }[];
}) {
  const set = (patch: Partial<PipelineFilters>) => onChange({ ...filters, ...patch });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select className={cls} value={filters.clientId} onChange={(e) => set({ clientId: e.target.value })}>
        <option value="">All clients</option>
        {clients.map((c) => (
          <option key={c.id} value={c.id}>
            {c.business_name}
          </option>
        ))}
      </select>

      <select className={cls} value={filters.funderId} onChange={(e) => set({ funderId: e.target.value })}>
        <option value="">All funders</option>
        {funders.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
      </select>

      <select className={cls} value={filters.referral} onChange={(e) => set({ referral: e.target.value })}>
        <option value="">All sources</option>
        <option value="self">Self</option>
        <option value="partner">Referral partner</option>
      </select>

      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        From
        <input type="date" className={cls} value={filters.from} onChange={(e) => set({ from: e.target.value })} />
      </label>
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        To
        <input type="date" className={cls} value={filters.to} onChange={(e) => set({ to: e.target.value })} />
      </label>

      {hasAnyFilter(filters) && (
        <button
          type="button"
          onClick={() => onChange(EMPTY_FILTERS)}
          className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-2 text-sm text-brand-navy hover:bg-slate-50"
        >
          <X className="h-3.5 w-3.5" /> Clear
        </button>
      )}
    </div>
  );
}
