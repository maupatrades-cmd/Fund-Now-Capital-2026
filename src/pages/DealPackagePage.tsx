import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Printer } from "lucide-react";
import { useDeal } from "@/hooks/useDealDetail";
import { one, useClient } from "@/hooks/useClients";
import { useClientDocuments } from "@/hooks/useClientDocuments";
import { docTypeLabel } from "@/lib/documents";
import { formatZAR } from "@/lib/format";
import { stageLabel } from "@/lib/dealStages";

export default function DealPackagePage() {
  const { id } = useParams();
  const dealQuery = useDeal(id);
  const clientQuery = useClient(dealQuery.data?.client_id);
  const docsQuery = useClientDocuments(dealQuery.data?.client_id);
  if (dealQuery.isLoading || clientQuery.isLoading || docsQuery.isLoading) return <p className="text-sm text-muted-foreground">Preparing package...</p>;
  if (dealQuery.isError || clientQuery.isError || docsQuery.isError) return <div className="space-y-3"><Link to={id ? `/deals/${id}` : "/pipeline"} className="inline-flex items-center gap-1 text-sm text-brand-teal"><ArrowLeft className="h-4 w-4"/>Back to deal</Link><div className="rounded-lg bg-red-50 p-4 text-sm text-red-700">Could not retrieve all package information. Nothing has been prepared or printed. <button type="button" onClick={() => { if (dealQuery.isError) void dealQuery.refetch(); if (clientQuery.isError) void clientQuery.refetch(); if (docsQuery.isError) void docsQuery.refetch(); }} className="font-semibold underline">Retry</button></div></div>;
  const deal = dealQuery.data; const client = clientQuery.data;
  if (!deal || !client) return <p className="rounded-lg bg-red-50 p-4 text-sm text-red-700">Could not prepare this deal package.</p>;
  const today = new Date().toISOString().slice(0, 10);
  const documents = (docsQuery.data ?? []).filter((doc) => doc.is_current_version && doc.status === "active" && doc.verification_status === "accepted" && (!doc.expiry_date || doc.expiry_date >= today));
  return <div className="mx-auto max-w-4xl space-y-6 bg-white p-6 print:max-w-none print:p-0">
    <div className="flex items-center justify-between gap-3 print:hidden"><Link to={`/deals/${deal.id}`} className="inline-flex items-center gap-1 text-sm text-brand-teal"><ArrowLeft className="h-4 w-4"/>Back to deal</Link><button onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-lg bg-brand-navy px-4 py-2 text-sm font-semibold text-white"><Printer className="h-4 w-4"/>Print / Save PDF</button></div>
    <header className="border-b-4 border-brand-teal pb-5"><p className="text-sm font-semibold uppercase tracking-widest text-brand-teal">Fund Now Capital</p><h1 className="mt-2 text-3xl font-bold text-brand-navy">Funding submission cover</h1><p className="mt-1 text-sm text-muted-foreground">Generated {new Date().toLocaleString("en-ZA")}</p></header>
    <section className="grid gap-4 rounded-xl border border-border p-5 sm:grid-cols-2"><Info label="Deal reference" value={deal.reference??"Not assigned"}/><Info label="Client" value={client.business_name}/><Info label="CIPC number" value={client.cipc_number??"Not captured"}/><Info label="Industry" value={one(client.industry)?.name??client.sector??"Not captured"}/><Info label="Amount requested" value={deal.amount_requested?formatZAR(deal.amount_requested):"Not captured"}/><Info label="Deal type" value={deal.is_purchase_order?"Purchase order funding":"Standard funding"}/><Info label="Current stage" value={stageLabel(deal.stage)}/><Info label="Monthly turnover" value={client.monthly_turnover?formatZAR(client.monthly_turnover):"Not captured"}/></section>
    <section><h2 className="text-lg font-semibold text-brand-navy">Included document register</h2><p className="mt-1 text-sm text-muted-foreground">Only current, accepted, non-expired files are listed. The files remain in the secure document vault.</p><table className="mt-4 w-full text-left text-sm"><thead><tr className="border-b"><th className="py-2">Document</th><th>File</th><th>Verification</th><th>Version</th></tr></thead><tbody>{documents.map((doc)=><tr key={doc.id} className="border-b"><td className="py-3">{docTypeLabel(doc.document_type)}</td><td>{doc.filename}</td><td className="capitalize">{doc.verification_status}</td><td>v{doc.version_number}</td></tr>)}</tbody></table>{documents.length===0&&<p className="mt-4 rounded-lg bg-amber-50 p-4 text-sm text-amber-800">No submission-ready documents are available. Check verification and expiry status before preparing the package.</p>}</section>
    {deal.notes&&<section><h2 className="text-lg font-semibold text-brand-navy">Deal notes</h2><p className="mt-2 whitespace-pre-wrap text-sm">{deal.notes}</p></section>}
    <footer className="border-t pt-4 text-xs text-muted-foreground">Confidential funding application information. Share only with an authorised recipient.</footer>
  </div>;
}
function Info({label,value}:{label:string;value:string}){return <div><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-semibold text-brand-navy">{value}</p></div>}
