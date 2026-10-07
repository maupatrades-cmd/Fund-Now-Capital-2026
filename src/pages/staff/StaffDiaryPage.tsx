import { Link } from "react-router-dom";
import { card, errorText } from "@/components/staff/StaffShell";
import { useStaffDiary } from "@/hooks/useStaffDesk";

const fmt = (iso: string) => new Date(iso).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg", dateStyle: "medium", timeStyle: "short" });

// Batch 2 diary: what is due today (tasks, callbacks) and handovers waiting for
// acknowledgement. Calendar bookings and the Founder diary arrive in Batch 3.
export default function StaffDiaryPage() {
  const diary = useStaffDiary();
  const d = diary.data;
  return (
    <>
      <div>
        <h1 className="text-2xl font-bold text-brand-navy">Diary</h1>
        <p className="text-sm text-muted-foreground">Today and anything overdue.</p>
      </div>
      {diary.isLoading ? <p className="text-sm text-muted-foreground">Loading...</p> : null}
      {diary.error ? <p role="alert" className="text-sm text-red-600">{errorText(diary.error)}</p> : null}
      {d ? (
        <>
          {d.unacknowledged_handovers > 0 ? (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
              {d.unacknowledged_handovers} handover{d.unacknowledged_handovers === 1 ? "" : "s"} waiting for you. <Link to="/staff" className="font-semibold underline">Open the call log</Link>.
            </div>
          ) : null}
          <section className={card}>
            <h2 className="mb-2 text-base font-bold text-brand-navy">Callbacks due</h2>
            <ul className="divide-y divide-border text-sm">
              {d.callbacks_due.map((c) => (
                <li key={c.id} className="py-2">
                  <span className="font-semibold text-brand-navy">{c.caller_name}</span> {c.caller_phone ?? ""}
                  <span className="ml-2 text-xs text-muted-foreground">{fmt(c.due_at)}</span>
                </li>
              ))}
              {d.callbacks_due.length === 0 ? <li className="py-2 text-muted-foreground">No callbacks due.</li> : null}
            </ul>
          </section>
          <section className={card}>
            <h2 className="mb-2 text-base font-bold text-brand-navy">Tasks due</h2>
            <ul className="divide-y divide-border text-sm">
              {d.tasks_due.map((t) => (
                <li key={t.id} className="py-2">
                  <span className="font-semibold text-brand-navy">{t.title}</span>
                  <span className={`ml-2 text-xs ${t.overdue ? "text-red-600" : "text-muted-foreground"}`}>{t.overdue ? "overdue · " : ""}{fmt(t.due_at)} · with {t.route_to}</span>
                </li>
              ))}
              {d.tasks_due.length === 0 ? <li className="py-2 text-muted-foreground">Nothing due.</li> : null}
            </ul>
          </section>
        </>
      ) : null}
    </>
  );
}
