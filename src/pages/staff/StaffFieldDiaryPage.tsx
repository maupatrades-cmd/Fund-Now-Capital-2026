import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Field, card, errorText, primaryButton, selectClass } from "@/components/staff/StaffShell";
import { canDecideTimeRequests, isFieldRole, useStaffRole } from "@/hooks/useStaffDesk";
import { useFieldLeads } from "@/hooks/useFieldLeads";
import {
  FIELD_MEETING_STATUS_LABEL, addDays, sastDay, sastDayLabel, sastIso, sastTime, useBookFieldMeeting, useFieldDiaryPeople,
  useFieldMeetings, useSetFieldMeetingStatus, weekStart, type FieldMeeting,
} from "@/hooks/useFieldDiary";

const ROLE_LABEL: Record<string, string> = { field_supervisor: "Field Supervisor", field_consultant: "Field consultant" };
const ghostButton = "inline-flex h-11 items-center justify-center rounded-lg border border-border px-4 text-sm font-semibold text-brand-navy hover:bg-slate-50 disabled:opacity-50";

function BookForm({ person, personName, defaultDay }: { person: string | null; personName: string | null; defaultDay: string }) {
  const book = useBookFieldMeeting();
  const leads = useFieldLeads(true);
  const blank = { title: "", day: defaultDay, start: "09:00", end: "10:00", kind: "client" as "client" | "internal", location: "", leadId: "", note: "" };
  const [form, setForm] = useState(blank);
  const set = <K extends keyof typeof blank>(k: K, v: (typeof blank)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    book.mutate({
      person, title: form.title.trim(), startsAt: sastIso(form.day, form.start), endsAt: sastIso(form.day, form.end), kind: form.kind,
      location: form.location.trim(), leadId: form.kind === "client" && form.leadId ? form.leadId : null, note: form.note.trim(),
    }, {
      onSuccess: () => { toast.success(personName ? `Meeting booked on ${personName}'s diary` : "Meeting booked"); setForm({ ...blank, day: form.day }); },
      onError: (err) => toast.error(errorText(err)),
    });
  };
  return (
    <form onSubmit={submit} className={`${card} grid gap-4 sm:grid-cols-2`}>
      <h2 className="text-base font-bold text-brand-navy sm:col-span-2">Book a meeting{personName ? ` for ${personName}` : ""}</h2>
      <div className="sm:col-span-2">
        <Field label="What is the meeting?"><Input required minLength={3} maxLength={160} value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Visit Delta Bakery about stock finance" /></Field>
      </div>
      <Field label="Day"><Input type="date" required value={form.day} onChange={(e) => set("day", e.target.value)} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Starts"><Input type="time" required step={900} value={form.start} onChange={(e) => set("start", e.target.value)} /></Field>
        <Field label="Ends"><Input type="time" required step={900} value={form.end} onChange={(e) => set("end", e.target.value)} /></Field>
      </div>
      <Field label="Type">
        <select className={selectClass} value={form.kind} onChange={(e) => set("kind", e.target.value as "client" | "internal")}>
          <option value="client">With a client or lead</option>
          <option value="internal">Internal (team)</option>
        </select>
      </Field>
      <Field label="Where (optional)"><Input maxLength={200} value={form.location} onChange={(e) => set("location", e.target.value)} placeholder="Address, area or 'Teams call'" /></Field>
      {form.kind === "client" ? (
        <Field label="Field lead (optional)">
          <select className={selectClass} value={form.leadId} onChange={(e) => set("leadId", e.target.value)}>
            <option value="">Not linked to a field lead</option>
            {(leads.data ?? []).map((l) => <option key={l.lead_id} value={l.lead_id}>{l.business_name}</option>)}
          </select>
        </Field>
      ) : null}
      <div className={form.kind === "client" ? "" : "sm:col-span-2"}>
        <Field label="Who is attending / note (optional)"><Input maxLength={500} value={form.note} onChange={(e) => set("note", e.target.value)} /></Field>
      </div>
      <div className="sm:col-span-2"><button type="submit" className={`${primaryButton} w-full sm:w-auto`} disabled={book.isPending}>Book meeting</button></div>
    </form>
  );
}

function MeetingRow({ m }: { m: FieldMeeting }) {
  const setStatus = useSetFieldMeetingStatus();
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const act = (status: "done" | "cancelled") => setStatus.mutate({ id: m.id, status, reason: status === "cancelled" ? reason.trim() : undefined }, {
    onSuccess: () => { toast.success(status === "done" ? "Marked done" : "Meeting cancelled"); setCancelling(false); setReason(""); },
    onError: (err) => toast.error(errorText(err)),
  });
  return (
    <li className={`rounded-xl border border-border p-3 ${m.status === "cancelled" ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-bold tabular-nums text-brand-navy">{sastTime(m.starts_at)}–{sastTime(m.ends_at)}</span>
        <span className="font-semibold">{m.title}</span>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-brand-navy">{m.meeting_kind === "client" ? "Client" : "Internal"}</span>
        {m.status !== "scheduled" ? <span className="text-xs font-semibold text-muted-foreground">{FIELD_MEETING_STATUS_LABEL[m.status]}</span> : null}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {[m.location, m.business_name ? `Lead: ${m.business_name}` : null, m.attendee_note, m.created_by_name ? `Booked by ${m.created_by_name}` : null].filter(Boolean).join(" · ")}
      </p>
      {m.cancel_reason ? <p className="mt-1 text-xs text-muted-foreground">Reason: {m.cancel_reason}</p> : null}
      {m.status === "scheduled" ? (
        cancelling ? (
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <Input aria-label="Why is it cancelled?" placeholder="Why is it cancelled?" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
            <button type="button" className={primaryButton} disabled={setStatus.isPending || reason.trim().length < 3} onClick={() => act("cancelled")}>Cancel meeting</button>
            <button type="button" className={ghostButton} onClick={() => setCancelling(false)}>Keep it</button>
          </div>
        ) : (
          <div className="mt-2 flex gap-2">
            <button type="button" className={ghostButton} disabled={setStatus.isPending} onClick={() => act("done")}>Mark done</button>
            <button type="button" className={ghostButton} onClick={() => setCancelling(true)}>Cancel…</button>
          </div>
        )
      ) : null}
    </li>
  );
}

export default function StaffFieldDiaryPage() {
  const { data: role } = useStaffRole();
  const allowed = isFieldRole(role) || canDecideTimeRequests(role);
  const people = useFieldDiaryPeople(allowed);
  const [chosen, setChosen] = useState<string>("");
  const [view, setView] = useState<"day" | "week">("day");
  const [day, setDay] = useState(sastDay());
  const [showCancelled, setShowCancelled] = useState(false);

  // Field staff open their own diary first; the Director and the Administrator have none of their own, so they open
  // the first field diary in the list.
  const list = people.data ?? [];
  const person = chosen || list.find((p) => p.is_me)?.profile_id || list[0]?.profile_id || "";
  const me = list.find((p) => p.is_me)?.profile_id;
  const personRow = list.find((p) => p.profile_id === person);
  const from = view === "day" ? day : weekStart(day);
  const to = view === "day" ? day : addDays(from, 6);
  const meetings = useFieldMeetings(person || null, from, to, showCancelled, allowed && !!person);

  const byDay = useMemo(() => {
    const days = view === "day" ? [from] : Array.from({ length: 7 }, (_, i) => addDays(from, i));
    return days.map((d) => ({ day: d, items: (meetings.data ?? []).filter((m) => sastDay(new Date(m.starts_at)) === d) }));
  }, [meetings.data, from, view]);

  if (role && !allowed) return <p className="text-sm text-muted-foreground">The field diary is for the field team, the Director and the Administrator.</p>;

  const step = view === "day" ? 1 : 7;
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-brand-navy">My diary</h1>
        <p className="text-sm text-muted-foreground">Meetings with clients and leads, and internal meetings. Times are South African time.</p>
      </div>

      {list.length > 1 ? (
        <Field label="Whose diary">
          <select className={selectClass} value={person} onChange={(e) => setChosen(e.target.value)}>
            {list.map((p) => (
              <option key={p.profile_id} value={p.profile_id}>{p.is_me ? "My diary" : `${p.full_name ?? "Unnamed"} (${ROLE_LABEL[p.role] ?? p.role})`}</option>
            ))}
          </select>
        </Field>
      ) : null}
      {people.isSuccess && list.length === 0 ? <p className="text-sm text-muted-foreground">There are no field diaries yet.</p> : null}

      <section className={`${card} space-y-4`}>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-border p-1" role="group" aria-label="View">
            {(["day", "week"] as const).map((v) => (
              <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}
                className={`rounded-md px-4 py-2 text-sm font-semibold ${view === v ? "bg-brand-teal text-white" : "text-brand-navy"}`}>
                {v === "day" ? "Day" : "Week"}
              </button>
            ))}
          </div>
          <button type="button" className={ghostButton} aria-label="Previous" onClick={() => setDay(addDays(day, -step))}>‹</button>
          <button type="button" className={ghostButton} onClick={() => setDay(sastDay())}>Today</button>
          <button type="button" className={ghostButton} aria-label="Next" onClick={() => setDay(addDays(day, step))}>›</button>
          <label className="ml-auto flex items-center gap-2 text-sm">
            <input type="checkbox" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} /> Show cancelled
          </label>
        </div>
        <p className="text-sm font-semibold text-brand-navy">
          {view === "day" ? sastDayLabel(day) : `${sastDayLabel(from)} to ${sastDayLabel(to)}`}
          {personRow && !personRow.is_me ? ` · ${personRow.full_name ?? ""}` : ""}
        </p>
        {meetings.isError ? <p className="text-sm text-red-700">{errorText(meetings.error)}</p> : null}
        {meetings.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
        <div className="space-y-4">
          {byDay.map(({ day: d, items }) => (
            <div key={d} className="space-y-2">
              {view === "week" ? <h3 className="text-sm font-bold text-brand-navy">{sastDayLabel(d)}</h3> : null}
              {items.length ? <ul className="space-y-2">{items.map((m) => <MeetingRow key={m.id} m={m} />)}</ul>
                : <p className="text-sm text-muted-foreground">No meetings.</p>}
            </div>
          ))}
        </div>
      </section>

      {person ? (
        <BookForm key={person} person={person === me ? null : person} personName={personRow && !personRow.is_me ? personRow.full_name : null} defaultDay={day} />
      ) : null}
    </div>
  );
}
