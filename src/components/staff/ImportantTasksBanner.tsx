import { Link } from "react-router-dom";
import { Siren } from "lucide-react";
import { errorText } from "@/components/staff/StaffShell";
import { useMyImportantTasks, useStaffRole } from "@/hooks/useStaffDesk";

const fmt = (iso: string) => new Date(iso).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg", dateStyle: "medium", timeStyle: "short" });

// Important tasks from the Director stay at the top of the landing page until they are done. Accepting, asking a
// question and marking done happen on the Tasks page (and accepting also in "Tasks given to you" below).
export function ImportantTasksBanner() {
  const { data: role } = useStaffRole();
  const enabled = !!role && role !== "owner";
  const tasks = useMyImportantTasks(enabled);
  if (!enabled) return null;
  if (tasks.error) return <p role="alert" className="text-sm text-red-600">{errorText(tasks.error)}</p>;
  if (!tasks.data?.length) return null;

  return (
    <section role="alert" className="rounded-2xl border-2 border-red-500 bg-red-50 p-5 shadow-sm">
      <h2 className="flex items-center gap-2 text-base font-bold text-red-800">
        <Siren className="h-5 w-5" aria-hidden="true" />
        Important — from the Director
      </h2>
      <ul className="mt-2 divide-y divide-red-200 text-sm">
        {tasks.data.map((t) => (
          <li key={t.id} className="space-y-1 py-2">
            <p className="font-semibold text-red-900">{t.title}</p>
            {t.notes ? <p className="text-red-900/80">{t.notes}</p> : null}
            <p className={`text-xs ${t.overdue ? "font-semibold text-red-700" : "text-red-900/70"}`}>
              {t.acceptance === "pending" ? "Waiting for you to accept" : "Accepted — mark it done when finished"}
              {t.business_name ? ` · ${t.business_name}` : ""}
              {t.due_at ? ` · due ${fmt(t.due_at)}` : ""}
              {t.overdue ? " · overdue" : ""}
            </p>
          </li>
        ))}
      </ul>
      <Link to="/staff/tasks" className="mt-2 inline-block text-sm font-semibold text-red-800 underline">Open my tasks</Link>
    </section>
  );
}
