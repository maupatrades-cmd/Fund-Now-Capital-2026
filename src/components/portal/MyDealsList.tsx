import { Link } from "react-router-dom";
import { Briefcase, PlusCircle } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { formatRelative } from "@/lib/format";
import {
  usePortalDeals,
  dealStatus,
  DEAL_STATUS_BADGE,
} from "@/hooks/usePortalDeals";
import type { PortalKind } from "@/components/portal/PortalShell";

/*
 * The submitter's own deals (partner or contractor). List-only for now — no
 * deal-detail page yet (a later PR) and no earnings figures (follow-up PR after
 * the commission backend merges). RLS + the SECURITY DEFINER RPC guarantee a
 * submitter sees only their own rows; a partner never sees a contractor's
 * deals, and vice-versa. The funder column shows the anonymised (fictional)
 * name only — the real funder identity never reaches this surface.
 */
export default function MyDealsList({ portal }: { portal: PortalKind }) {
  const { data, isLoading, isError, error, refetch } = usePortalDeals(portal);

  const submitCta = (
    <Link
      to={`/${portal}/submit-lead`}
      className="inline-flex items-center gap-2 rounded-lg bg-brand-teal px-4 py-2 text-sm font-semibold text-white hover:bg-brand-teal/90"
    >
      <PlusCircle className="h-4 w-4" />
      Submit your first lead
    </Link>
  );

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold text-brand-navy">My deals</h1>
        <p className="text-sm text-muted-foreground">
          Deals that grew out of the leads you referred, and where they stand.
        </p>
      </div>

      {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}

      {isError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Couldn't load your deals: {(error as Error)?.message ?? "unknown error"}.{" "}
          <button type="button" onClick={() => void refetch()} className="font-medium underline">
            Retry
          </button>
        </div>
      )}

      {!isLoading && !isError && (data?.length ?? 0) === 0 && (
        <EmptyState
          icon={Briefcase}
          title="No referred deals yet"
          description="Submit your first lead to get started. Once a lead you refer becomes a deal, it'll show up here with its status."
          action={submitCta}
        />
      )}

      {!isLoading && !isError && (data?.length ?? 0) > 0 && (
        <div className="overflow-x-auto rounded-xl border border-border bg-white shadow-sm">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-medium">Business</th>
                <th className="px-4 py-3 font-medium">Funder</th>
                <th className="px-4 py-3 font-medium">Stage</th>
                <th className="px-4 py-3 font-medium">Submitted</th>
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((row) => {
                const status = dealStatus(row.current_stage);
                return (
                  <tr key={row.deal_id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 font-medium text-brand-navy">
                      {row.client_business_name}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {row.anonymized_funder_name ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${DEAL_STATUS_BADGE[status]}`}
                      >
                        {status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {formatRelative(row.submitted_at)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
