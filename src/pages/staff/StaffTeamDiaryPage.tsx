import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Field, SAFE_TEXT_NOTE, StaffShell, card, errorText, primaryButton, selectClass, textareaClass } from "@/components/staff/StaffShell";
import { TeamAppointmentsList, sastToIso } from "@/components/team-diary/TeamAppointmentsList";
import { useBookTeamAppointment, useTeamAppointments, useTeamDiaryMembers } from "@/hooks/useTeamDiary";

// Team diary (owner, 17 Oct): the Sales Coordinator and Reception set appointments for direct agents,
// sub-agents, Team Leaders and partners. The client is emailed the booking with the team member's name,
// phone and email; every move or cancellation emails the client again, whoever makes it.

const EMPTY = { member: "", clientName: "", clientEmail: "", clientPhone: "", reason: "", start: "", end: "" };

export default function StaffTeamDiaryPage() {
  const members = useTeamDiaryMembers(true);
  const book = useBookTeamAppointment();
  const [f, setF] = useState(EMPTY);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [filter, setFilter] = useState("");
  const range = useMemo(() => {
    const from = new Date(); from.setHours(0, 0, 0, 0);
    const to = new Date(from); to.setDate(to.getDate() + 60);
    return { from: from.toISOString(), to: to.toISOString() };
  }, []);
  const list = useTeamAppointments(filter || null, range.from, range.to);
  const ready = f.member && f.clientName.trim().length >= 2 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.clientEmail.trim())
    && f.reason.trim().length >= 10 && f.start && f.end;

  return (
    <StaffShell>
      <div className="space-y-5">
        <section className={`${card} space-y-4`}>
          <div>
            <h1 className="text-lg font-bold text-brand-navy">Team diary</h1>
            <p className="text-sm text-muted-foreground">
              Book a client meeting for a direct agent, sub-agent, Team Leader or partner. Weekdays 08:00 to 17:00.
              The client is emailed straight away with the team member's name, phone number and email address.
            </p>
          </div>
          {members.error ? <p role="alert" className="text-sm text-red-600">{errorText(members.error)}</p> : null}
          <form className="space-y-3" onSubmit={(e) => {
            e.preventDefault();
            book.mutate({
              member: f.member, clientName: f.clientName, clientEmail: f.clientEmail, clientPhone: f.clientPhone,
              reason: f.reason, startsAt: sastToIso(f.start), endsAt: sastToIso(f.end), idempotencyKey: key,
            }, {
              onSuccess: () => { toast.success("Booked. The client has been emailed."); setF(EMPTY); setKey(crypto.randomUUID()); },
              onError: (err) => toast.error(errorText(err)),
            });
          }}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Team member">
                <select className={selectClass} value={f.member} onChange={(e) => setF({ ...f, member: e.target.value })}>
                  <option value="">Choose…</option>
                  {(members.data ?? []).map((m) => <option key={m.profile_id} value={m.profile_id}>{m.full_name ?? "Unnamed"} · {m.member_type}</option>)}
                </select>
              </Field>
              <Field label="Client name"><Input maxLength={160} value={f.clientName} onChange={(e) => setF({ ...f, clientName: e.target.value })} /></Field>
              <Field label="Client email" hint="The booking email goes here."><Input type="email" maxLength={254} value={f.clientEmail} onChange={(e) => setF({ ...f, clientEmail: e.target.value })} /></Field>
              <Field label="Client phone (optional)"><Input type="tel" maxLength={30} value={f.clientPhone} onChange={(e) => setF({ ...f, clientPhone: e.target.value })} /></Field>
              <Field label="From"><Input type="datetime-local" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></Field>
              <Field label="To"><Input type="datetime-local" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></Field>
            </div>
            <Field label="Reason for the meeting (the client sees this)" hint={SAFE_TEXT_NOTE}>
              <textarea className={textareaClass} maxLength={500} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
            </Field>
            <button type="submit" className={primaryButton} disabled={!ready || book.isPending}>Book and email the client</button>
          </form>
        </section>

        <section className={`${card} space-y-3`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-bold text-brand-navy">Next 60 days</h2>
            <select className={`${selectClass} max-w-xs`} value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Show one team member">
              <option value="">Everyone</option>
              {(members.data ?? []).map((m) => <option key={m.profile_id} value={m.profile_id}>{m.full_name ?? "Unnamed"}</option>)}
            </select>
          </div>
          {list.error ? <p role="alert" className="text-sm text-red-600">{errorText(list.error)}</p> : null}
          {list.data ? <TeamAppointmentsList rows={list.data} showMember /> : <p className="text-sm text-muted-foreground">Loading…</p>}
        </section>
      </div>
    </StaffShell>
  );
}
