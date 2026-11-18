import { Link } from "react-router-dom";
import { card, errorText } from "@/components/staff/StaffShell";
import { sastDay, sastTime, useFieldMeetings } from "@/hooks/useFieldDiary";

// My day for the field roles: today's booked meetings on the person's own diary.
export function TodaysMeetingsPanel() {
  const today = sastDay();
  const meetings = useFieldMeetings(null, today, today);
  const items = meetings.data ?? [];
  return (
    <section className={`${card} space-y-3`}>
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-brand-navy">Today's meetings</h2>
        <Link className="text-sm font-semibold text-brand-teal underline" to="/staff/my-diary">Open my diary</Link>
      </div>
      {meetings.error ? <p role="alert" className="text-sm text-red-600">{errorText(meetings.error)}</p> : null}
      {meetings.isSuccess && items.length === 0 ? <p className="text-sm text-muted-foreground">No meetings booked for today.</p> : null}
      <ul className="space-y-2">
        {items.map((m) => (
          <li key={m.id} className="flex flex-wrap items-baseline gap-x-3 text-sm">
            <span className="font-bold tabular-nums text-brand-navy">{sastTime(m.starts_at)}–{sastTime(m.ends_at)}</span>
            <span className="font-semibold">{m.title}</span>
            {m.location ? <span className="text-xs text-muted-foreground">{m.location}</span> : null}
            {m.status === "done" ? <span className="text-xs font-semibold text-muted-foreground">Done</span> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
