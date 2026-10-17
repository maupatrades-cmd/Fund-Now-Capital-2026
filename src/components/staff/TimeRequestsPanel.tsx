import { useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Field, SAFE_TEXT_NOTE, card, errorText, primaryButton, selectClass } from "@/components/staff/StaffShell";
import {
  useDecideTimeRequest, useMyCalendarGrants, useRequestFounderTime, useStaffRole, useTimeRequests,
} from "@/hooks/useStaffDesk";

const CATS = [["consultation", "Consultation"], ["submission", "Submission"], ["submission_update", "Submission update"], ["call", "Call"], ["presentation", "Presentation"], ["paperwork_review", "Paperwork review"]] as const;
const fmt = (iso: string) => new Date(iso).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg", dateStyle: "medium", timeStyle: "short" });
// datetime-local has no zone; staff work in Johannesburg time (UTC+2, no DST).
const toIso = (local: string) => new Date(`${local}:00+02:00`).toISOString();

// Coordinator asks for Founder time outside the slots the Founder has opened; the Founder decides.
export default function TimeRequestsPanel() {
  const { data: role } = useStaffRole();
  const enabled = role === "coordinator" || role === "owner";
  const grants = useMyCalendarGrants();
  const list = useTimeRequests(enabled);
  const request = useRequestFounderTime();
  const decide = useDecideTimeRequest();
  const [f, setF] = useState({ category: "consultation", start: "", end: "", reason: "" });
  const [notes, setNotes] = useState<Record<string, string>>({});
  if (!enabled) return null;
  const owner = (grants.data ?? []).find((g) => g.permission === "create");
  const ready = !!owner && !!f.start && !!f.end && f.reason.trim().length >= 10;

  return (
    <section className={`${card} space-y-4`}>
      <h2 className="text-base font-bold text-brand-navy">Founder time requests</h2>
      {role === "coordinator" && owner ? (
        <form className="space-y-3" onSubmit={(e) => {
          e.preventDefault();
          request.mutate({ calendarOwner: owner.calendar_owner_id, category: f.category, startsAt: toIso(f.start), endsAt: toIso(f.end), reason: f.reason }, {
            onSuccess: () => { toast.success("Request sent to the Founder"); setF({ category: "consultation", start: "", end: "", reason: "" }); },
            onError: (err) => toast.error(errorText(err)),
          });
        }}>
          <p className="text-xs text-muted-foreground">Use this only when none of the Founder's open slots suits. {SAFE_TEXT_NOTE}</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Type"><select className={selectClass} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{CATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
            <Field label="From"><Input type="datetime-local" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></Field>
            <Field label="To"><Input type="datetime-local" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></Field>
          </div>
          <Field label="Why this time (at least 10 characters)"><Input maxLength={300} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
          <button type="submit" className={primaryButton} disabled={!ready || request.isPending}>Request time</button>
        </form>
      ) : null}
      {list.error ? <p role="alert" className="text-sm text-red-600">{errorText(list.error)}</p> : null}
      <ul className="divide-y divide-border">
        {(list.data ?? []).map((r) => (
          <li key={r.id} className="space-y-1 py-3 text-sm">
            <p className="font-semibold text-brand-navy">
              {fmt(r.starts_at)} to {fmt(r.ends_at)} <span className="font-normal text-muted-foreground">· {r.category.replace("_", " ")} · {r.requester_name}</span>
              <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs">{r.status}</span>
            </p>
            <p className="text-muted-foreground">{r.reason}</p>
            {r.owner_note ? <p className="text-xs">Founder: {r.owner_note}</p> : null}
            {r.status === "pending" && role === "owner" ? (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Input className="max-w-xs" maxLength={300} placeholder="Note (required to decline)" value={notes[r.id] ?? ""} onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })} />
                <button type="button" className="text-xs font-semibold text-green-700 underline" disabled={decide.isPending}
                  onClick={() => decide.mutate({ requestId: r.id, accept: true, note: notes[r.id] ?? "" }, { onSuccess: () => toast.success("Booked"), onError: (e) => toast.error(errorText(e)) })}>Accept and book</button>
                <button type="button" className="text-xs font-semibold text-red-700 underline" disabled={decide.isPending || (notes[r.id] ?? "").trim().length < 10}
                  onClick={() => decide.mutate({ requestId: r.id, accept: false, note: notes[r.id] ?? "" }, { onSuccess: () => toast.success("Declined"), onError: (e) => toast.error(errorText(e)) })}>Decline</button>
              </div>
            ) : null}
          </li>
        ))}
        {list.data && list.data.length === 0 ? <li className="py-3 text-muted-foreground">No requests.</li> : null}
      </ul>
    </section>
  );
}
