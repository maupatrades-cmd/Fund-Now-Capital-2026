import { useState } from "react";
import { toast } from "sonner";
import { Field, SAFE_TEXT_NOTE, card, errorText, primaryButton, selectClass } from "@/components/staff/StaffShell";
import { Input } from "@/components/ui/input";
import {
  OUTBOUND_STATUS_LABEL, isStaffManager, useIntakeQueue, useMoveOutboundRoute, useOutboundRoutes, useOutboundTeamMembers,
  useStartOutboundRoute, useStaffRole, type OutboundRoute, type OutboundStatus, type StaffRole,
} from "@/hooks/useStaffDesk";

const fmt = (iso: string) => new Date(iso).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg", dateStyle: "medium", timeStyle: "short" });
const MEMBER_LABEL: Record<string, string> = { partner: "Partner", contractor: "Agent", lead_referrer: "Sub-agent" };

// Owner spec 17 Oct, section 6. The Sales Coordinator checks with the team whether an outbound lead belongs
// to anyone. If it does, it is given to that person; if not it goes to New Leads, then the Administrator,
// then the Director. The buttons mirror what the database allows; the database is what enforces it.
function nextSteps(status: OutboundStatus, role: StaffRole | null | undefined): OutboundStatus[] {
  const manager = role === "coordinator" || role === "administrator" || role === "owner";
  switch (status) {
    case "with_coordinator": return manager ? ["assigned", "new_leads"] : [];
    case "new_leads": return manager ? ["assigned", "with_administrator"] : [];
    case "with_administrator": return role === "administrator" || role === "owner" ? ["assigned", "with_director"] : [];
    case "with_director": return role === "owner" ? ["assigned", "director_received"] : [];
    default: return [];
  }
}
const STEP_LABEL: Record<OutboundStatus, string> = {
  with_coordinator: "", assigned: "It belongs to a team member", new_leads: "Nobody owns it: move to New Leads",
  with_administrator: "Send to the Administrator", with_director: "Send to the Director", director_received: "I have it",
};

function RouteRow({ r, role }: { r: OutboundRoute; role: StaffRole | null | undefined }) {
  const steps = nextSteps(r.status, role);
  const move = useMoveOutboundRoute();
  const team = useOutboundTeamMembers(steps.includes("assigned"));
  const [note, setNote] = useState("");
  const [person, setPerson] = useState("");
  const go = (to: OutboundStatus) => {
    if (to === "assigned" && !person) { toast.error("Choose the team member the lead belongs to."); return; }
    // The database requires a note (who you checked with) for these two steps.
    if ((to === "assigned" || to === "new_leads") && note.trim().length < 3) { toast.error("Say who you checked with in the note."); return; }
    move.mutate({ routeId: r.id, to, note, assignedProfile: to === "assigned" ? person : null }, {
      onSuccess: () => { toast.success(OUTBOUND_STATUS_LABEL[to]); setNote(""); setPerson(""); },
      onError: (e) => toast.error(errorText(e)),
    });
  };
  return (
    <li className="space-y-2 py-3 text-sm">
      <p className="font-semibold text-brand-navy">
        {r.business_name}
        <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-normal">{OUTBOUND_STATUS_LABEL[r.status]}</span>
        {r.assigned_name ? <span className="ml-2 text-xs font-normal text-muted-foreground">· {r.assigned_name}</span> : null}
      </p>
      <ol className="space-y-0.5 border-l-2 border-slate-200 pl-3 text-xs text-muted-foreground">
        {r.history.map((h, i) => (
          <li key={i}>{fmt(h.at)} · {h.who}: {OUTBOUND_STATUS_LABEL[h.to]}{h.note ? ` — ${h.note}` : ""}</li>
        ))}
      </ol>
      {steps.length ? (
        <div className="flex flex-wrap items-center gap-2">
          <Input className="max-w-xs" maxLength={500} aria-label="Note" placeholder={steps.includes("assigned") || steps.includes("new_leads") ? "Who you checked with (required)" : "Note (optional)"} value={note} onChange={(e) => setNote(e.target.value)} />
          {steps.includes("assigned") ? (
            <select className={`${selectClass} max-w-xs`} aria-label="Team member" value={person} onChange={(e) => setPerson(e.target.value)}>
              <option value="">Team member...</option>
              {(team.data ?? []).map((m) => <option key={m.profile_id} value={m.profile_id}>{m.full_name} ({MEMBER_LABEL[m.member_role] ?? m.member_role})</option>)}
            </select>
          ) : null}
          {steps.map((s) => (
            <button key={s} type="button" disabled={move.isPending} onClick={() => go(s)} className="text-xs font-semibold text-brand-teal underline">{STEP_LABEL[s]}</button>
          ))}
        </div>
      ) : null}
    </li>
  );
}

export default function StaffOutboundPage() {
  const { data: role } = useStaffRole();
  const [openOnly, setOpenOnly] = useState(true);
  const routes = useOutboundRoutes(openOnly);
  // Any lead with a route (open or finished) cannot start another one.
  const allRoutes = useOutboundRoutes(false);
  const queue = useIntakeQueue(null, false);
  const start = useStartOutboundRoute();
  const [leadId, setLeadId] = useState("");
  const [note, setNote] = useState("");
  const routed = new Set((allRoutes.data ?? []).map((r) => r.lead_id));

  return (
    <>
      <div>
        <h1 className="text-2xl font-bold text-brand-navy">Outbound leads</h1>
        <p className="text-sm text-muted-foreground">
          The Sales Coordinator checks whether a lead belongs to a team member. If nobody owns it, it goes to New Leads, then the Administrator, then the Director.
        </p>
      </div>

      <form className={`${card} grid gap-4 md:grid-cols-3`} onSubmit={(e) => {
        e.preventDefault();
        if (!leadId) { toast.error("Choose the lead."); return; }
        start.mutate({ leadId, note }, {
          onSuccess: () => { toast.success("Sent to the Sales Coordinator"); setLeadId(""); setNote(""); },
          onError: (err) => toast.error(errorText(err)),
        });
      }}>
        <Field label="Lead">
          <select className={selectClass} value={leadId} onChange={(e) => setLeadId(e.target.value)}>
            <option value="">Choose a lead...</option>
            {(queue.data ?? []).filter((r) => !routed.has(r.lead_id)).map((r) => <option key={r.lead_id} value={r.lead_id}>{r.business_name}</option>)}
          </select>
        </Field>
        <Field label="Note (optional)" hint={SAFE_TEXT_NOTE}><Input maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <div className="flex items-end"><button type="submit" className={primaryButton} disabled={start.isPending}>Send to the Sales Coordinator</button></div>
      </form>

      <section className={card}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-bold text-brand-navy">{openOnly ? "Leads being routed" : "All routed leads"}</h2>
          <button type="button" className="text-sm font-semibold text-brand-teal underline" onClick={() => setOpenOnly(!openOnly)}>
            Show {openOnly ? "all" : "only open"}
          </button>
        </div>
        {routes.error ? <p role="alert" className="text-sm text-red-600">{errorText(routes.error)}</p> : null}
        {!isStaffManager(role) ? <p className="mb-2 text-xs text-muted-foreground">You see the leads you sent.</p> : null}
        <ul className="divide-y divide-border">
          {(routes.data ?? []).map((r) => <RouteRow key={r.id} r={r} role={role} />)}
          {routes.data && routes.data.length === 0 ? <li className="py-3 text-sm text-muted-foreground">Nothing here.</li> : null}
        </ul>
      </section>
    </>
  );
}
