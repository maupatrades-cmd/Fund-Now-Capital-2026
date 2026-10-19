import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { card, errorText, primaryButton } from "@/components/staff/StaffShell";
import { canDecideTimeRequests, useStaffRole } from "@/hooks/useStaffDesk";
import {
  useDirectorBriefing, useEndOfDayReport, useEscalationBoard, useFilesProgressReport, useResolveEscalation, type Escalation,
} from "@/hooks/useStaffReports";

// Reports (owner spec §11, §17), for the Founder and the Administrator: the Director's daily briefing, the
// end-of-day report, the Friday report on progress toward 60 files a month, and escalations to the Director.
// Counts only: no success-fee amounts, no money, no funders.
const fmt = (iso: string) => new Date(iso).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg", dateStyle: "medium", timeStyle: "short" });
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-ZA", { timeZone: "Africa/Johannesburg", hour: "2-digit", minute: "2-digit" });
const words = (s: string) => s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
type Tab = "briefing" | "eod" | "files" | "escalations";
const TABS: [Tab, string][] = [["briefing", "Daily briefing"], ["eod", "End of day"], ["files", "Friday: 60 files"], ["escalations", "Escalations"]];

function Stat({ label, value, warn }: { label: string; value: ReactNode; warn?: boolean }) {
  return (
    <div className={`rounded-xl border p-3 ${warn ? "border-amber-300 bg-amber-50" : "border-border"}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-bold text-brand-navy">{value}</p>
    </div>
  );
}
const grid = "grid grid-cols-2 gap-3 sm:grid-cols-4";
const h2 = "text-base font-bold text-brand-navy";
const Empty = ({ children }: { children: ReactNode }) => <p className="text-sm text-muted-foreground">{children}</p>;
const Status = ({ q }: { q: { error: unknown; data: unknown } }) =>
  q.error ? <p role="alert" className="text-sm text-red-600">{errorText(q.error)}</p> : !q.data ? <Empty>Loading…</Empty> : null;

function BriefingView({ day }: { day: string | null }) {
  const q = useDirectorBriefing(day, true);
  const b = q.data;
  if (!b) return <Status q={q} />;
  return (
    <div className="space-y-5">
      <div className={grid}>
        <Stat label="Open escalations" value={b.urgent.escalations_open} warn={b.urgent.escalations_open > 0} />
        <Stat label="Complaints not acknowledged" value={b.urgent.complaints_unacknowledged} warn={b.urgent.complaints_unacknowledged > 0} />
        <Stat label="Overdue tasks" value={b.tasks.overdue} warn={b.tasks.overdue > 0} />
        <Stat label="Files with the Director" value={b.urgent.files_with_founder} />
        <Stat label="Open tasks" value={b.tasks.open} />
        <Stat label="Waiting to be accepted" value={b.tasks.awaiting_acceptance} />
        <Stat label="Diary requests to decide" value={b.time_requests_pending} />
        <Stat label="Callbacks due today" value={b.urgent.callbacks_due_today} />
      </div>
      <section className="space-y-2">
        <h2 className={h2}>Today's bookings</h2>
        {b.bookings.length === 0 ? <Empty>Nothing booked.</Empty> : (
          <ul className="divide-y divide-border text-sm">
            {b.bookings.map((e, i) => (
              <li key={i} className="py-2"><span className="font-semibold">{time(e.starts_at)}–{time(e.ends_at)}</span> · {e.title}
                <span className="text-muted-foreground"> · {words(e.category)}{e.business_name ? ` · ${e.business_name}` : ""}</span></li>
            ))}
          </ul>
        )}
      </section>
      <section className="space-y-2">
        <h2 className={h2}>Urgent</h2>
        {b.urgent.escalations.length === 0 && b.tasks.urgent.length === 0 ? <Empty>Nothing urgent.</Empty> : (
          <ul className="divide-y divide-border text-sm">
            {b.urgent.escalations.map((e, i) => (
              <li key={`e${i}`} className="py-2"><span className="rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-800">Escalated</span> {e.title}
                <span className="block text-xs text-muted-foreground">{e.note} · {fmt(e.created_at)}</span></li>
            ))}
            {b.tasks.urgent.map((t, i) => (
              <li key={`t${i}`} className="py-2">{t.priority === "high" ? <span className="rounded bg-amber-200 px-1.5 py-0.5 text-xs text-amber-900">High</span> : null} {t.title}
                <span className="block text-xs text-muted-foreground">
                  {t.assignee ?? words(t.route_to)}{t.business_name ? ` · ${t.business_name}` : ""}{t.due_at ? ` · due ${fmt(t.due_at)}` : ""}
                </span></li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function EndOfDayView({ day }: { day: string | null }) {
  const q = useEndOfDayReport(day, true);
  const r = q.data;
  if (!r) return <Status q={q} />;
  return (
    <div className="space-y-5">
      <div className={grid}>
        <Stat label="Files opened" value={r.files_opened.length} />
        <Stat label="Documents received" value={r.documents_received.count} />
        <Stat label="Leads assigned" value={r.leads_assigned.length + r.outbound_assigned} />
        <Stat label="Tasks outstanding" value={r.tasks.outstanding} warn={r.tasks.overdue > 0} />
        <Stat label="Files Complete today" value={r.files_completed} />
        <Stat label="Tasks done today" value={r.tasks.completed} />
        <Stat label="Complaints logged" value={r.complaints_logged} warn={r.complaints_logged > 0} />
        <Stat label="Escalations raised" value={r.escalations_raised} />
      </div>
      <section className="space-y-2">
        <h2 className={h2}>Files opened</h2>
        {r.files_opened.length === 0 ? <Empty>None.</Empty> : (
          <ul className="divide-y divide-border text-sm">
            {r.files_opened.map((f, i) => <li key={i} className="py-2">{f.business_name}<span className="text-muted-foreground"> · {words(f.channel)} · {f.handler ?? "not assigned"} · {time(f.opened_at)}</span></li>)}
          </ul>
        )}
      </section>
      <section className="space-y-2">
        <h2 className={h2}>Documents received, by file</h2>
        {r.documents_received.by_file.length === 0 ? <Empty>None.</Empty> : (
          <ul className="divide-y divide-border text-sm">
            {r.documents_received.by_file.map((f, i) => <li key={i} className="py-2">{f.business_name}<span className="text-muted-foreground"> · {f.received}</span></li>)}
          </ul>
        )}
      </section>
      <section className="space-y-2">
        <h2 className={h2}>Leads assigned</h2>
        {r.leads_assigned.length === 0 ? <Empty>No files assigned today.</Empty> : (
          <ul className="divide-y divide-border text-sm">
            {r.leads_assigned.map((a, i) => <li key={i} className="py-2">{a.business_name} → {a.assigned_to ?? "?"}<span className="text-muted-foreground"> · {time(a.at)}</span></li>)}
          </ul>
        )}
        {r.outbound_assigned > 0 ? <p className="text-sm">Outbound leads given to a team member: {r.outbound_assigned}</p> : null}
      </section>
      <section className="space-y-2">
        <h2 className={h2}>Tasks outstanding, by person</h2>
        {r.tasks.outstanding_by_person.length === 0 ? <Empty>No open tasks.</Empty> : (
          <ul className="divide-y divide-border text-sm">
            {r.tasks.outstanding_by_person.map((p, i) => <li key={i} className="py-2">{p.person}<span className="text-muted-foreground"> · {p.open} open{p.overdue ? `, ${p.overdue} overdue` : ""}</span></li>)}
          </ul>
        )}
      </section>
    </div>
  );
}

function FilesView({ day }: { day: string | null }) {
  const q = useFilesProgressReport(day, true);
  const r = q.data;
  if (!r) return <Status q={q} />;
  const pct = Math.min(100, Math.round((100 * r.files_opened_month) / r.target));
  const month = new Date(`${r.month}T12:00:00`).toLocaleDateString("en-ZA", { month: "long", year: "numeric" });
  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <h2 className={h2}>{month}: {r.files_opened_month} of {r.target} files opened</h2>
        <div className="h-3 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={r.files_opened_month} aria-valuemin={0} aria-valuemax={r.target} aria-label="Files opened this month">
          <div className="h-full bg-brand-teal" style={{ width: `${pct}%` }} />
        </div>
        <p className="text-sm text-muted-foreground">
          {r.files_opened_month >= r.target ? "Target reached." : r.files_needed_per_day === null ? "No working days left this month."
            : `${r.working_days_left} working days left: about ${r.files_needed_per_day} files a day to reach ${r.target}.`}
        </p>
      </section>
      <div className={grid}>
        <Stat label="Files opened this week" value={r.files_opened_week} />
        <Stat label="Documents complete this month" value={r.documents_complete_month} />
        <Stat label="Documents complete this week" value={r.documents_complete_week} />
        <Stat label="Admin fees paid" value={r.admin_fees_paid.not_tracked ? "Not tracked yet" : "—"} />
      </div>
      {r.admin_fees_paid.not_tracked ? <p className="text-xs text-muted-foreground">{r.admin_fees_paid.note}</p> : null}
      <div className="grid gap-5 sm:grid-cols-2">
        <section className="space-y-2">
          <h2 className={h2}>Files in progress</h2>
          {Object.keys(r.files_in_progress).length === 0 ? <Empty>None.</Empty> : (
            <ul className="divide-y divide-border text-sm">{Object.entries(r.files_in_progress).map(([k, n]) => <li key={k} className="py-2">{words(k)} · {n}</li>)}</ul>
          )}
        </section>
        <section className="space-y-2">
          <h2 className={h2}>Deals in progress</h2>
          {Object.keys(r.deals_in_progress).length === 0 ? <Empty>None.</Empty> : (
            <ul className="divide-y divide-border text-sm">{Object.entries(r.deals_in_progress).map(([k, n]) => <li key={k} className="py-2">{words(k)} · {n}</li>)}</ul>
          )}
        </section>
      </div>
    </div>
  );
}

function EscalationRow({ e }: { e: Escalation }) {
  const resolve = useResolveEscalation();
  const [note, setNote] = useState("");
  return (
    <li className={`space-y-1 py-3 text-sm ${!e.resolved_at ? "rounded-lg bg-red-50 px-3" : ""}`}>
      <p className="font-semibold text-brand-navy">{e.title}{e.business_name && !e.title.includes(e.business_name) ? ` · ${e.business_name}` : ""}</p>
      <p className="whitespace-pre-line">{e.note}</p>
      <p className="text-xs text-muted-foreground">
        {e.automatic ? "Automatic (24 hours)" : `By ${e.raised_by ?? "?"}`} · {fmt(e.created_at)} · {e.resolved_at ? `closed after ${e.hours_open}h` : `open ${e.hours_open}h`}
      </p>
      {e.resolved_at ? <p className="text-xs text-green-700">Closed by {e.resolved_by}: {e.resolution_note}</p> : (
        <div className="flex flex-wrap gap-2">
          <Input className="max-w-md" maxLength={1000} aria-label="What was done" placeholder="What was done" value={note} onChange={(x) => setNote(x.target.value)} />
          <button type="button" className={primaryButton} disabled={note.trim().length < 3 || resolve.isPending}
            onClick={() => resolve.mutate({ id: e.escalation_id, note }, { onSuccess: () => { toast.success("Closed"); setNote(""); }, onError: (x) => toast.error(errorText(x)) })}>
            Close
          </button>
        </div>
      )}
    </li>
  );
}

function EscalationsView() {
  const [openOnly, setOpenOnly] = useState(true);
  const q = useEscalationBoard(openOnly, true);
  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} />Open only</label>
      <Status q={q} />
      <ul className="divide-y divide-border">
        {(q.data ?? []).map((e) => <EscalationRow key={e.escalation_id} e={e} />)}
        {q.data && q.data.length === 0 ? <li className="py-3 text-sm text-muted-foreground">Nothing escalated.</li> : null}
      </ul>
    </div>
  );
}

export default function StaffReportsPage() {
  const { data: role, isLoading } = useStaffRole();
  const [tab, setTab] = useState<Tab>("briefing");
  const [day, setDay] = useState("");
  if (isLoading) return <Empty>Loading…</Empty>;
  if (!canDecideTimeRequests(role)) return <p className="text-sm text-muted-foreground">Reports are for the Founder and the Administrator.</p>;
  return (
    <section className={`${card} space-y-4`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-bold text-brand-navy">Reports</h1>
        {tab !== "escalations" ? (
          <label className="flex items-center gap-2 text-sm">Day <Input type="date" className="w-auto" value={day} onChange={(e) => setDay(e.target.value)} /></label>
        ) : null}
      </div>
      <div role="tablist" className="flex flex-wrap gap-2">
        {TABS.map(([t, l]) => (
          <button key={t} role="tab" type="button" aria-selected={tab === t} onClick={() => setTab(t)}
            className={`rounded-full border px-4 py-1.5 text-sm ${tab === t ? "border-brand-teal bg-teal-50 font-semibold text-brand-navy" : "border-border"}`}>{l}</button>
        ))}
      </div>
      {tab === "briefing" ? <BriefingView day={day || null} /> : tab === "eod" ? <EndOfDayView day={day || null} />
        : tab === "files" ? <FilesView day={day || null} /> : <EscalationsView />}
    </section>
  );
}
