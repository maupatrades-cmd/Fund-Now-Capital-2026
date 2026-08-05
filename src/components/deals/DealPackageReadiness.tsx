import { CheckCircle2, Circle, PackageCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { useClientDocuments } from "@/hooks/useClientDocuments";
import { docTypeLabel, type DocumentType } from "@/lib/documents";

const STANDARD: DocumentType[] = ["cipc_cert", "bank_statement", "id_copy", "credit_consent", "application_form"];

export function DealPackageReadiness({ clientId, isPurchaseOrder, amountRequested }: { clientId: string | null; isPurchaseOrder: boolean; amountRequested: string | null }) {
  const query = useClientDocuments(clientId ?? undefined);
  const required = isPurchaseOrder ? [...STANDARD, "purchase_order" as const, "quotation" as const] : STANDARD;
  const accepted = new Set((query.data ?? []).filter((d) => d.is_current_version && d.status === "active" && d.verification_status === "accepted").map((d) => d.document_type));
  const checks = required.map((type) => ({ label: docTypeLabel(type), ready: accepted.has(type) }));
  checks.unshift({ label: "Funding amount captured", ready: amountRequested != null && Number(amountRequested) > 0 });
  const complete = checks.filter((item) => item.ready).length;
  const percentage = Math.round((complete / checks.length) * 100);

  return <section className="rounded-xl border border-border bg-white p-5 shadow-sm">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><PackageCheck className="h-5 w-5 text-brand-teal" /><h2 className="font-semibold text-brand-navy">Deal package readiness</h2></div><p className="mt-1 text-xs text-muted-foreground">Baseline checks before sending a funding pack. Individual funders may require more.</p></div><span className={`rounded-full px-3 py-1 text-sm font-bold ${query.isError?"bg-red-100 text-red-700":percentage===100?"bg-green-100 text-green-700":"bg-amber-100 text-amber-800"}`}>{query.isError?"Unavailable":`${percentage}% ready`}</span></div>
    {!query.isError && <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-brand-teal" style={{ width: `${percentage}%` }} /></div>}
    {query.isLoading ? <p className="mt-4 text-sm text-muted-foreground">Checking documents...</p> : query.isError ? <div className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">Unable to check documents. <button type="button" onClick={() => void query.refetch()} className="font-semibold underline">Retry</button></div> : <div className="mt-4 grid gap-2 sm:grid-cols-2">{checks.map((item) => <div key={item.label} className="flex items-center gap-2 text-sm">{item.ready?<CheckCircle2 className="h-4 w-4 text-green-600"/>:<Circle className="h-4 w-4 text-amber-500"/>}<span className={item.ready?"text-brand-navy":"text-muted-foreground"}>{item.label}</span></div>)}</div>}
    {clientId && !query.isError && percentage < 100 && <Link to={`/clients/${clientId}`} className="mt-4 inline-block text-sm font-semibold text-brand-teal hover:underline">Complete missing client documents →</Link>}
  </section>;
}
