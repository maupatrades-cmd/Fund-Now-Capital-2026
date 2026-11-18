import { useMemo, useState } from "react";
import { Printer } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Field, card, errorText, primaryButton, selectClass, textareaClass } from "@/components/staff/StaffShell";
import { DiaryPrintSheet, type DiaryPrintItem } from "@/components/calendar/DiaryPrintSheet";
import { addDays, sastDay, sastDayLabel, sastIso, sastTime, weekStart } from "@/hooks/useFieldDiary";
import {
  useCancelDiaryEvent, useDiaryCalendars, useDiaryLinkOptions, useDirectorDiaryEvents, useSaveDiaryEvent,
  type DiaryEventInput, type DirectorDiaryEvent,
} from "@/hooks/useDirectorDiary";
import { DELEGATE_EVENT_CATEGORIES, EVENT_CATEGORY_LABELS, type EventCategory } from "@/lib/ownerCalendar";
import type { CalendarVisibility } from "@/lib/ownerCalendar";
import { useSession } from "@/lib/useSession";

// "Director's diary" (owner, 18 Nov 2026): a staff member holding the Director's "Manage my diary" permission fills in
// her diary. The Director's Personal events show only as "Busy" and cannot be changed here; the server enforces it.
const ghostButton = "inline-flex h-11 items-center justify-center rounded-lg border border-border px-4 text-sm font-semibold text-brand-navy hover:bg-slate-50 disabled:opacity-50";
const VISIBILITY_LABEL: Record<CalendarVisibility, string> = { private: "Private", busy: "Shows as Busy", public: "Public label" };

type FormState = {
  title: string; category: EventCategory; day: string; start: string; end: string; visibility: CalendarVisibility;
  publicTitle: string; notes: string; clientId: string; leadId: string; dealId: string;
};
const blankForm = (day: string): FormState => ({
  title: "", category: "meeting", day, start: "09:00", end: "10:00", visibility: "private", publicTitle: "", notes: "",
  clientId: "", leadId: "", dealId: "",
});
const fromEvent = (e: DirectorDiaryEvent): FormState => ({
  title: e.title, category: (e.category ?? "meeting") as EventCategory, day: sastDay(new Date(e.starts_at)),
  start: sastTime(e.starts_at), end: sastTime(e.ends_at), visibility: e.visibility, publicTitle: e.public_title ?? "",
  notes: e.notes ?? "", clientId: e.client_id ?? "", leadId: e.lead_id ?? "", dealId: e.deal_id ?? "",
});

function EventForm({ owner, editing, defaultDay, onDone }: { owner: string; editing: DirectorDiaryEvent | null; defaultDay: string; onDone: () => void }) {
  const save = useSaveDiaryEvent(owner);
  const links = useDiaryLinkOptions(owner);
  const [form, setForm] = useState<FormState>(() => (editing ? fromEvent(editing) : blankForm(defaultDay)));
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));
  const options = links.data ?? [];
  const deals = options.filter((o) => o.kind === "deal" && (!form.clientId || o.client_id === form.clientId));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const input: DiaryEventInput = {
      title: form.title, category: form.category, startsAt: sastIso(form.day, form.start), endsAt: sastIso(form.day, form.end),
      visibility: form.visibility, publicTitle: form.publicTitle, notes: form.notes, clientId: form.clientId,
      leadId: form.leadId, dealId: form.dealId,
    };
    save.mutate({ eventId: editing?.id, input }, {
      onSuccess: () => {
        toast.success(editing ? "Diary event updated" : "Added to the Director's diary");
        setForm(blankForm(form.day));
        onDone();
      },
      onError: (err) => toast.error(errorText(err)),
    });
  };

  return (
    <form onSubmit={submit} className={`${card} grid gap-4 sm:grid-cols-2`}>
      <h2 className="text-base font-bold text-brand-navy sm:col-span-2">{editing ? "Change the event" : "Add an event to the Director's diary"}</h2>
      <div className="sm:col-span-2">
        <Field label="What is it?"><Input required minLength={3} maxLength={160} value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Meeting with Business Partners" /></Field>
      </div>
      <Field label="Type">
        <select className={selectClass} value={form.category} onChange={(e) => set("category", e.target.value as EventCategory)}>
          {DELEGATE_EVENT_CATEGORIES.map((c) => <option key={c} value={c}>{EVENT_CATEGORY_LABELS[c]}</option>)}
        </select>
      </Field>
      <Field label="Day"><Input type="date" required value={form.day} onChange={(e) => set("day", e.target.value)} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Starts"><Input type="time" required step={900} value={form.start} onChange={(e) => set("start", e.target.value)} /></Field>
        <Field label="Ends"><Input type="time" required step={900} value={form.end} onChange={(e) => set("end", e.target.value)} /></Field>
      </div>
      <Field label="Who can see it" hint="Private: only the Director and the people managing her diary. Busy: others see the time as busy.">
        <select className={selectClass} value={form.visibility} onChange={(e) => set("visibility", e.target.value as CalendarVisibility)}>
          {(Object.keys(VISIBILITY_LABEL) as CalendarVisibility[]).map((v) => <option key={v} value={v}>{VISIBILITY_LABEL[v]}</option>)}
        </select>
      </Field>
      {form.visibility === "public" ? (
        <div className="sm:col-span-2">
          <Field label="Public label"><Input required minLength={3} maxLength={120} value={form.publicTitle} onChange={(e) => set("publicTitle", e.target.value)} placeholder="e.g. Client consultation" /></Field>
        </div>
      ) : null}
      <Field label="Client (optional)">
        <select className={selectClass} value={form.clientId} onChange={(e) => setForm((f) => ({ ...f, clientId: e.target.value, dealId: "" }))}>
          <option value="">No client</option>
          {options.filter((o) => o.kind === "client").map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </Field>
      <Field label="Lead (optional)">
        <select className={selectClass} value={form.leadId} onChange={(e) => set("leadId", e.target.value)}>
          <option value="">No lead</option>
          {options.filter((o) => o.kind === "lead").map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </Field>
      <Field label="Deal (optional)">
        <select className={selectClass} value={form.dealId} onChange={(e) => set("dealId", e.target.value)}>
          <option value="">No deal</option>
          {deals.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </Field>
      <div className="sm:col-span-2">
        <Field label="Place / notes (optional)">
          <textarea className={textareaClass} maxLength={4000} value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Where, who is attending, what to bring…" />
        </Field>
      </div>
      <div className="flex gap-2 sm:col-span-2">
        <button type="submit" className={primaryButton} disabled={save.isPending}>{editing ? "Save changes" : "Add to diary"}</button>
        {editing ? <button type="button" className={ghostButton} onClick={onDone}>Stop editing</button> : null}
      </div>
    </form>
  );
}

function EventRow({ e, onEdit }: { e: DirectorDiaryEvent; onEdit: (e: DirectorDiaryEvent) => void }) {
  const cancel = useCancelDiaryEvent();
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  if (e.is_personal) {
    return (
      <li className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3 text-sm">
        <span className="font-bold tabular-nums text-brand-navy">{sastTime(e.starts_at)}–{sastTime(e.ends_at)}</span>
        <span className="ml-3 font-semibold text-slate-500">Busy</span>
      </li>
    );
  }
  const links = [e.client_name, e.lead_name, e.deal_reference].filter(Boolean).join(" · ");
  return (
    <li className={`rounded-xl border border-border p-3 ${e.status === "completed" ? "opacity-70" : ""}`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-bold tabular-nums text-brand-navy">{sastTime(e.starts_at)}–{sastTime(e.ends_at)}</span>
        <span className="font-semibold">{e.title}</span>
        {e.category ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-brand-navy">{EVENT_CATEGORY_LABELS[e.category] ?? e.category}</span> : null}
        {e.is_booking ? <span className="text-xs font-semibold text-muted-foreground">Booking</span> : null}
        {e.status === "completed" ? <span className="text-xs font-semibold text-muted-foreground">Done</span> : null}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {[links || null, VISIBILITY_LABEL[e.visibility], e.created_by_name ? `Added by ${e.created_by_name}` : null].filter(Boolean).join(" · ")}
      </p>
      {e.notes ? <p className="mt-1 whitespace-pre-line text-xs text-slate-600">{e.notes}</p> : null}
      {e.can_change ? (
        cancelling ? (
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <Input aria-label="Why is it cancelled?" placeholder="Why is it cancelled?" maxLength={300} value={reason} onChange={(ev) => setReason(ev.target.value)} />
            <button type="button" className={primaryButton} disabled={cancel.isPending || reason.trim().length < 3}
              onClick={() => cancel.mutate({ eventId: e.id, reason }, {
                onSuccess: () => { toast.success("Event cancelled"); setCancelling(false); setReason(""); },
                onError: (err) => toast.error(errorText(err)),
              })}>Cancel event</button>
            <button type="button" className={ghostButton} onClick={() => setCancelling(false)}>Keep it</button>
          </div>
        ) : (
          <div className="mt-2 flex gap-2">
            <button type="button" className={ghostButton} onClick={() => onEdit(e)}>Change</button>
            <button type="button" className={ghostButton} onClick={() => setCancelling(true)}>Cancel…</button>
          </div>
        )
      ) : null}
    </li>
  );
}

export default function StaffDirectorDiaryPage() {
  const calendars = useDiaryCalendars();
  const owner = calendars.data?.[0]?.calendar_owner_id ?? null;
  const ownerName = calendars.data?.[0]?.calendar_owner_name ?? "the Director";
  const [view, setView] = useState<"day" | "week">("day");
  const [day, setDay] = useState(sastDay());
  const [editing, setEditing] = useState<DirectorDiaryEvent | null>(null);
  const session = useSession();
  const printedBy = (session?.user?.user_metadata?.full_name as string | undefined) || session?.user?.email || "staff";

  const from = view === "day" ? day : weekStart(day);
  const to = view === "day" ? day : addDays(from, 6);
  const range = useMemo(() => ({ start: new Date(sastIso(from, "00:00")), end: new Date(sastIso(addDays(to, 1), "00:00")) }), [from, to]);
  const events = useDirectorDiaryEvents(owner, range.start, range.end);

  const byDay = useMemo(() => {
    const days = view === "day" ? [from] : Array.from({ length: 7 }, (_, i) => addDays(from, i));
    return days.map((d) => ({ day: d, items: (events.data ?? []).filter((e) => sastDay(new Date(e.starts_at)) === d) }));
  }, [events.data, from, view]);

  // The printout never carries a Personal event's details: it prints as "Busy" (the server sends nothing more).
  const printItems: DiaryPrintItem[] = (events.data ?? []).map((e) => e.is_personal
    ? { id: e.id, startsAt: e.starts_at, endsAt: e.ends_at, type: "—", title: "Busy" }
    : {
      id: e.id, startsAt: e.starts_at, endsAt: e.ends_at, type: e.category ? EVENT_CATEGORY_LABELS[e.category] ?? e.category : "—",
      title: e.title, link: [e.client_name, e.lead_name, e.deal_reference].filter(Boolean).join(" · ") || null, notes: e.notes,
    });
  const heading = view === "day" ? sastDayLabel(day) : `${sastDayLabel(from)} to ${sastDayLabel(to)}`;

  if (calendars.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (calendars.isError) return <p className="text-sm text-red-700">{errorText(calendars.error)}</p>;
  if (!owner) {
    return <p className="text-sm text-muted-foreground">The Director has not given you "Manage my diary". She can switch it on under Calendar → Staff calendar access.</p>;
  }

  const step = view === "day" ? 1 : 7;
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-brand-navy">Director&apos;s diary</h1>
        <p className="text-sm text-muted-foreground">You fill in {ownerName}&apos;s diary for her. She is told about every change. Her personal time shows only as "Busy". Times are South African time.</p>
      </div>

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
          <button type="button" className={`${ghostButton} ml-auto gap-2`} onClick={() => window.print()} disabled={!events.data}>
            <Printer className="h-4 w-4" aria-hidden="true" /> Print / Save as PDF
          </button>
        </div>
        <p className="text-sm font-semibold text-brand-navy">{heading}</p>
        {events.isError ? <p className="text-sm text-red-700">{errorText(events.error)}</p> : null}
        {events.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
        <div className="space-y-4">
          {byDay.map(({ day: d, items }) => (
            <div key={d} className="space-y-2">
              {view === "week" ? <h3 className="text-sm font-bold text-brand-navy">{sastDayLabel(d)}</h3> : null}
              {items.length ? <ul className="space-y-2">{items.map((e) => <EventRow key={e.id} e={e} onEdit={setEditing} />)}</ul>
                : <p className="text-sm text-muted-foreground">Nothing in the diary.</p>}
            </div>
          ))}
        </div>
      </section>

      <EventForm key={editing?.id ?? "new"} owner={owner} editing={editing} defaultDay={day} onDone={() => setEditing(null)} />
      {events.data ? <DiaryPrintSheet heading={heading} items={printItems} printedBy={printedBy} /> : null}
    </div>
  );
}
