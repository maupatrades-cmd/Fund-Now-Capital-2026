import { useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Field, SAFE_TEXT_NOTE, card, errorText, primaryButton, selectClass, textareaClass } from "@/components/staff/StaffShell";
import { sastToIso } from "@/components/team-diary/TeamAppointmentsList";
import { useComplaintStep, useComplaints, useEscalate, useLogComplaint, type AckMethod, type Complaint, type ComplaintKind } from "@/hooks/useStaffReports";

// Complaints and escalations (owner spec §17). Any staff member logs a client or agent complaint; it goes to the
// Director straight away and must be acknowledged to the complainant the same day. Anything else not resolved
// within 24 hours is escalated to the Director with a note. The Founder or the Administrator resolves.
const fmt = (iso: string) => new Date(iso).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg", dateStyle: "medium", timeStyle: "short" });
const KINDS: [ComplaintKind, string][] = [["client", "Client"], ["agent", "Agent"], ["other", "Someone else"]];
const METHODS: [AckMethod, string][] = [["phone", "Phone"], ["email", "Email"], ["whatsapp", "WhatsApp"], ["in_person", "In person"]];

function LogComplaint() {
  const log = useLogComplaint();
  const empty = { kind: "client" as ComplaintKind, name: "", details: "", received: "" };
  const [f, setF] = useState(empty);
  return (
    <form className={`${card} space-y-3`} onSubmit={(e) => {
      e.preventDefault();
      log.mutate({ kind: f.kind, name: f.name, details: f.details, receivedAt: f.received ? sastToIso(f.received) : null }, {
        onSuccess: () => { toast.success("Logged and sent to the Director"); setF(empty); },
        onError: (x) => toast.error(errorText(x)),
      });
    }}>
      <div>
        <h2 className="text-base font-bold text-brand-navy">Log a complaint</h2>
        <p className="text-sm text-muted-foreground">It goes to the Director straight away. Acknowledge it to the person the same day.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Who complained">
          <select className={selectClass} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as ComplaintKind })}>
            {KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        <Field label="Their name"><Input maxLength={160} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Received (leave empty for now)"><Input type="datetime-local" value={f.received} onChange={(e) => setF({ ...f, received: e.target.value })} /></Field>
      </div>
      <Field label="What the complaint is about" hint={SAFE_TEXT_NOTE}>
        <textarea className={textareaClass} maxLength={2000} value={f.details} onChange={(e) => setF({ ...f, details: e.target.value })} />
      </Field>
      <button type="submit" className={primaryButton} disabled={f.name.trim().length < 2 || f.details.trim().length < 10 || log.isPending}>Log complaint</button>
    </form>
  );
}

function EscalateNow() {
  const esc = useEscalate();
  const [note, setNote] = useState("");
  return (
    <form className={`${card} space-y-3`} onSubmit={(e) => {
      e.preventDefault();
      esc.mutate({ note }, { onSuccess: () => { toast.success("Escalated to the Director"); setNote(""); }, onError: (x) => toast.error(errorText(x)) });
    }}>
      <div>
        <h2 className="text-base font-bold text-brand-navy">Escalate to the Director</h2>
        <p className="text-sm text-muted-foreground">For anything not resolved within 24 hours. Tasks still open after 24 hours are escalated automatically.</p>
      </div>
      <Field label="Note for the Director" hint={SAFE_TEXT_NOTE}>
        <textarea className={textareaClass} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <button type="submit" className={primaryButton} disabled={note.trim().length < 10 || esc.isPending}>Escalate</button>
    </form>
  );
}

function ComplaintRow({ c }: { c: Complaint }) {
  const step = useComplaintStep();
  const [note, setNote] = useState("");
  const [method, setMethod] = useState<AckMethod>("phone");
  const run = (s: "acknowledged" | "resolved") => step.mutate({ id: c.complaint_id, step: s, note, method: s === "acknowledged" ? method : undefined }, {
    onSuccess: () => { toast.success(s === "acknowledged" ? "Acknowledgement recorded" : "Complaint resolved"); setNote(""); },
    onError: (x) => toast.error(errorText(x)),
  });
  return (
    <li className={`space-y-2 py-3 text-sm ${!c.acknowledged_at ? "rounded-lg bg-amber-50 px-3" : ""}`}>
      <p className="font-semibold text-brand-navy">
        {c.complainant_name} <span className="font-normal text-muted-foreground">({c.complainant_kind}){c.business_name ? ` · ${c.business_name}` : ""}</span>
        {c.acknowledged_late ? <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-800">Not acknowledged the same day</span> : null}
      </p>
      <p className="whitespace-pre-line">{c.details}</p>
      <p className="text-xs text-muted-foreground">
        Received {fmt(c.received_at)} · logged by {c.logged_by ?? "?"}
        {c.acknowledged_at ? ` · acknowledged ${fmt(c.acknowledged_at)} (${c.acknowledged_method?.replace("_", " ")})` : ""}
        {c.resolved_at ? ` · resolved ${fmt(c.resolved_at)}` : ""}
      </p>
      {c.resolution_note ? <p className="text-xs text-green-700">Resolution: {c.resolution_note}</p> : null}
      {!c.resolved_at && (!c.acknowledged_at || c.can_resolve) ? (
        <div className="flex flex-wrap items-end gap-2">
          <Input className="max-w-md" maxLength={1000} aria-label="Note" placeholder={c.acknowledged_at ? "What was done to resolve it" : "What you told them"}
            value={note} onChange={(e) => setNote(e.target.value)} />
          {!c.acknowledged_at ? (
            <>
              <select className={`${selectClass} max-w-[10rem]`} aria-label="How they were told" value={method} onChange={(e) => setMethod(e.target.value as AckMethod)}>
                {METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <button type="button" className={primaryButton} disabled={note.trim().length < 3 || step.isPending} onClick={() => run("acknowledged")}>Acknowledged</button>
            </>
          ) : (
            <button type="button" className={primaryButton} disabled={note.trim().length < 3 || step.isPending} onClick={() => run("resolved")}>Resolve</button>
          )}
        </div>
      ) : null}
    </li>
  );
}

export default function StaffComplaintsPage() {
  const [openOnly, setOpenOnly] = useState(true);
  const list = useComplaints(openOnly);
  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <LogComplaint />
        <EscalateNow />
      </div>
      <section className={`${card} space-y-3`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-lg font-bold text-brand-navy">Complaints</h1>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} />Open only</label>
        </div>
        {list.error ? <p role="alert" className="text-sm text-red-600">{errorText(list.error)}</p> : null}
        <ul className="divide-y divide-border">
          {(list.data ?? []).map((c) => <ComplaintRow key={c.complaint_id} c={c} />)}
          {list.data && list.data.length === 0 ? <li className="py-3 text-sm text-muted-foreground">No complaints.</li> : null}
        </ul>
      </section>
    </div>
  );
}
