import { useState } from "react";
import { Link } from "react-router-dom";
import { FileUp, ListChecks, PlusCircle } from "lucide-react";
import { LeadReferrerShell } from "@/components/lead-referrer/LeadReferrerShell";
import { EmptyState } from "@/components/ui/empty-state";
import { AttachLeadDocumentsModal } from "@/components/portal/MyLeadsView";
import { useLeadReferrerLeads } from "@/hooks/useLeadReferrerOperations";
import { leadStatus, STATUS_BADGE } from "@/hooks/usePortalLeads";
import { formatZAR } from "@/lib/format";

export default function LeadReferrerLeadsPage() {
  const query = useLeadReferrerLeads();
  // The lead whose documents are being attached (shared portal dialog; RLS limits it to the sub-agent's own leads).
  const [attachLeadId, setAttachLeadId] = useState<string | null>(null);
  const submitAction = (
    <Link to="/lead-referrer/submit-lead" className="inline-flex items-center gap-2 rounded-lg bg-brand-teal px-4 py-2 text-sm font-semibold text-white hover:bg-brand-teal/90">
      <PlusCircle className="h-4 w-4" aria-hidden="true" /> Submit a lead
    </Link>
  );

  return (
    <LeadReferrerShell>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-brand-navy">My leads</h1>
          <p className="mt-1 text-sm text-muted-foreground">Only businesses attributed to your own referral account appear here.</p>
        </div>
        {submitAction}
      </div>

      {query.isLoading ? <p className="text-sm text-muted-foreground">Loading your leads…</p> : null}
      {query.isError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Could not load your leads. <button type="button" onClick={() => void query.refetch()} className="font-semibold underline">Retry</button>
        </div>
      ) : null}
      {!query.isLoading && !query.isError && (query.data?.length ?? 0) === 0 ? (
        <EmptyState icon={ListChecks} title="No leads submitted yet" description="Submit a funding opportunity and its owner-reviewed status will appear here." action={submitAction} />
      ) : null}
      {!query.isLoading && !query.isError && (query.data?.length ?? 0) > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-border bg-white shadow-sm">
          <table className="w-full min-w-[680px] text-sm">
            <thead><tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground"><th className="px-4 py-3">Business</th><th className="px-4 py-3">Contact</th><th className="px-4 py-3">Amount</th><th className="px-4 py-3">Submitted</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Documents</th></tr></thead>
            <tbody>{(query.data ?? []).map((lead) => { const status = leadStatus(lead.qualification_stage); return (
              <tr key={lead.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3 font-semibold text-brand-navy">{lead.business_name}</td>
                <td className="px-4 py-3 text-muted-foreground">{lead.contact_name}</td>
                <td className="px-4 py-3">{lead.funding_amount ? formatZAR(lead.funding_amount) : "—"}</td>
                <td className="px-4 py-3 text-muted-foreground">{new Date(lead.created_at).toLocaleDateString("en-ZA")}</td>
                <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${STATUS_BADGE[status]}`}>{status}</span></td>
                <td className="px-4 py-3">
                  <button type="button" onClick={() => setAttachLeadId(lead.id)} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-brand-navy hover:bg-slate-50">
                    <FileUp className="h-3.5 w-3.5" aria-hidden="true" /> Attach
                  </button>
                </td>
              </tr>
            ); })}</tbody>
          </table>
        </div>
      ) : null}
      {attachLeadId ? (
        <AttachLeadDocumentsModal key={attachLeadId} leadId={attachLeadId} submitter="lead-referrer" onClose={() => setAttachLeadId(null)} />
      ) : null}
    </LeadReferrerShell>
  );
}
