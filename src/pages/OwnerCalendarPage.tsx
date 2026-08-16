import { useMemo, useState, type FormEvent } from "react";
import {
  CalendarCheck,
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  Eye,
  EyeOff,
  ListTodo,
  Loader2,
  Plus,
  RotateCcw,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  oneCalendarRelation,
  useCancelOwnerCalendarEvent,
  useCreateOwnerCalendarEvent,
  useDecideOwnerBooking,
  useOwnerCalendarOptions,
  useOwnerCalendarRange,
  usePublishOwnerAvailability,
  type OwnerBooking,
  type OwnerCalendarEvent,
} from "@/hooks/useOwnerCalendar";
import {
  addCalendarDays,
  calendarRange,
  CALENDAR_CATEGORIES,
  CATEGORY_LABELS,
  formatCalendarDay,
  formatCalendarTime,
  isConsultationTimeAllowed,
  startOfCalendarDay,
  toLocalDateTimeInput,
  type CalendarCategory,
  type CalendarVisibility,
} from "@/lib/ownerCalendar";

type CalendarView = "day" | "week";

const fieldClass = "min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/15";

function defaultMeetingStart() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(14, 0, 0, 0);
  return date;
}

function categoryTone(category: CalendarCategory) {
  if (category === "urgent") return "bg-rose-50 text-rose-700 ring-rose-200";
  if (category === "submission") return "bg-blue-50 text-blue-700 ring-blue-200";
  if (category === "submission_update") return "bg-amber-50 text-amber-800 ring-amber-200";
  return "bg-teal-50 text-teal-700 ring-teal-200";
}

function describeError(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function EventForm({ eventsSupported }: { eventsSupported: boolean }) {
  const options = useOwnerCalendarOptions();
  const createEvent = useCreateOwnerCalendarEvent();
  const initialStart = useMemo(defaultMeetingStart, []);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<CalendarCategory>("consultation");
  const [startsAt, setStartsAt] = useState(toLocalDateTimeInput(initialStart));
  const [endsAt, setEndsAt] = useState(toLocalDateTimeInput(new Date(initialStart.getTime() + 30 * 60_000)));
  const [visibleToPortals, setVisibleToPortals] = useState(false);
  const [shareLabel, setShareLabel] = useState(false);
  const [publicLabel, setPublicLabel] = useState("");
  const [clientId, setClientId] = useState("");
  const [leadId, setLeadId] = useState("");
  const [dealId, setDealId] = useState("");
  const [notes, setNotes] = useState("");
  const [createTask, setCreateTask] = useState(true);

  const visibility: CalendarVisibility = !visibleToPortals ? "private" : shareLabel ? "public" : "busy";
  const deals = (options.data?.deals ?? []).filter((deal) => !clientId || deal.clientId === clientId);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!eventsSupported) return;
    if (new Date(endsAt) <= new Date(startsAt)) {
      toast.error("The end time must be after the start time.");
      return;
    }
    if (category === "consultation" && !isConsultationTimeAllowed(startsAt, endsAt)) {
      toast.error("Client consultations must be scheduled between 14:00 and 20:00.");
      return;
    }
    try {
      await createEvent.mutateAsync({
        title,
        category,
        startsAt: new Date(startsAt).toISOString(),
        endsAt: new Date(endsAt).toISOString(),
        visibility,
        publicLabel,
        clientId,
        leadId,
        dealId,
        notes,
        createTask,
      });
      setTitle("");
      setNotes("");
      setPublicLabel("");
      toast.success(createTask ? "Event and Owner task created" : "Event created");
    } catch (error) {
      toast.error(describeError(error, "Could not create the event."));
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-brand-navy">Create Owner event</h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">Private details stay Owner-only. Shared calendars receive only the visibility you choose.</p>
        </div>
        <CalendarClock className="h-5 w-5 shrink-0 text-brand-teal" aria-hidden="true" />
      </div>

      {!eventsSupported && (
        <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
          The governed event extension is not available in this environment yet. Availability and booking decisions below still work.
        </div>
      )}

      <label className="block text-xs font-semibold text-slate-700">
        Event title
        <input className={`${fieldClass} mt-1`} value={title} onChange={(event) => setTitle(event.target.value)} minLength={3} maxLength={160} required placeholder="Example: Review Nkosi Engineering submission" />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-semibold text-slate-700">
          Category
          <select className={`${fieldClass} mt-1`} value={category} onChange={(event) => setCategory(event.target.value as CalendarCategory)}>
            {CALENDAR_CATEGORIES.map((value) => <option key={value} value={value}>{CATEGORY_LABELS[value]}</option>)}
          </select>
        </label>
        <label className="flex min-h-11 items-center gap-3 self-end rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-brand-navy">
          <input type="checkbox" className="h-4 w-4 accent-brand-teal" checked={createTask} onChange={(event) => setCreateTask(event.target.checked)} />
          <ListTodo className="h-4 w-4 text-brand-teal" aria-hidden="true" />
          Create linked Owner task
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-semibold text-slate-700">
          Starts
          <input className={`${fieldClass} mt-1`} type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} required />
        </label>
        <label className="block text-xs font-semibold text-slate-700">
          Ends
          <input className={`${fieldClass} mt-1`} type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} required />
        </label>
      </div>
      {category === "consultation" && <p className="text-xs text-slate-500">Consultation window: 14:00–20:00, Africa/Johannesburg.</p>}

      <fieldset className="rounded-xl border border-slate-200 p-3">
        <legend className="px-1 text-xs font-semibold text-slate-700">Portal visibility</legend>
        <button
          type="button"
          role="switch"
          aria-checked={visibleToPortals}
          onClick={() => setVisibleToPortals((value) => !value)}
          className={`flex min-h-11 w-full items-center justify-between rounded-xl px-3 text-left text-sm font-semibold ${visibleToPortals ? "bg-brand-teal/10 text-brand-navy" : "bg-slate-100 text-slate-600"}`}
        >
          <span className="flex items-center gap-2">{visibleToPortals ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />} Visible to approved portal roles</span>
          <span className="text-xs">{visibleToPortals ? "On" : "Off"}</span>
        </button>
        {visibleToPortals && (
          <div className="mt-3 space-y-3">
            <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
              <input type="checkbox" className="h-4 w-4 accent-brand-teal" checked={shareLabel} onChange={(event) => setShareLabel(event.target.checked)} />
              Show an approved public label; otherwise portals see “Busy” only
            </label>
            {shareLabel && <input aria-label="Public event label" className={fieldClass} value={publicLabel} onChange={(event) => setPublicLabel(event.target.value)} maxLength={100} placeholder="Example: Client consultation block" />}
          </div>
        )}
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-xs font-semibold text-slate-700">Client
          <select className={`${fieldClass} mt-1`} value={clientId} onChange={(event) => { setClientId(event.target.value); setDealId(""); }}>
            <option value="">No client</option>
            {(options.data?.clients ?? []).map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>
        <label className="block text-xs font-semibold text-slate-700">Lead
          <select className={`${fieldClass} mt-1`} value={leadId} onChange={(event) => setLeadId(event.target.value)}>
            <option value="">No lead</option>
            {(options.data?.leads ?? []).map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>
        <label className="block text-xs font-semibold text-slate-700">Deal
          <select className={`${fieldClass} mt-1`} value={dealId} onChange={(event) => setDealId(event.target.value)}>
            <option value="">No deal</option>
            {deals.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>
      </div>

      <label className="block text-xs font-semibold text-slate-700">Private Owner notes
        <textarea className={`${fieldClass} mt-1 min-h-20 resize-y`} value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={1000} placeholder="Preparation notes, documents to review, follow-up details…" />
      </label>

      <button disabled={!eventsSupported || createEvent.isPending || title.trim().length < 3} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-brand-teal px-4 py-2.5 text-sm font-bold text-white transition hover:bg-brand-teal/90 disabled:cursor-not-allowed disabled:opacity-50">
        {createEvent.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        Add to calendar
      </button>
    </form>
  );
}

function AvailabilityForm() {
  const publish = usePublishOwnerAvailability();
  const initialStart = useMemo(defaultMeetingStart, []);
  const [startsAt, setStartsAt] = useState(toLocalDateTimeInput(initialStart));
  const [endsAt, setEndsAt] = useState(toLocalDateTimeInput(new Date(initialStart.getTime() + 30 * 60_000)));
  const [bookingTypes, setBookingTypes] = useState<CalendarCategory[]>(["consultation"]);

  function toggleType(value: CalendarCategory) {
    setBookingTypes((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (bookingTypes.length === 0) return toast.error("Select at least one booking reason.");
    if (new Date(endsAt) <= new Date(startsAt)) return toast.error("The end time must be after the start time.");
    if (bookingTypes.includes("consultation") && !isConsultationTimeAllowed(startsAt, endsAt)) return toast.error("Consultation availability must be between 14:00 and 20:00.");
    try {
      await publish.mutateAsync({ startsAt: new Date(startsAt).toISOString(), endsAt: new Date(endsAt).toISOString(), bookingTypes });
      toast.success("Availability published to approved portal roles");
    } catch (error) {
      toast.error(describeError(error, "Could not publish availability."));
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div>
        <h2 className="text-base font-bold text-brand-navy">Publish bookable time</h2>
        <p className="mt-1 text-xs leading-5 text-slate-500">Consultants, partners, contractors, lead referrers and approved sub-referrers can request these slots.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-semibold text-slate-700">Starts
          <input className={`${fieldClass} mt-1`} type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} required />
        </label>
        <label className="block text-xs font-semibold text-slate-700">Ends
          <input className={`${fieldClass} mt-1`} type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} required />
        </label>
      </div>
      <fieldset>
        <legend className="text-xs font-semibold text-slate-700">Allowed reasons</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {CALENDAR_CATEGORIES.map((value) => (
            <label key={value} className="flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm text-slate-700">
              <input type="checkbox" className="h-4 w-4 accent-brand-teal" checked={bookingTypes.includes(value)} onChange={() => toggleType(value)} />
              {CATEGORY_LABELS[value]}
            </label>
          ))}
        </div>
      </fieldset>
      <button disabled={publish.isPending || bookingTypes.length === 0} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-brand-teal bg-white px-4 py-2.5 text-sm font-bold text-brand-teal transition hover:bg-brand-teal/5 disabled:opacity-50">
        {publish.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarCheck className="h-4 w-4" />}
        Publish availability
      </button>
    </form>
  );
}

function BookingInbox({ bookings }: { bookings: OwnerBooking[] }) {
  const decide = useDecideOwnerBooking();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const pending = bookings.filter((booking) => booking.status === "requested");
  const upcoming = bookings.filter((booking) => booking.status === "confirmed");

  async function act(booking: OwnerBooking, status: "confirmed" | "declined" | "completed") {
    try {
      await decide.mutateAsync({ bookingId: booking.id, status, ownerNote: notes[booking.id] });
      toast.success(status === "confirmed" ? "Booking confirmed; client notification queued" : status === "declined" ? "Booking declined" : "Meeting completed");
    } catch (error) {
      toast.error(describeError(error, "Could not update the booking."));
    }
  }

  function card(booking: OwnerBooking) {
    const slot = oneCalendarRelation(booking.slot);
    const requester = oneCalendarRelation(booking.requester);
    const client = oneCalendarRelation(booking.client);
    const deal = oneCalendarRelation(booking.deal);
    return (
      <article key={booking.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2.5 py-1 text-xs font-bold ring-1 ring-inset ${categoryTone(booking.booking_type)}`}>{CATEGORY_LABELS[booking.booking_type] ?? booking.booking_type}</span>
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">{booking.status}</span>
            </div>
            <p className="mt-3 font-bold text-brand-navy">{client?.business_name ?? "Unlinked client"}</p>
            <p className="mt-1 text-xs text-slate-500">Requested by {requester?.full_name || requester?.email || "CRM user"}{deal?.reference ? ` · ${deal.reference}` : ""}</p>
          </div>
          {slot && <p className="rounded-xl bg-slate-100 px-3 py-2 text-right text-xs font-semibold text-brand-navy">{formatCalendarDay(slot.starts_at)}<br />{formatCalendarTime(slot.starts_at)}–{formatCalendarTime(slot.ends_at)}</p>}
        </div>
        <p className="mt-3 rounded-xl bg-slate-50 p-3 text-sm leading-6 text-slate-700">{booking.agenda}</p>
        <label className="mt-3 block text-xs font-semibold text-slate-700">Owner note
          <input className={`${fieldClass} mt-1`} value={notes[booking.id] ?? ""} onChange={(event) => setNotes((current) => ({ ...current, [booking.id]: event.target.value }))} placeholder="Optional message or preparation note" />
        </label>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {booking.status === "requested" ? (
            <>
              <button disabled={decide.isPending} onClick={() => void act(booking, "confirmed")} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-3 text-sm font-bold text-white disabled:opacity-50"><Check className="h-4 w-4" />Accept</button>
              <button disabled={decide.isPending} onClick={() => void act(booking, "declined")} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-rose-200 px-3 text-sm font-bold text-rose-700 disabled:opacity-50"><X className="h-4 w-4" />Decline</button>
            </>
          ) : (
            <button disabled={decide.isPending} onClick={() => void act(booking, "completed")} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-brand-navy px-3 text-sm font-bold text-white disabled:opacity-50 sm:col-span-2"><Check className="h-4 w-4" />Mark meeting complete</button>
          )}
        </div>
      </article>
    );
  }

  return (
    <section aria-labelledby="booking-inbox-heading" className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div><h2 id="booking-inbox-heading" className="text-lg font-bold text-brand-navy">Booking request inbox</h2><p className="mt-1 text-sm text-slate-500">Accepting a linked client booking queues the confirmation email.</p></div>
        {pending.length > 0 && <span className="rounded-full bg-rose-100 px-3 py-1 text-xs font-bold text-rose-700">{pending.length} waiting</span>}
      </div>
      {pending.length === 0 && upcoming.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center"><CalendarCheck className="mx-auto h-7 w-7 text-slate-300" /><p className="mt-2 text-sm text-slate-500">No booking requests or confirmed meetings.</p></div> : <div className="grid gap-4 xl:grid-cols-2">{pending.map(card)}{upcoming.map(card)}</div>}
    </section>
  );
}

function Agenda({ days, events, slots, bookings }: { days: Date[]; events: OwnerCalendarEvent[]; slots: { id: string; starts_at: string; ends_at: string; is_open: boolean }[]; bookings: OwnerBooking[] }) {
  const cancelEvent = useCancelOwnerCalendarEvent();

  async function cancel(event: OwnerCalendarEvent) {
    if (!window.confirm(`Cancel “${event.title}”?`)) return;
    try {
      await cancelEvent.mutateAsync(event.id);
      toast.success("Event cancelled");
    } catch (error) {
      toast.error(describeError(error, "Could not cancel the event."));
    }
  }

  return (
    <div className={`grid gap-3 ${days.length > 1 ? "lg:grid-cols-7" : ""}`}>
      {days.map((day) => {
        const start = startOfCalendarDay(day).getTime();
        const end = addCalendarDays(startOfCalendarDay(day), 1).getTime();
        const dayEvents = events.filter((event) => new Date(event.starts_at).getTime() >= start && new Date(event.starts_at).getTime() < end);
        const daySlots = slots.filter((slot) => new Date(slot.starts_at).getTime() >= start && new Date(slot.starts_at).getTime() < end);
        const items = [
          ...dayEvents.map((event) => ({ kind: "event" as const, startsAt: event.starts_at, event })),
          ...daySlots.map((slot) => ({ kind: "slot" as const, startsAt: slot.starts_at, slot })),
        ].sort((a, b) => a.startsAt.localeCompare(b.startsAt));

        return (
          <section key={day.toISOString()} aria-label={formatCalendarDay(day, true)} className="min-w-0 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
            <h3 className="border-b border-slate-100 pb-2 text-sm font-bold text-brand-navy">{formatCalendarDay(day)}</h3>
            <div className="mt-3 space-y-2">
              {items.map((item) => {
                if (item.kind === "event") {
                  const event = item.event;
                  return <article key={`event-${event.id}`} className="rounded-xl border border-slate-200 p-2.5">
                    <div className="flex items-start justify-between gap-2"><p className="text-xs font-bold text-brand-navy">{formatCalendarTime(event.starts_at)} · {event.title}</p><button aria-label={`Cancel ${event.title}`} disabled={cancelEvent.isPending} onClick={() => void cancel(event)} className="rounded-lg p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-3.5 w-3.5" /></button></div>
                    <span className={`mt-2 inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ring-inset ${categoryTone(event.category)}`}>{CATEGORY_LABELS[event.category]}</span>
                    <p className="mt-2 flex items-center gap-1 text-[10px] text-slate-500">{event.visibility === "public" ? <Eye className="h-3 w-3" /> : event.visibility === "busy" ? <Clock3 className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}{event.visibility === "public" ? "Public label" : event.visibility === "busy" ? "Busy only" : "Private"}</p>
                  </article>;
                }
                const booking = bookings.find((candidate) => oneCalendarRelation(candidate.slot)?.id === item.slot.id && ["requested", "confirmed"].includes(candidate.status));
                return <article key={`slot-${item.slot.id}`} className={`rounded-xl border p-2.5 ${item.slot.is_open ? "border-dashed border-teal-300 bg-teal-50/60" : "border-amber-200 bg-amber-50"}`}>
                  <p className="text-xs font-bold text-brand-navy">{formatCalendarTime(item.slot.starts_at)}–{formatCalendarTime(item.slot.ends_at)}</p>
                  <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{booking ? `${booking.status} · ${CATEGORY_LABELS[booking.booking_type] ?? booking.booking_type}` : item.slot.is_open ? "Open to book" : "Reserved"}</p>
                </article>;
              })}
              {items.length === 0 && <p className="py-6 text-center text-xs text-slate-400">No events</p>}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export default function OwnerCalendarPage() {
  const [view, setView] = useState<CalendarView>("week");
  const [anchor, setAnchor] = useState(() => new Date());
  const range = useMemo(() => calendarRange(anchor, view), [anchor, view]);
  const calendar = useOwnerCalendarRange(range.start, range.end);
  const days = useMemo(() => Array.from({ length: view === "week" ? 7 : 1 }, (_, index) => addCalendarDays(range.start, index)), [range.start, view]);

  function move(direction: number) {
    setAnchor((value) => addCalendarDays(value, direction * (view === "week" ? 7 : 1)));
  }

  return (
    <div className="mx-auto max-w-[1500px] space-y-6 pb-12">
      <header className="overflow-hidden rounded-3xl bg-brand-navy px-5 py-6 text-white shadow-sm sm:px-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand-teal">Owner command centre</p>
            <h1 className="mt-2 text-2xl font-bold sm:text-3xl">Calendar & bookings</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/65">Plan private work, publish availability, convert meetings into tasks and approve role-requested client appointments from one place.</p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <div className="rounded-2xl bg-white/10 px-4 py-3"><p className="text-[10px] uppercase tracking-wide text-white/50">Requests</p><p className="mt-1 text-xl font-bold">{calendar.data?.bookings.filter((item) => item.status === "requested").length ?? 0}</p></div>
            <div className="rounded-2xl bg-white/10 px-4 py-3"><p className="text-[10px] uppercase tracking-wide text-white/50">Open slots</p><p className="mt-1 text-xl font-bold">{calendar.data?.slots.filter((item) => item.is_open).length ?? 0}</p></div>
          </div>
        </div>
      </header>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.65fr)]">
        <section aria-labelledby="agenda-heading" className="min-w-0 space-y-4">
          <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <button type="button" aria-label={`Previous ${view}`} onClick={() => move(-1)} className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-xl border border-slate-200 text-brand-navy hover:bg-slate-50"><ChevronLeft className="h-4 w-4" /></button>
              <button type="button" onClick={() => setAnchor(new Date())} className="min-h-10 rounded-xl border border-slate-200 px-3 text-sm font-bold text-brand-navy hover:bg-slate-50">Today</button>
              <button type="button" aria-label={`Next ${view}`} onClick={() => move(1)} className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-xl border border-slate-200 text-brand-navy hover:bg-slate-50"><ChevronRight className="h-4 w-4" /></button>
              <h2 id="agenda-heading" className="ml-1 text-sm font-bold text-brand-navy sm:text-base">{formatCalendarDay(range.start, true)}{view === "week" ? ` – ${formatCalendarDay(addCalendarDays(range.end, -1), true)}` : ""}</h2>
            </div>
            <div className="grid grid-cols-2 rounded-xl bg-slate-100 p-1" role="group" aria-label="Calendar view">
              {(["day", "week"] as const).map((value) => <button key={value} type="button" aria-pressed={view === value} onClick={() => setView(value)} className={`min-h-9 rounded-lg px-4 text-xs font-bold capitalize ${view === value ? "bg-white text-brand-navy shadow-sm" : "text-slate-500"}`}>{value}</button>)}
            </div>
          </div>

          {calendar.isLoading && <div className="flex min-h-64 items-center justify-center rounded-2xl border border-slate-200 bg-white"><Loader2 className="h-6 w-6 animate-spin text-brand-teal" /><span className="ml-2 text-sm text-slate-500">Loading calendar…</span></div>}
          {calendar.isError && <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-800"><CircleAlert className="mr-2 inline h-4 w-4" />Could not load the Owner calendar. {describeError(calendar.error, "Please refresh.")}</div>}
          {calendar.data && <Agenda days={days} events={calendar.data.events} slots={calendar.data.slots} bookings={calendar.data.bookings} />}
        </section>

        <aside className="space-y-5">
          <EventForm eventsSupported={calendar.data?.eventsSupported ?? true} />
          <AvailabilityForm />
        </aside>
      </div>

      {calendar.data && <BookingInbox bookings={calendar.data.bookings} />}

      <section className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-sm sm:grid-cols-3">
        <div className="flex gap-3"><EyeOff className="mt-0.5 h-5 w-5 shrink-0 text-brand-teal" /><p><strong className="block text-brand-navy">Privacy first</strong>Private titles, client links and notes never leave the Owner view.</p></div>
        <div className="flex gap-3"><UserRound className="mt-0.5 h-5 w-5 shrink-0 text-brand-teal" /><p><strong className="block text-brand-navy">Safe shared schedule</strong>Portal users see availability, “Busy”, or only the public label you approve.</p></div>
        <div className="flex gap-3"><RotateCcw className="mt-0.5 h-5 w-5 shrink-0 text-brand-teal" /><p><strong className="block text-brand-navy">One workflow</strong>Accepted bookings become meetings and linked client confirmations are queued once.</p></div>
      </section>
    </div>
  );
}
