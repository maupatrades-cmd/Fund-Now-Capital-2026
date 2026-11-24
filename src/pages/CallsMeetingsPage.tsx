import { useMemo, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { CalendarPlus, PhoneIncoming, PhoneMissed, PhoneOutgoing, Search, Video } from "lucide-react";
import { MeetCallButton } from "@/components/meet/MeetCallButton";
import { useMeet } from "@/components/meet/meetContext";
import { useProfileRole } from "@/hooks/useProfileRole";
import { useCreateMeeting, useEndMeeting, useMeetMine, useMeetPeople, type MeetMeetingRow } from "@/hooks/useMeet";
import { MEETING_CAP, formatDuration } from "@/lib/meet/signal";

// "Calls & meetings" (owner, 24 Nov 2026): call anyone you may contact in the CRM, see who is online, and run small
// Teams-style meetings (up to 8 people, video, screen share). The same page sits in the owner app, the staff app and the
// agent portals; the database decides who each person may see and call (meet_can_contact).

const ROLE_LABEL: Record<string, string> = {
  owner: "Director", administrator: "Office Administrator", coordinator: "Sales Coordinator", switchboard: "Switchboard",
  hr: "HR", field_supervisor: "Field Supervisor", field_consultant: "Field consultant", partner: "Team Leader",
  contractor: "Direct agent", lead_referrer: "Sub-agent",
};
const card = "rounded-2xl border border-slate-200 bg-white p-4 shadow-sm";
const sast = (iso: string) => new Date(iso).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg", dateStyle: "medium", timeStyle: "short" });

function MeetingRow({ m, onJoin }: { m: MeetMeetingRow; onJoin: () => void }) {
  const end = useEndMeeting();
  const live = m.status === "live" || m.status === "scheduled";
  const inRoom = (m.participants ?? []).filter((p) => p.in_room).length;
  return (
    <li className="flex flex-wrap items-center gap-3 border-b border-slate-100 py-3 last:border-0">
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-brand-navy">{m.title}</p>
        <p className="text-xs text-slate-500">
          {m.instant ? "Started" : "Starts"} {sast(m.starts_at)} · {m.duration_minutes} min · host {m.is_host ? "you" : m.host_name}
          {m.status === "live" && inRoom > 0 ? ` · ${inRoom} in the room` : ""}
          {m.status === "ended" ? " · ended" : m.status === "cancelled" ? " · cancelled" : ""}
        </p>
        <p className="text-xs text-slate-400">{(m.participants ?? []).map((p) => p.name).join(", ")}</p>
      </div>
      {live ? (
        <button type="button" onClick={onJoin} className="inline-flex items-center gap-1 rounded-xl bg-brand-teal px-4 py-2 text-sm font-semibold text-white">
          <Video className="h-4 w-4" aria-hidden="true" /> Join
        </button>
      ) : null}
      {live && m.is_host ? (
        <button type="button" disabled={end.isPending}
          onClick={() => { if (window.confirm(m.status === "scheduled" ? "Cancel this meeting?" : "End this meeting for everyone?")) end.mutate(m.id, { onError: (e) => toast.error(e instanceof Error ? e.message : "Could not end it") }); }}
          className="rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-600">{m.status === "scheduled" ? "Cancel" : "End"}</button>
      ) : null}
    </li>
  );
}

export default function CallsMeetingsPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { enabled, online } = useMeet();
  const [query, setQuery] = useState("");
  const people = useMeetPeople(query);
  const mine = useMeetMine();
  const create = useCreateMeeting();
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState("");
  const [duration, setDuration] = useState(30);
  const [invitees, setInvitees] = useState<string[]>([]);

  const { data: role } = useProfileRole();
  // Agents join meetings they are invited to; only staff and the Director host (the database enforces it too).
  const canHost = Boolean(role) && !["partner", "contractor", "lead_referrer"].includes(role as string);
  const highlighted = params.get("meeting");
  const room = (id: string) => navigate(`/meeting/${id}`);
  const sortedPeople = useMemo(
    () => [...(people.data ?? [])].sort((a, b) => Number(online.has(b.profile_id)) - Number(online.has(a.profile_id))),
    [people.data, online],
  );

  const submit = async (e: FormEvent, instant: boolean) => {
    e.preventDefault();
    if (invitees.length === 0) return toast.error("Choose who to invite");
    if (invitees.length > MEETING_CAP - 1) return toast.error(`A meeting holds up to ${MEETING_CAP} people (you and ${MEETING_CAP - 1} others)`);
    try {
      const id = await create.mutateAsync({
        title: title.trim() || (instant ? "Quick meeting" : ""), startsAt: instant ? null : (when ? new Date(when).toISOString() : null),
        durationMinutes: duration, invitees, instant,
      });
      setShowForm(false); setTitle(""); setWhen(""); setInvitees([]);
      if (instant) room(id); else toast.success("Meeting created — everyone invited has been told");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create the meeting");
    }
  };

  if (!enabled) {
    return <div className="p-6"><div className={card}>Calls and meetings are not available for your account.</div></div>;
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-brand-navy">Calls &amp; meetings</h1>
          <p className="text-sm text-slate-500">Call or meet people at Fund Now Capital straight from the CRM. Nothing is recorded.</p>
        </div>
        {canHost ? <button type="button" onClick={() => setShowForm((v) => !v)}
          className="inline-flex items-center gap-2 rounded-xl bg-brand-navy px-4 py-2 text-sm font-semibold text-white">
          <CalendarPlus className="h-4 w-4" aria-hidden="true" /> New meeting
        </button> : null}
      </div>

      {showForm && canHost ? (
        <form className={`${card} space-y-3`} onSubmit={(e) => void submit(e, false)}>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-sm sm:col-span-3">Title
              <input className="mt-1 h-10 w-full rounded-lg border px-3" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Monday sales huddle" />
            </label>
            <label className="text-sm sm:col-span-2">Date and time
              <input type="datetime-local" className="mt-1 h-10 w-full rounded-lg border px-3" value={when} onChange={(e) => setWhen(e.target.value)} />
            </label>
            <label className="text-sm">Minutes
              <input type="number" min={5} max={480} step={5} className="mt-1 h-10 w-full rounded-lg border px-3" value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
            </label>
          </div>
          <fieldset>
            <legend className="text-sm font-semibold text-brand-navy">Invite ({invitees.length}/{MEETING_CAP - 1})</legend>
            <div className="mt-2 grid max-h-56 gap-1 overflow-y-auto sm:grid-cols-2">
              {(people.data ?? []).map((p) => (
                <label key={p.profile_id} className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-slate-50">
                  <input type="checkbox" checked={invitees.includes(p.profile_id)}
                    onChange={(e) => setInvitees((list) => e.target.checked ? [...list, p.profile_id] : list.filter((x) => x !== p.profile_id))} />
                  <span className="truncate">{p.name}</span>
                  <span className="ml-auto text-xs text-slate-400">{ROLE_LABEL[p.role] ?? p.role}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={create.isPending || !when || title.trim().length < 2}
              className="rounded-xl bg-brand-teal px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Schedule and invite</button>
            <button type="button" disabled={create.isPending} onClick={(e) => void submit(e as unknown as FormEvent, true)}
              className="rounded-xl bg-[#5dba5d] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Meet now</button>
            <p className="self-center text-xs text-slate-500">Only Fund Now Capital staff and the Director can start meetings.</p>
          </div>
        </form>
      ) : null}

      <section className={card} aria-labelledby="meetings-h">
        <h2 id="meetings-h" className="font-semibold text-brand-navy">Meetings</h2>
        {mine.isLoading ? <p className="text-sm text-slate-500">Loading…</p> : null}
        <ul>
          {(mine.data?.meetings ?? []).map((m) => (
            <div key={m.id} className={highlighted === m.id ? "rounded-lg bg-brand-teal/5" : ""}>
              <MeetingRow m={m} onJoin={() => room(m.id)} />
            </div>
          ))}
        </ul>
        {mine.data && mine.data.meetings.length === 0 ? <p className="text-sm text-slate-500">No meetings yet.</p> : null}
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className={card} aria-labelledby="people-h">
          <h2 id="people-h" className="font-semibold text-brand-navy">People</h2>
          <label className="mt-2 flex items-center gap-2 rounded-lg border px-3">
            <Search className="h-4 w-4 text-slate-400" aria-hidden="true" />
            <input className="h-10 flex-1 outline-none" placeholder="Search by name" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search people" />
          </label>
          <ul className="mt-2 divide-y divide-slate-100">
            {sortedPeople.map((p) => (
              <li key={p.profile_id} className="flex items-center gap-2 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-brand-navy">{p.name}</p>
                  <p className="text-xs text-slate-400">{ROLE_LABEL[p.role] ?? p.role}{online.has(p.profile_id) ? " · online" : ""}</p>
                </div>
                <MeetCallButton profileId={p.profile_id} name={p.name} />
              </li>
            ))}
          </ul>
          {people.data && people.data.length === 0 ? <p className="text-sm text-slate-500">No one found.</p> : null}
          <p className="mt-2 text-xs text-slate-400">They need to be logged into the CRM to hear the call ring. If they are offline they see a missed call.</p>
        </section>

        <section className={card} aria-labelledby="calls-h">
          <h2 id="calls-h" className="font-semibold text-brand-navy">Recent calls</h2>
          <ul className="mt-2 divide-y divide-slate-100">
            {(mine.data?.calls ?? []).map((c) => (
              <li key={c.id} className="flex items-center gap-2 py-2 text-sm">
                {c.status === "missed" || c.status === "declined"
                  ? <PhoneMissed className="h-4 w-4 text-red-500" aria-hidden="true" />
                  : c.outgoing ? <PhoneOutgoing className="h-4 w-4 text-slate-400" aria-hidden="true" />
                    : <PhoneIncoming className="h-4 w-4 text-slate-400" aria-hidden="true" />}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-brand-navy">{c.other_name}</p>
                  <p className="text-xs text-slate-400">
                    {sast(c.started_at)} · {c.status === "ended" ? formatDuration(c.duration_seconds) : c.status}{c.video ? " · video" : ""}
                  </p>
                </div>
                <MeetCallButton profileId={c.other_id} name={c.other_name} compact />
              </li>
            ))}
          </ul>
          {mine.data && mine.data.calls.length === 0 ? <p className="text-sm text-slate-500">No calls yet.</p> : null}
        </section>
      </div>
    </div>
  );
}
