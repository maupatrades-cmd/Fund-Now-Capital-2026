import { useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Field, SAFE_TEXT_NOTE, card, errorText, primaryButton, selectClass } from "@/components/staff/StaffShell";
import {
  canDecideTimeRequests, useDecideTimeRequest, useMyCalendarGrants, useRequestFounderTime, useStaffRole, useTimeRequests,
} from "@/hooks/useStaffDesk";

const CATS = [["consultation", "Consultation"], ["submission", "Submission"], ["submission_update", "Submission update"], ["call", "Call"], ["presentation", "Presentation"], ["paperwork_review", "Paperwork review"]] as const;
const fmt = (iso: string) => new Date(iso).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg", dateStyle: "medium", timeStyle: "short" });
// datetime-local has no zone; staff work in Johannesburg time (UTC+2, no DST).
const toIso = (local: string) => new Date(`${local}:00+02:00`).toISOString();

// Booking windows on the Founder's diary (owner, 17 Oct): Administrator and Coordinator 08:30-14:00,
// Switchboard 08:00-17:00, clients and agents 14:00-17:00. Any other time up to 19:00 is an Important
// or after-hours request with a reason; the Administrator or the Founder decides (never their own).
const afterHours = (iso: string) => Number(new Date(iso).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg", hour: "2-digit", hourCycle: "h23" })) >= 17;

export default function TimeRequestsPanel() {
  const { data: role } = useStaffRole();
  const enabled = !!role;
  const decider = canDecideTimeRequests(role);
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
      <h2 className="text-base font-bold text-brand-navy">Important and after-hours requests</h2>
      {role !== "owner" && owner ? (
        <form className="space-y-3" onSubmit={(e) => {
          e.preventDefault();
          request.mutate({ calendarOwner: owner.calendar_owner_id, category: f.category, startsAt: toIso(f.start), endsAt: toIso(f.end), reason: f.reason }, {
            onSuccess: () => { toast.success("Request sent for approval"); setF({ category: "consultation", start: "", end: "", reason: "" }); },
            onError: (err) => toast.error(errorText(err)),
          });
        }}>
          <p className="text-xs text-muted-foreground">
            Use this for a time outside your booking window (weekdays, up to 19:00). After 17:00 it is an after-hours request.
            The Administrator or the Founder approves it. {SAFE_TEXT_NOTE}
          </p>
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
              {fmt(r.starts_at)} to {fmt(r.ends_at)} <span className="font-normal text-muted-foreground">· {afterHours(r.ends_at) ? "after hours" : "important"} · {r.category.replace("_", " ")} · {r.requester_name}</span>
              <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs">{r.status}</span>
            </p>
            <p className="text-muted-foreground">{r.reason}</p>
            {r.owner_note ? <p className="text-xs">Decision note: {r.owner_note}</p> : null}
            {r.status === "pending" && decider ? (
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
