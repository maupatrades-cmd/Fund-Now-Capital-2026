import { useMemo, useState, type FormEvent } from "react";
import {
  AlertCircle,
  CalendarCheck2,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Loader2,
  LockKeyhole,
  RefreshCw,
  UsersRound,
} from "lucide-react";
import { toast } from "sonner";
import {
  BOOKING_TYPE_LABEL,
  REQUESTED_BOOKING_TYPES,
  useBookingPortalWorkspace,
  useRequestOwnerBooking,
  type BookableReference,
  type BookingSlot,
  type RequestedBookingType,
} from "@/hooks/useBookingPortal";
import { cn } from "@/lib/utils";

type CalendarTone = "client" | "portal";

type SharedBookingCalendarProps = {
  tone?: CalendarTone;
  clientId?: string | null;
  clientName?: string | null;
};

const SAST_TIME_ZONE = "Africa/Johannesburg";

const statusLabel: Record<string, string> = {
  requested: "Awaiting Owner",
  confirmed: "Confirmed",
  declined: "Declined",
  cancelled: "Cancelled",
  completed: "Completed",
};

const statusClass: Record<string, string> = {
  requested: "border-amber-400/35 bg-amber-400/10 text-amber-600",
  confirmed: "border-emerald-500/35 bg-emerald-500/10 text-emerald-600",
  declined: "border-red-400/35 bg-red-400/10 text-red-600",
  cancelled: "border-slate-400/35 bg-slate-400/10 text-slate-500",
  completed: "border-sky-500/35 bg-sky-500/10 text-sky-600",
};

const dayFormatter = new Intl.DateTimeFormat("en-ZA", {
  timeZone: SAST_TIME_ZONE,
  weekday: "short",
  day: "2-digit",
  month: "short",
});

const longDateFormatter = new Intl.DateTimeFormat("en-ZA", {
  timeZone: SAST_TIME_ZONE,
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

const timeFormatter = new Intl.DateTimeFormat("en-ZA", {
  timeZone: SAST_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function formatTimeRange(startsAt: string, endsAt: string) {
  return `${timeFormatter.format(new Date(startsAt))}–${timeFormatter.format(new Date(endsAt))}`;
}

function supportedTypes(slot: BookingSlot): RequestedBookingType[] {
  const allowed = new Set(slot.allowed_booking_types);
  return REQUESTED_BOOKING_TYPES.filter((type) => allowed.has(type));
}

function referenceKey(reference: BookableReference) {
  return `${reference.reference_kind}:${reference.reference_id}`;
}

export default function SharedBookingCalendar({
  tone = "portal",
  clientId = null,
  clientName = null,
}: SharedBookingCalendarProps) {
  const workspace = useBookingPortalWorkspace();
  const requestBooking = useRequestOwnerBooking();
  const [slotId, setSlotId] = useState("");
  const [bookingType, setBookingType] = useState<RequestedBookingType>("consultation");
  const [referenceValue, setReferenceValue] = useState("");
  const [agenda, setAgenda] = useState("");
  const dark = tone === "client";

  const selectedSlot = useMemo(
    () => workspace.data?.open_slots.find((slot) => slot.id === slotId) ?? null,
    [slotId, workspace.data?.open_slots],
  );
  const availableTypes = selectedSlot ? supportedTypes(selectedSlot) : [];
  const selectedReference = useMemo(
    () => workspace.data?.bookable_references.find((row) => referenceKey(row) === referenceValue) ?? null,
    [referenceValue, workspace.data?.bookable_references],
  );
  const clientMode = tone === "client";
  const needsReference = !clientMode;
  const clientReady = !clientMode || Boolean(clientId);
  const canSubmit =
    Boolean(selectedSlot) &&
    availableTypes.includes(bookingType) &&
    agenda.trim().length >= 3 &&
    clientReady &&
    (!needsReference || Boolean(selectedReference));

  function chooseSlot(slot: BookingSlot) {
    setSlotId(slot.id);
    const nextTypes = supportedTypes(slot);
    setBookingType(nextTypes.includes(bookingType) ? bookingType : (nextTypes[0] ?? "consultation"));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedSlot || !canSubmit) return;

    requestBooking.mutate(
      {
        slotId: selectedSlot.id,
        bookingType,
        agenda,
        reference: selectedReference,
        clientId,
      },
      {
        onSuccess: () => {
          setSlotId("");
          setAgenda("");
          toast.success("Booking request sent to the Owner.");
        },
        onError: (error) => {
          toast.error(error instanceof Error ? error.message : "The booking request could not be sent.");
        },
      },
    );
  }

  if (workspace.isLoading) {
    return (
      <div className={cn("grid min-h-56 place-items-center rounded-3xl border p-6", dark ? "border-white/10 bg-white/5" : "border-slate-200 bg-white")}>
        <p className={cn("inline-flex items-center gap-2 text-sm", dark ? "text-white/55" : "text-slate-500")}>
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading the Owner’s availability…
        </p>
      </div>
    );
  }

  if (workspace.isError) {
    return (
      <div role="alert" className={cn("rounded-3xl border p-6", dark ? "border-red-300/20 bg-red-300/10 text-red-100" : "border-red-200 bg-red-50 text-red-800")}>
        <div className="flex items-start gap-3">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <div>
            <h2 className="font-bold">The booking calendar could not be loaded.</h2>
            <p className={cn("mt-1 text-sm", dark ? "text-red-100/70" : "text-red-700")}>
              Refresh the calendar. If the problem continues, Fund Now Capital support can help without asking you to share private information.
            </p>
            <button type="button" onClick={() => void workspace.refetch()} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl border border-current px-4 text-sm font-bold">
              <RefreshCw className="h-4 w-4" aria-hidden="true" /> Try again
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!workspace.data) {
    return (
      <div role="status" className={cn("rounded-3xl border p-6 text-sm", dark ? "border-white/10 bg-white/5 text-white/55" : "border-slate-200 bg-white text-slate-500") }>
        The booking calendar is preparing your workspace. Please refresh if it does not appear shortly.
      </div>
    );
  }

  const data = workspace.data;

  return (
    <div className="space-y-6">
      <section className={cn("overflow-hidden rounded-3xl border p-5 sm:p-7", dark ? "client-glass border-white/10" : "border-slate-200 bg-white shadow-sm")}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className={cn("text-[10px] font-extrabold uppercase tracking-[0.2em]", dark ? "text-[#86d4cf]" : "text-brand-teal")}>
              Owner consultation calendar
            </p>
            <h1 className={cn("mt-2 text-2xl font-extrabold tracking-tight sm:text-3xl", dark ? "text-white" : "text-brand-navy")}>
              Choose a time that works
            </h1>
            <p className={cn("mt-2 max-w-2xl text-sm leading-6", dark ? "text-white/50" : "text-slate-500")}>
              Consultation windows run from 14:00 to 20:00 South Africa time. The appointment is confirmed only after the Owner accepts it.
            </p>
          </div>
          <span className={cn("inline-flex w-fit items-center gap-2 rounded-full border px-3 py-2 text-xs font-bold", dark ? "border-white/10 bg-white/5 text-white/65" : "border-slate-200 bg-slate-50 text-slate-600")}>
            <LockKeyhole className="h-3.5 w-3.5" aria-hidden="true" /> Privacy-safe schedule
          </span>
        </div>

        <div className="mt-6">
          <h2 className={cn("text-sm font-extrabold", dark ? "text-white" : "text-brand-navy")}>Available times</h2>
          {data.open_slots.length === 0 ? (
            <p className={cn("mt-3 rounded-2xl border border-dashed p-5 text-sm", dark ? "border-white/12 text-white/45" : "border-slate-200 text-slate-500")}>
              No appointment times are open in the next 30 days. Please check again soon.
            </p>
          ) : (
            <div role="radiogroup" aria-label="Available appointment times" className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {data.open_slots.map((slot) => {
                const selected = slot.id === slotId;
                const types = supportedTypes(slot);
                return (
                  <button
                    key={slot.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    disabled={types.length === 0}
                    onClick={() => chooseSlot(slot)}
                    className={cn(
                      "min-h-28 rounded-2xl border p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal disabled:cursor-not-allowed disabled:opacity-45",
                      dark
                        ? selected ? "border-[#6ec144]/55 bg-[#6ec144]/12" : "border-white/10 bg-white/[0.035] hover:border-white/20"
                        : selected ? "border-brand-teal bg-teal-50 shadow-sm" : "border-slate-200 bg-slate-50 hover:border-brand-teal/40 hover:bg-white",
                    )}
                  >
                    <span className={cn("text-[11px] font-extrabold uppercase tracking-[0.14em]", dark ? "text-[#86d4cf]" : "text-brand-teal")}>
                      {dayFormatter.format(new Date(slot.starts_at))}
                    </span>
                    <span className={cn("mt-2 block text-xl font-extrabold", dark ? "text-white" : "text-brand-navy")}>
                      {formatTimeRange(slot.starts_at, slot.ends_at)}
                    </span>
                    <span className={cn("mt-2 block text-xs", dark ? "text-white/40" : "text-slate-500")}>
                      {types.length > 0 ? types.map((type) => BOOKING_TYPE_LABEL[type]).join(" · ") : "Not bookable for these categories"}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {data.schedule_blocks.length > 0 ? (
          <div className="mt-6 border-t border-current/10 pt-5">
            <h2 className={cn("flex items-center gap-2 text-sm font-extrabold", dark ? "text-white" : "text-brand-navy")}>
              <Clock3 className="h-4 w-4" aria-hidden="true" /> Owner schedule
            </h2>
            <p className={cn("mt-1 text-xs", dark ? "text-white/40" : "text-slate-500")}>
              Only availability and Owner-approved public labels are shown. Private client names and notes stay hidden.
            </p>
            <div className="mt-3 flex gap-3 overflow-x-auto pb-2">
              {data.schedule_blocks.map((block) => (
                <article key={block.id} className={cn("min-w-52 rounded-2xl border p-4", dark ? "border-white/9 bg-white/[0.03]" : "border-slate-200 bg-slate-50")}>
                  <p className={cn("text-xs font-bold", dark ? "text-white/45" : "text-slate-500")}>
                    {dayFormatter.format(new Date(block.starts_at))} · {formatTimeRange(block.starts_at, block.ends_at)}
                  </p>
                  <p className={cn("mt-2 text-sm font-extrabold", dark ? "text-white/75" : "text-brand-navy")}>
                    {block.display_title || "Busy"}
                  </p>
                </article>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      <form onSubmit={submit} className={cn("rounded-3xl border p-5 sm:p-7", dark ? "client-glass border-white/10" : "border-slate-200 bg-white shadow-sm")}>
        <div className="flex items-start gap-3">
          <span className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-2xl", dark ? "bg-[#6ec144]/15 text-[#9ee67d]" : "bg-teal-50 text-brand-teal")}>
            <CalendarClock className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h2 className={cn("text-lg font-extrabold", dark ? "text-white" : "text-brand-navy")}>Request this appointment</h2>
            <p className={cn("mt-1 text-sm", dark ? "text-white/45" : "text-slate-500")}>
              Choose a client or lead, select the reason and add a short preparation note.
            </p>
          </div>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <label className={cn("space-y-2 text-xs font-bold", dark ? "text-white/65" : "text-slate-700")}>
            Selected time
            <input
              readOnly
              value={selectedSlot ? `${longDateFormatter.format(new Date(selectedSlot.starts_at))}, ${formatTimeRange(selectedSlot.starts_at, selectedSlot.ends_at)}` : "Choose an available time above"}
              className={cn("min-h-11 w-full rounded-xl border px-3 text-sm outline-none", dark ? "border-white/12 bg-white/5 text-white" : "border-slate-200 bg-slate-50 text-slate-700")}
            />
          </label>

          <label className={cn("space-y-2 text-xs font-bold", dark ? "text-white/65" : "text-slate-700")}>
            Reason for meeting
            <select
              value={bookingType}
              disabled={!selectedSlot}
              onChange={(event) => setBookingType(event.target.value as RequestedBookingType)}
              className={cn("min-h-11 w-full rounded-xl border px-3 text-sm outline-none focus:ring-2 focus:ring-brand-teal", dark ? "border-white/12 bg-[#0a1d2a] text-white" : "border-slate-200 bg-white text-slate-800")}
            >
              {REQUESTED_BOOKING_TYPES.map((type) => (
                <option key={type} value={type} disabled={!availableTypes.includes(type)}>
                  {BOOKING_TYPE_LABEL[type]}{selectedSlot && !availableTypes.includes(type) ? " — unavailable for this time" : ""}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-4">
          {clientMode ? (
            <div className={cn("rounded-xl border px-4 py-3", dark ? "border-white/12 bg-white/5" : "border-slate-200 bg-slate-50")}>
              <p className={cn("text-[10px] font-extrabold uppercase tracking-[0.15em]", dark ? "text-white/35" : "text-slate-500")}>Client</p>
              <p className={cn("mt-1 text-sm font-bold", dark ? "text-white" : "text-brand-navy")}>
                {clientId ? clientName ?? "Your business" : "Linking your client account…"}
              </p>
            </div>
          ) : (
            <label className={cn("block space-y-2 text-xs font-bold", dark ? "text-white/65" : "text-slate-700")}>
              Client or lead
              <select
                value={referenceValue}
                onChange={(event) => setReferenceValue(event.target.value)}
                required
                className={cn("min-h-11 w-full rounded-xl border px-3 text-sm outline-none focus:ring-2 focus:ring-brand-teal", dark ? "border-white/12 bg-[#0a1d2a] text-white" : "border-slate-200 bg-white text-slate-800")}
              >
                <option value="">Select a client or lead</option>
                {data.bookable_references.map((reference) => (
                  <option key={referenceKey(reference)} value={referenceKey(reference)}>
                    {reference.display_name} · {reference.reference_kind === "client" ? "Client" : "Lead"}
                  </option>
                ))}
              </select>
              {data.bookable_references.length === 0 ? (
                <span className={cn("block font-normal", dark ? "text-white/35" : "text-slate-500")}>
                  No attributed client or lead is available yet. Submit or receive an attributed lead before requesting a meeting.
                </span>
              ) : null}
            </label>
          )}
        </div>

        <label className={cn("mt-4 block space-y-2 text-xs font-bold", dark ? "text-white/65" : "text-slate-700")}>
          Brief reason and what the Owner should prepare
          <textarea
            value={agenda}
            onChange={(event) => setAgenda(event.target.value)}
            minLength={3}
            maxLength={1000}
            rows={4}
            required
            placeholder="For example: review the purchase order paperwork before funder submission"
            className={cn("w-full resize-y rounded-xl border px-3 py-3 text-sm outline-none placeholder:opacity-45 focus:ring-2 focus:ring-brand-teal", dark ? "border-white/12 bg-white/5 text-white" : "border-slate-200 bg-white text-slate-800")}
          />
          <span className={cn("block text-right font-normal", dark ? "text-white/30" : "text-slate-400")}>{agenda.length}/1000</span>
        </label>

        <button
          type="submit"
          disabled={!canSubmit || requestBooking.isPending}
          className={cn(
            "mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-5 text-sm font-extrabold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-45 sm:w-auto",
            dark ? "bg-gradient-to-r from-[#6ec144] to-[#2ca8a8] text-[#06131d] focus-visible:ring-[#7fd4e8]" : "bg-brand-navy text-white hover:bg-brand-navy/90 focus-visible:ring-brand-teal",
          )}
        >
          {requestBooking.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <CalendarCheck2 className="h-4 w-4" aria-hidden="true" />}
          Send booking request
        </button>
      </form>

      <section className={cn("rounded-3xl border p-5 sm:p-7", dark ? "client-glass border-white/10" : "border-slate-200 bg-white shadow-sm")}>
        <div className="flex items-center gap-3">
          <UsersRound className={cn("h-5 w-5", dark ? "text-[#7fd4e8]" : "text-brand-teal")} aria-hidden="true" />
          <div>
            <h2 className={cn("font-extrabold", dark ? "text-white" : "text-brand-navy")}>Your booking requests</h2>
            <p className={cn("text-xs", dark ? "text-white/40" : "text-slate-500")}>Pending is not confirmed. You’ll receive the confirmed appointment after Owner approval.</p>
          </div>
        </div>

        {data.my_bookings.length === 0 ? (
          <p className={cn("mt-5 rounded-2xl border border-dashed p-5 text-sm", dark ? "border-white/12 text-white/40" : "border-slate-200 text-slate-500")}>No booking requests yet.</p>
        ) : (
          <div className="mt-5 space-y-3">
            {data.my_bookings.map((booking) => (
              <article key={booking.id} className={cn("rounded-2xl border p-4", dark ? "border-white/9 bg-white/[0.035]" : "border-slate-200 bg-slate-50")}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className={cn("text-sm font-extrabold", dark ? "text-white" : "text-brand-navy")}>
                      {BOOKING_TYPE_LABEL[booking.booking_type as RequestedBookingType] ?? booking.booking_type.replaceAll("_", " ")}
                    </p>
                    <p className={cn("mt-1 text-xs", dark ? "text-white/45" : "text-slate-500")}>
                      {longDateFormatter.format(new Date(booking.starts_at))} · {formatTimeRange(booking.starts_at, booking.ends_at)} SAST
                    </p>
                  </div>
                  <span className={cn("rounded-full border px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[0.1em]", statusClass[booking.status] ?? statusClass.requested)}>
                    {statusLabel[booking.status] ?? booking.status}
                  </span>
                </div>
                <p className={cn("mt-3 text-sm leading-6", dark ? "text-white/55" : "text-slate-600")}>{booking.agenda}</p>
                {booking.owner_note ? (
                  <p className={cn("mt-3 rounded-xl p-3 text-xs leading-5", dark ? "bg-white/5 text-white/60" : "bg-white text-slate-600")}>
                    <span className="font-bold">Owner response:</span> {booking.owner_note}
                  </p>
                ) : null}
                {booking.status === "confirmed" ? (
                  <p className={cn("mt-3 inline-flex items-center gap-2 text-xs font-bold", dark ? "text-[#9ee67d]" : "text-emerald-700")}>
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Appointment confirmed
                  </p>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
