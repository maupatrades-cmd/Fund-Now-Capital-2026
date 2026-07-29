import { useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, Plus, Users, SearchX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatZAR } from "@/lib/format";
import {
  QUALIFICATION_STAGES,
  QUALIFICATION_BADGE,
  LEAD_STAGE_FILTERS,
  REFERRED_BY,
  FUNDING_TIMELINES,
  labelFor,
} from "@/lib/leads";
import { useLeads, useProfileNames, type LeadFilters } from "@/hooks/useLeads";
import { one } from "@/hooks/useClients";

const inputCls =
  "rounded-lg border border-border bg-white px-3 py-2 text-sm text-brand-navy outline-none focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/20";

export default function LeadsPage() {
  const [filters, setFilters] = useState<LeadFilters>({});
  const { data: leads, isLoading, isError } = useLeads(filters);
  const { data: names } = useProfileNames();

  const set = (patch: Partial<LeadFilters>) => setFilters((f) => ({ ...f, ...patch }));

  const hasFilters = Boolean(
    filters.qualificationStage || filters.referredBy || filters.from || filters.to,
  );

  return (
    <div className="max-w-6xl space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-brand-navy">Leads</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manually entered leads. Qualification and deal creation come next (B2.2).
          </p>
        </div>
        <Link
          to="/leads/new"
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-teal px-4 py-2 text-sm font-semibold text-white hover:bg-brand-teal/90"
        >
          <Plus className="h-4 w-4" /> Add lead
        </Link>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-white p-4 shadow-sm">
        <Filter label="Stage">
          <select
            className={inputCls}
            value={filters.qualificationStage ?? ""}
            onChange={(e) => set({ qualificationStage: e.target.value || undefined })}
          >
            <option value="">All stages</option>
            {LEAD_STAGE_FILTERS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </Filter>
        <Filter label="Referred by">
          <select
            className={inputCls}
            value={filters.referredBy ?? ""}
            onChange={(e) => set({ referredBy: e.target.value || undefined })}
          >
            <option value="">Any source</option>
            {REFERRED_BY.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </Filter>
        <Filter label="From">
          <input
            type="date"
            className={inputCls}
            value={filters.from ?? ""}
            onChange={(e) => set({ from: e.target.value || undefined })}
          />
        </Filter>
        <Filter label="To">
          <input
            type="date"
            className={inputCls}
            value={filters.to ?? ""}
            onChange={(e) => set({ to: e.target.value || undefined })}
          />
        </Filter>
        {(filters.qualificationStage || filters.referredBy || filters.from || filters.to) && (
          <button
            type="button"
            onClick={() => setFilters({})}
            className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-brand-navy hover:bg-slate-50"
          >
            Clear
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-white py-16 text-sm text-muted-foreground shadow-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading leads…
        </div>
      ) : isError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center text-sm text-red-700 shadow-sm">
          Couldn't load leads. Please retry.
        </div>
      ) : !leads?.length ? (
        hasFilters ? (
          <EmptyState
            icon={SearchX}
            title="No leads match these filters"
            description="Try widening the stage, source, or date range."
            action={
              <button
                type="button"
                onClick={() => setFilters({})}
                className="inline-flex items-center rounded-lg border border-border px-4 py-2 text-sm font-medium text-brand-navy hover:bg-slate-50"
              >
                Clear filters
              </button>
            }
          />
        ) : (
          <EmptyState
            icon={Users}
            title="No leads yet"
            description="Leads you enter here move through qualification and become deals."
            action={
              <Link
                to="/leads/new"
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand-teal px-4 py-2 text-sm font-semibold text-white hover:bg-brand-teal/90"
              >
                <Plus className="h-4 w-4" /> Add your first lead
              </Link>
            }
          />
        )
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-semibold">Business</th>
                <th className="px-4 py-3 font-semibold">Contact</th>
                <th className="px-4 py-3 font-semibold">Industry</th>
                <th className="px-4 py-3 font-semibold text-right">Funding</th>
                <th className="px-4 py-3 font-semibold">Timeline</th>
                <th className="px-4 py-3 font-semibold">Stage</th>
                <th className="px-4 py-3 font-semibold">Entered by</th>
                <th className="px-4 py-3 font-semibold">Created</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => (
                <tr key={l.id} className="border-b border-border last:border-0 hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium">
                    <Link to={`/leads/${l.id}`} className="text-brand-navy hover:text-brand-teal hover:underline">
                      {l.business_name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-brand-navy">{l.contact_name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{one(l.industry)?.name ?? "—"}</td>
                  <td className="px-4 py-3 text-right text-brand-navy">
                    {l.funding_amount != null ? formatZAR(l.funding_amount) : "—"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {labelFor(FUNDING_TIMELINES, l.funding_timeline)}
                  </td>
                  <td className="px-4 py-3">
                    <Badge className={QUALIFICATION_BADGE[l.qualification_stage] ?? ""}>
                      {labelFor(QUALIFICATION_STAGES, l.qualification_stage)}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {(l.entered_by && names?.[l.entered_by]) || "—"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(l.created_at).toLocaleDateString("en-ZA")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Filter({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}
