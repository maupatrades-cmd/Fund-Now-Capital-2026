import { useState } from "react";
import { Navigate } from "react-router-dom";
import { card, errorText, selectClass } from "@/components/staff/StaffShell";
import { useIntakeQueue, useStaffRole } from "@/hooks/useStaffDesk";

const STATUSES = ["new", "documents_incomplete", "complete", "with_founder", "verified"] as const;

// Coordinator / Owner queue of submissions. Read-only in this batch: status
// changes, archive and assignment screens come next; the RPCs already exist.
export default function StaffQueuePage() {
  const { data: role } = useStaffRole();
  const [status, setStatus] = useState<string>("");
  const [archived, setArchived] = useState(false);
  const queue = useIntakeQueue(status || null, archived);
  if (role === "switchboard") return <Navigate to="/staff" replace />;

  return (
    <>
      <div>
        <h1 className="text-2xl font-bold text-brand-navy">Submission queue</h1>
        <p className="text-sm text-muted-foreground">Every registered submission and what it still needs.</p>
      </div>
      <div className={`${card} flex flex-wrap items-center gap-4`}>
        <select className={`${selectClass} max-w-xs`} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
          <option value="">All active</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Include archived</label>
      </div>
      {queue.error ? <p role="alert" className="text-sm text-red-600">{errorText(queue.error)}</p> : null}
      <section className={card}>
        <ul className="divide-y divide-border">
          {(queue.data ?? []).map((r) => (
            <li key={r.lead_id} className="space-y-1 py-3 text-sm">
              <p className="font-semibold text-brand-navy">
                {r.business_name} <span className="font-normal text-muted-foreground">· {r.funding_type_label}</span>
                <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs">{r.workflow_status.replace("_", " ")}</span>
                {r.has_review_flag ? <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">Owner review</span> : null}
                {r.archived_at ? <span className="ml-2 rounded bg-slate-200 px-1.5 py-0.5 text-xs">archived</span> : null}
              </p>
              <p className="text-xs text-muted-foreground">
                {r.contact_name} · {r.channel.replace("_", " ")}{r.team_name ? ` · ${r.team_name}` : ""}{r.organisation_name ? ` · ${r.organisation_name}` : ""}{r.agent_name ? ` · ${r.agent_name}` : ""}
              </p>
              {r.missing_documents.length ? <p className="text-xs text-amber-800">Missing: {r.missing_documents.join(", ").replaceAll("_", " ")}</p> : null}
            </li>
          ))}
          {queue.data && queue.data.length === 0 ? <li className="py-3 text-muted-foreground">No submissions match.</li> : null}
        </ul>
      </section>
    </>
  );
}
