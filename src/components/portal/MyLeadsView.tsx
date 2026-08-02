import { Link } from "react-router-dom";
import { ListChecks, PlusCircle } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { formatZAR } from "@/lib/format";
import {
  usePortalLeads,
  leadStatus,
  STATUS_BADGE,
} from "@/hooks/usePortalLeads";
import type { PortalKind } from "@/components/portal/PortalShell";

/*
 * The submitter's own leads (partner or contractor). List-only for now — no
 * detail page yet (a later PR) — with a simple 4-state status column derived
 * from the owner's qualification stage. RLS guarantees a submitter sees only
 * their own rows; a partner never sees a contractor's leads, and vice-versa.
 */
export default function MyLeadsView({ portal }: { portal: PortalKind }) {
  const { data, isLoading, isError, error, refetch } = usePortalLeads(portal);

  const submitCta = (
    <Link
      to={`/${portal}/submit-lead`}
      className="inline-flex items-center gap-2 rounded-lg bg-brand-teal px-4 py-2 text-sm font-semibold text-white hover:bg-brand-teal/90"
    >
      <PlusCircle className="h-4 w-4" />
      Submit a new lead
    </Link>
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-brand-navy">My leads</h1>
          <p className="text-sm text-muted-foreground">Leads you've submitted and where they stand.</p>
        </div>
        <div className="hidden sm:block">{submitCta}</div>
      </div>

      {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}

      {isError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Couldn't load your leads: {(error as Error)?.message ?? "unknown error"}.{" "}
          <button type="button" onClick={() => void refetch()} className="font-medium underline">
            Retry
          </button>
        </div>
      )}

      {!isLoading && !isError && (data?.length ?? 0) === 0 && (
        <EmptyState
          icon={ListChecks}
          title="You haven't submitted any leads yet"
          description="When you submit a business that needs funding, it'll show up here with its status."
          action={submitCta}
        />
      )}

      {!isLoading && !isError && (data?.length ?? 0) > 0 && (
        <div className="overflow-x-auto rounded-xl border border-border bg-white shadow-sm">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-medium">Business</th>
                <th className="px-4 py-3 font-medium">Contact</th>
                <th className="px-4 py-3 font-medium">Amount</th>
                <th className="px-4 py-3 font-medium">Submitted</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((row) => {
                const status = leadStatus(row.qualification_stage);
                return (
                  <tr key={row.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 font-medium text-brand-navy">{row.business_name}</td>
                    <td className="px-4 py-3 text-muted-foreground">{row.contact_name}</td>
                    <td className="px-4 py-3 text-brand-navy">
                      {row.funding_amount ? formatZAR(row.funding_amount) : "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {new Date(row.created_at).toLocaleDateString("en-ZA", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_BADGE[status]}`}
                      >
                        {status}
                      </span>
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
