import type { ReactElement } from "react";
import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { toast } from "sonner";
import { QualifyingAndKpis } from "@/components/staff/QualifyingAndKpis";
import { card, errorText } from "@/components/staff/StaffShell";
import { useCompleteDocumentChaser, useCoordinatorLanding, useDocumentChasers, useStaffRole } from "@/hooks/useStaffDesk";

const STATUS_ORDER = [["new", "New"], ["documents_incomplete", "Documents incomplete"], ["complete", "Complete"], ["with_founder", "With Founder"], ["verified", "Verified"]] as const;
const DECISION_LABEL: Record<string, string> = {
  approve_to_submit: "Approved to submit", send_back_with_query: "Sent back with a question", decline: "Declined", call_me: "Founder wants a call",
};
const fmt = (iso: string) => new Date(iso).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg", dateStyle: "medium", timeStyle: "short" });

function Tile({ label, value, to, alert }: { label: string; value: number; to?: string; alert?: boolean }) {
  const body = (
    <div className={`${card} ${alert && value > 0 ? "border-amber-300 bg-amber-50" : ""}`}>
      <p className="text-3xl font-bold text-brand-navy">{value}</p>
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
  return to ? <Link to={to} className="block hover:opacity-90">{body}</Link> : body;
}

// Coordinator landing page: where files stand and what needs attention first.
export default function StaffHomePage() {
  const { data: role, isLoading } = useStaffRole();
  const allowed = role === "coordinator" || role === "owner";
  const landing = useCoordinatorLanding(allowed);
  const chasers = useDocumentChasers(allowed);
  const done = useCompleteDocumentChaser();
  const [note, setNote] = useState<Record<string, string>>({});
  if (isLoading) return null;
  if (role !== "coordinator" && role !== "owner") return <Navigate to="/staff" replace />;
  const d = landing.data;

  return (
    <>
      <div>
        <h1 className="text-2xl font-bold text-brand-navy">Home</h1>
        <p className="text-sm text-muted-foreground">Where the files stand and what needs you first.</p>
      </div>
      {landing.error ? <p role="alert" className="text-sm text-red-600">{errorText(landing.error)}</p> : null}
      {d ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tile label="Your overdue tasks" value={d.my_overdue_tasks} to="/staff/tasks" alert />
            <Tile label="Your open tasks" value={d.my_open_tasks} to="/staff/tasks" />
            <Tile label="With the Founder, waiting" value={d.founder_open} to="/staff/queue" />
            <Tile label="Questions overdue" value={d.answers_red} to="/staff/answers" alert />
            <Tile label="Questions running late (amber)" value={d.answers_amber} to="/staff/answers" alert />
            <Tile label="Time requests waiting" value={d.time_requests_pending} to="/staff/diary" />
          </div>
          <section className={card}>
            <h2 className="mb-2 text-base font-bold text-brand-navy">Document chasers due</h2>
            <ul className="divide-y divide-border text-sm">
              {(chasers.data ?? []).map((c) => (
                <li key={c.id} className="space-y-1 py-2">
                  <p className="font-semibold text-brand-navy">
                    {c.business_name}
                    <span className={`ml-2 rounded px-1.5 py-0.5 text-xs ${c.day_mark === 7 ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}`}>day {c.day_mark}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">{c.missing_documents.length ? `Still missing: ${c.missing_documents.join(", ").replaceAll("_", " ")}` : "No required document is missing."}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <input className="h-9 max-w-xs rounded-md border border-input px-3 text-sm" maxLength={300} placeholder="What you did (optional)" aria-label="Note" value={note[c.id] ?? ""} onChange={(e) => setNote({ ...note, [c.id]: e.target.value })} />
                    <button type="button" className="text-xs font-semibold text-green-700 underline" disabled={done.isPending}
                      onClick={() => done.mutate({ id: c.id, note: note[c.id] ?? "" }, { onSuccess: () => toast.success("Done"), onError: (e) => toast.error(errorText(e)) })}>I have chased this</button>
                  </div>
                </li>
              ))}
              {chasers.data && chasers.data.length === 0 ? <li className="py-2 text-muted-foreground">No chasers due.</li> : null}
            </ul>
          </section>
          <section className={card}>
            <h2 className="mb-3 text-base font-bold text-brand-navy">Files by status</h2>
            <ul className="flex flex-wrap gap-3 text-sm">
              {STATUS_ORDER.map(([k, l]) => (
                <li key={k} className="rounded-lg bg-slate-100 px-3 py-2"><span className="font-bold text-brand-navy">{d.status_counts[k] ?? 0}</span> {l}</li>
              ))}
            </ul>
          </section>
          <section className={card}>
            <h2 className="mb-2 text-base font-bold text-brand-navy">Longest-waiting files</h2>
            <ul className="divide-y divide-border text-sm">
              {d.oldest_open_files.map((f) => (
                <li key={f.lead_id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="font-semibold text-brand-navy">{f.business_name} <span className="font-normal text-muted-foreground">· {f.workflow_status.replace("_", " ")}</span></span>
                  <span className={f.waiting_days >= 5 ? "text-red-700" : "text-muted-foreground"}>
                    {f.waiting_days} day{f.waiting_days === 1 ? "" : "s"}{f.missing_count ? ` · ${f.missing_count} document${f.missing_count === 1 ? "" : "s"} missing` : ""}
                  </span>
                </li>
              ))}
              {d.oldest_open_files.length === 0 ? <li className="py-2 text-muted-foreground">Nothing is waiting.</li> : null}
            </ul>
          </section>
          <section className={card}>
            <h2 className="mb-2 text-base font-bold text-brand-navy">Founder's latest answers</h2>
            <ul className="divide-y divide-border text-sm">
              {d.founder_recent.map((r) => (
                <li key={`${r.lead_id}${r.decided_at}`} className="py-2">
                  <span className="font-semibold text-brand-navy">{r.business_name}</span> · {DECISION_LABEL[r.decision] ?? r.decision}
                  {r.decline_category ? ` (${r.decline_category.replace("_", " ")})` : ""}{r.note ? ` — ${r.note}` : ""}
                  <span className="block text-xs text-muted-foreground">{fmt(r.decided_at)}</span>
                </li>
              ))}
              {d.founder_recent.length === 0 ? <li className="py-2 text-muted-foreground">No answers yet.</li> : null}
            </ul>
          </section>
        </>
      ) : null}
      <QualifyingAndKpis enabled={allowed} />
    </>
  );
}

// /staff opens on the landing page for the Coordinator and on the call log for everyone else.
export function StaffIndex({ callLog }: { callLog: ReactElement }) {
  const { data: role, isLoading } = useStaffRole();
  if (isLoading) return null;
  return role === "coordinator" ? <Navigate to="/staff/home" replace /> : callLog;
}
