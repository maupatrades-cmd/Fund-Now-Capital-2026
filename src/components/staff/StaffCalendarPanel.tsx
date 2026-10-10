import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Field, card, errorText, primaryButton, selectClass, textareaClass } from "@/components/staff/StaffShell";
import {
  BOOKING_CATEGORIES, useCalendarAvailability, useCalendarDiary, useCancelBooking, useCreateBooking, useMyCalendarGrants,
  useRecordShortNoticeHandling, useRescheduleBooking, type DiaryEvent,
} from "@/hooks/useStaffDesk";

const fmt = (iso: string) => new Date(iso).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

// The diary a staff member may touch: availability, bookings, changes and
// confirmations, scoped to the calendars the Owner granted. Each of the four
// permissions is separate; the database decides, this screen only mirrors it.
export default function StaffCalendarPanel() {
  const grants = useMyCalendarGrants();
  const [calendar, setCalendar] = useState<string>("");
  const calendars = useMemo(() => {
    const m = new Map<string, { name: string; perms: Set<string> }>();
    for (const g of grants.data ?? []) {
      const e = m.get(g.calendar_owner_id) ?? { name: g.calendar_owner_name, perms: new Set<string>() };
      e.perms.add(g.permission); m.set(g.calendar_owner_id, e);
    }
    return m;
  }, [grants.data]);
  const selected = calendar || [...calendars.keys()][0] || "";
  const perms = calendars.get(selected)?.perms ?? new Set<string>();

  // Rolling two-week window starting today.
  const [from, to] = useMemo(() => {
    const f = new Date(); f.setHours(0, 0, 0, 0);
    const t = new Date(f); t.setDate(t.getDate() + 14);
    return [f.toISOString(), t.toISOString()];
  }, []);
  const canDiary = perms.has("create") || perms.has("change_own") || perms.has("manage_others");
  const diary = useCalendarDiary(selected, from, to, canDiary);
  const availability = useCalendarAvailability(selected, from, to, perms.has("view_availability"));

  if (grants.isLoading) return <p className="text-sm text-muted-foreground">Loading...</p>;
  if (calendars.size === 0) {
    return (
      <section className={card}>
        <h2 className="text-base font-bold text-brand-navy">Calendar</h2>
        <p className="text-sm text-muted-foreground">You have no calendar permissions yet. The Owner grants them per calendar and per person.</p>
      </section>
    );
  }

  return (
    <section className={`${card} space-y-4`}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-base font-bold text-brand-navy">Calendar</h2>
        <select aria-label="Calendar" className={`${selectClass} max-w-xs`} value={selected} onChange={(e) => setCalendar(e.target.value)}>
          {[...calendars.entries()].map(([id, c]) => <option key={id} value={id}>{c.name}</option>)}
        </select>
      </div>
      <p className="text-xs text-muted-foreground">
        Your permissions here: {[...perms].map((p) => p.replace("_", " ")).join(", ")}. Times are Africa/Johannesburg.
      </p>

      {perms.has("create") ? <BookingForm calendarOwner={selected} /> : null}

      {perms.has("view_availability") ? (
        <div>
          <h3 className="mb-1 text-sm font-bold text-brand-navy">Availability (next two weeks)</h3>
          <ul className="text-sm">
            {(availability.data ?? []).map((b, i) => (
              <li key={i} className={b.kind === "busy" ? "text-muted-foreground" : "text-green-700"}>
                {b.kind === "busy" ? "Busy" : "Open"} · {fmt(b.starts_at)} to {fmt(b.ends_at)}
              </li>
            ))}
            {availability.data && availability.data.length === 0 ? <li className="text-muted-foreground">Nothing booked and no open slots.</li> : null}
          </ul>
        </div>
      ) : null}

      {canDiary ? (
        <div>
          <h3 className="mb-1 text-sm font-bold text-brand-navy">Bookings</h3>
          {diary.error ? <p role="alert" className="text-sm text-red-600">{errorText(diary.error)}</p> : null}
          <ul className="divide-y divide-border">
            {(diary.data ?? []).map((e) => <EventRow key={e.event_id} e={e} />)}
            {diary.data && diary.data.length === 0 ? <li className="py-2 text-sm text-muted-foreground">No bookings in this window.</li> : null}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function BookingForm({ calendarOwner }: { calendarOwner: string }) {
  const create = useCreateBooking();
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [f, setF] = useState({ title: "", category: "call", start: "", end: "", visibility: "busy" as "private" | "busy" | "public", publicTitle: "", agenda: "", email: "", name: "" });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const r = await create.mutateAsync({
        calendarOwner, title: f.title, category: f.category, startsAt: new Date(f.start).toISOString(), endsAt: new Date(f.end).toISOString(),
        visibility: f.visibility, publicTitle: f.publicTitle, agenda: f.agenda, attendeeEmail: f.email, attendeeName: f.name, idempotencyKey: key,
      });
      toast.success(r.status === "existing" ? "Already booked" : r.short_notice ? "Booked. This is under 24 hours' notice and needs handling." : "Booked. The confirmation is queued, not sent yet.");
      setKey(crypto.randomUUID());
      setF({ ...f, title: "", agenda: "", email: "", name: "", publicTitle: "" });
    } catch (err) {
      toast.error(errorText(err));
    }
  };
  return (
    <form onSubmit={submit} className="grid gap-3 rounded-xl border border-border p-4 md:grid-cols-2">
      <Field label="Title"><Input required minLength={3} maxLength={160} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
      <Field label="Type">
        <select className={selectClass} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
          {BOOKING_CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </Field>
      <Field label="Starts"><Input type="datetime-local" required value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></Field>
      <Field label="Ends"><Input type="datetime-local" required value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></Field>
      <Field label="Who can see the title" hint="Others only ever see Busy or Private unless you choose Public.">
        <select className={selectClass} value={f.visibility} onChange={(e) => setF({ ...f, visibility: e.target.value as typeof f.visibility })}>
          <option value="busy">Busy (title hidden)</option><option value="private">Private</option><option value="public">Public (safe title)</option>
        </select>
      </Field>
      {f.visibility === "public" ? <Field label="Public title"><Input required minLength={3} maxLength={120} value={f.publicTitle} onChange={(e) => setF({ ...f, publicTitle: e.target.value })} /></Field> : null}
      <Field label="Attendee email (for the confirmation)"><Input type="email" maxLength={160} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
      <Field label="Attendee name"><Input maxLength={120} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <div className="md:col-span-2">
        <Field label="Agenda (optional)"><textarea maxLength={1000} className={textareaClass} value={f.agenda} onChange={(e) => setF({ ...f, agenda: e.target.value })} /></Field>
      </div>
      <div className="md:col-span-2"><button type="submit" disabled={create.isPending} className={primaryButton}>Book</button></div>
    </form>
  );
}

function EventRow({ e }: { e: DiaryEvent }) {
  const reschedule = useRescheduleBooking();
  const cancel = useCancelBooking();
  const handle = useRecordShortNoticeHandling();
  const [moving, setMoving] = useState(false);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  const doReschedule = (ev: React.FormEvent) => {
    ev.preventDefault();
    const reason = window.prompt("Why is this being moved?");
    if (!reason) return;
    reschedule.mutate(
      { eventId: e.event_id, startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString(), reason },
      { onSuccess: () => { toast.success("Rescheduled"); setMoving(false); }, onError: (err) => toast.error(errorText(err)) },
    );
  };
  const doCancel = () => {
    const reason = window.prompt("Why is this being cancelled?");
    if (!reason) return;
    cancel.mutate({ eventId: e.event_id, reason }, { onSuccess: () => toast.success("Cancelled"), onError: (err) => toast.error(errorText(err)) });
  };
  const doHandle = () => {
    const note = window.prompt("How was the short notice handled?");
    if (!note || !e.confirmation_id) return;
    handle.mutate({ confirmationId: e.confirmation_id, note }, { onSuccess: () => toast.success("Recorded"), onError: (err) => toast.error(errorText(err)) });
  };

  return (
    <li className="space-y-1 py-2 text-sm">
      <p className={e.status === "cancelled" ? "text-muted-foreground line-through" : "font-semibold text-brand-navy"}>
        {e.display_title} <span className="font-normal text-muted-foreground">· {fmt(e.starts_at)} to {fmt(e.ends_at)}</span>
        {e.is_mine ? <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs">mine</span> : null}
      </p>
      {e.notice_status ? (
        <p className="text-xs text-muted-foreground">
          Confirmation: {e.notice_status === "sent" ? "sent" : e.notice_status === "queued" ? "queued, not sent yet" : e.notice_status}
          {e.short_notice ? " · under 24 hours' notice" : ""}
        </p>
      ) : null}
      {e.needs_short_notice_handling ? (
        <button type="button" className="text-xs font-semibold text-amber-800 underline" onClick={doHandle}>Record how the short notice was handled</button>
      ) : null}
      {e.can_change ? (
        <div className="flex gap-3 pt-1">
          <button type="button" className="text-xs font-semibold text-brand-teal underline" onClick={() => setMoving((m) => !m)}>Reschedule</button>
          <button type="button" className="text-xs font-semibold text-red-700 underline" onClick={doCancel}>Cancel</button>
        </div>
      ) : null}
      {moving ? (
        <form onSubmit={doReschedule} className="flex flex-wrap items-end gap-2 pt-1">
          <Input type="datetime-local" required className="max-w-56" value={start} onChange={(ev) => setStart(ev.target.value)} aria-label="New start" />
          <Input type="datetime-local" required className="max-w-56" value={end} onChange={(ev) => setEnd(ev.target.value)} aria-label="New end" />
          <button type="submit" className={primaryButton}>Move</button>
        </form>
      ) : null}
    </li>
  );
}
