import { toast } from "sonner";
import { card, errorText } from "@/components/staff/StaffShell";
import { useCheckinReminders, useCompleteCheckin, useStaffRole } from "@/hooks/useStaffDesk";

// Weekly Team Leader and fortnightly organisation check-ins. In-app reminders
// for the Coordinator only; completing one records that the check-in happened.
// Nothing is sent to the Team Leader or partner from here.
export default function StaffCheckinsPanel() {
  const { data: role } = useStaffRole();
  const allowed = role === "coordinator" || role === "owner";
  const list = useCheckinReminders(allowed);
  const complete = useCompleteCheckin();
  if (!allowed) return null;

  const done = (id: string) => {
    const note = window.prompt("Short note on the check-in (optional)") ?? "";
    complete.mutate({ id, note }, { onSuccess: () => toast.success("Check-in recorded"), onError: (e) => toast.error(errorText(e)) });
  };

  return (
    <section className={card}>
      <h2 className="mb-2 text-base font-bold text-brand-navy">Check-ins due</h2>
      {list.error ? <p role="alert" className="text-sm text-red-600">{errorText(list.error)}</p> : null}
      <ul className="divide-y divide-border text-sm">
        {(list.data ?? []).map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-3 py-2">
            <span>
              <span className="font-semibold text-brand-navy">{r.subject_name}</span>
              <span className="ml-2 text-xs text-muted-foreground">
                {r.subject_kind === "team" ? `Team Leader${r.leader_name ? `: ${r.leader_name}` : ""} · weekly` : "Organisation · every two weeks"}
              </span>
              <span className={`ml-2 text-xs ${r.overdue ? "text-red-600" : "text-muted-foreground"}`}>{r.overdue ? "overdue · " : ""}due {r.due_on}</span>
            </span>
            <button type="button" className="text-xs font-semibold text-green-700 underline" onClick={() => done(r.id)}>Mark done</button>
          </li>
        ))}
        {list.data && list.data.length === 0 ? <li className="py-2 text-muted-foreground">No check-ins due.</li> : null}
      </ul>
    </section>
  );
}
