import { Link } from "react-router-dom";
import { ArchiveRestore, ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { clientName, useArchivedDeals } from "@/hooks/useDeals";
import { useSetDealArchived } from "@/hooks/useDealDetail";
import { stageLabel } from "@/lib/dealStages";

export default function ArchivedDealsPage() {
  const query = useArchivedDeals();
  const restore = useSetDealArchived();
  const restoreDeal = async (id: string) => {
    try {
      await restore.mutateAsync({ id, archived: false });
      toast.success("Deal restored to the pipeline");
    } catch (error) {
      toast.error((error as Error).message || "Could not restore the deal");
    }
  };

  return <div className="max-w-5xl space-y-5">
    <div><Link to="/pipeline" className="inline-flex items-center gap-1 text-sm text-brand-teal hover:underline"><ArrowLeft className="h-4 w-4" /> Back to pipeline</Link><h1 className="mt-3 text-2xl font-bold text-brand-navy">Archived deals</h1><p className="mt-1 text-sm text-muted-foreground">Hidden from operational dashboards and portals. Financial and audit records remain intact.</p></div>
    {query.isLoading && <p className="text-sm text-muted-foreground">Loading archived deals…</p>}
    {query.isError && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">Could not load archived deals. <button className="font-semibold underline" onClick={() => void query.refetch()}>Retry</button></div>}
    {!query.isLoading && !query.isError && (query.data?.length ?? 0) === 0 && <div className="rounded-xl border border-border bg-white p-8 text-center text-sm text-muted-foreground">No archived deals.</div>}
    <div className="space-y-3">{(query.data ?? []).map((deal) => <div key={deal.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-white p-4 shadow-sm"><div><Link to={`/deals/${deal.id}`} className="font-semibold text-brand-navy hover:text-brand-teal">{deal.reference ?? "Deal"} · {clientName(deal)}</Link><p className="mt-1 text-xs text-muted-foreground">{stageLabel(deal.stage)} · {deal.archive_reason ?? "No reason recorded"}</p></div><button disabled={restore.isPending} onClick={() => void restoreDeal(deal.id)} className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-brand-navy hover:bg-slate-50 disabled:opacity-60">{restore.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArchiveRestore className="h-4 w-4" />} Restore</button></div>)}</div>
  </div>;
}
