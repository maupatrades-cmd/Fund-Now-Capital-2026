import { Link } from "react-router-dom";
import { Briefcase, PlusCircle } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { DEAL_STATUS_BADGE, dealStatus, usePortalDeals, type PortalDealStatus } from "@/hooks/usePortalDeals";
import { formatRelative } from "@/lib/format";
import type { PortalKind } from "@/components/portal/PortalShell";

const COLUMNS: PortalDealStatus[] = ["New","Qualified","Submitted","Approved","Funded","Declined"];
export default function PortalDealPipeline({portal,title}:{portal:PortalKind;title:string}){
  const query=usePortalDeals(portal);
  if(query.isLoading)return <p className="text-sm text-muted-foreground">Loading pipeline...</p>;
  if(query.isError)return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">Could not load your pipeline. <button onClick={()=>void query.refetch()} className="font-semibold underline">Retry</button></div>;
  if((query.data?.length??0)===0)return <EmptyState icon={Briefcase} title="No deals in your pipeline" description="Qualified leads will appear here as deals." action={<Link to={`/${portal}/submit-lead`} className="inline-flex items-center gap-2 rounded-lg bg-brand-teal px-4 py-2 text-sm font-semibold text-white"><PlusCircle className="h-4 w-4"/>Submit a lead</Link>}/>;
  return <div className="space-y-5"><div><h1 className="text-2xl font-bold text-brand-navy">{title}</h1><p className="mt-1 text-sm text-muted-foreground">A read-only view of every deal you introduced and its current progress.</p></div><div className="grid gap-4 overflow-x-auto pb-3 lg:grid-cols-3 xl:grid-cols-6">{COLUMNS.map(status=>{const rows=(query.data??[]).filter(row=>dealStatus(row.current_stage)===status);return <section key={status} className="min-w-[230px] rounded-xl bg-slate-100 p-3"><div className="mb-3 flex items-center justify-between"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${DEAL_STATUS_BADGE[status]}`}>{status}</span><span className="text-xs font-bold text-muted-foreground">{rows.length}</span></div><div className="space-y-2">{rows.map(row=><article key={row.deal_id} className="rounded-lg border border-border bg-white p-3 shadow-sm"><h2 className="text-sm font-semibold text-brand-navy">{row.client_business_name}</h2><p className="mt-1 text-xs text-muted-foreground">{row.deal_reference??"Deal"}</p><p className="mt-3 text-xs text-muted-foreground">Funder: {row.anonymized_funder_name??"Pending"}</p><p className="mt-1 text-[11px] text-muted-foreground">Submitted {formatRelative(row.submitted_at)}</p></article>)}{rows.length===0&&<p className="py-5 text-center text-xs text-muted-foreground">No deals</p>}</div></section>})}</div></div>;
}
