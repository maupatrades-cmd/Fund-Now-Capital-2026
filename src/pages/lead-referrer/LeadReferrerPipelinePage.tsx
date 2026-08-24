import { Briefcase } from "lucide-react";
import { LeadReferrerShell } from "@/components/lead-referrer/LeadReferrerShell";
import { EmptyState } from "@/components/ui/empty-state";
import { DEAL_STATUS_BADGE, dealStatus, type PortalDealStatus } from "@/hooks/usePortalDeals";
import { useLeadReferrerDeals } from "@/hooks/useLeadReferrerOperations";
import { formatRelative } from "@/lib/format";

const stages: PortalDealStatus[] = ["New", "Qualified", "Submitted", "Approved", "Funded", "Declined"];

export default function LeadReferrerPipelinePage() {
  const query = useLeadReferrerDeals();
  return (
    <LeadReferrerShell>
      <div><h1 className="text-2xl font-bold text-brand-navy">My referral pipeline</h1><p className="mt-1 text-sm text-muted-foreground">Read-only progress for deals created from your referrals. Funder identities and internal notes remain private.</p></div>
      {query.isLoading ? <p className="text-sm text-muted-foreground">Loading your pipeline…</p> : null}
      {query.isError ? <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">Could not load your pipeline. <button type="button" onClick={() => void query.refetch()} className="font-semibold underline">Retry</button></div> : null}
      {!query.isLoading && !query.isError && (query.data?.length ?? 0) === 0 ? <EmptyState icon={Briefcase} title="No deals in your pipeline" description="When FNC qualifies one of your leads into a deal, it will appear here." /> : null}
      {!query.isLoading && !query.isError && (query.data?.length ?? 0) > 0 ? (
        <div className="grid gap-4 overflow-x-auto pb-3 lg:grid-cols-3 xl:grid-cols-6">
          {stages.map((stage) => { const rows = (query.data ?? []).filter((deal) => dealStatus(deal.current_stage) === stage); return (
            <section key={stage} className="min-w-[230px] rounded-xl bg-slate-100 p-3">
              <div className="mb-3 flex items-center justify-between"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${DEAL_STATUS_BADGE[stage]}`}>{stage}</span><span className="text-xs font-bold text-muted-foreground">{rows.length}</span></div>
              <div className="space-y-2">{rows.map((deal) => <article key={deal.deal_id} className="rounded-lg border border-border bg-white p-3 shadow-sm"><h2 className="text-sm font-semibold text-brand-navy">{deal.client_business_name}</h2><p className="mt-1 text-xs text-muted-foreground">{deal.deal_reference ?? "Deal"}</p><p className="mt-3 text-xs text-muted-foreground">{deal.anonymized_funder_name ?? "Funder pending"}</p><p className="mt-1 text-[11px] text-muted-foreground">Started {formatRelative(deal.submitted_at)}</p></article>)}</div>
            </section>
          ); })}
        </div>
      ) : null}
    </LeadReferrerShell>
  );
}
