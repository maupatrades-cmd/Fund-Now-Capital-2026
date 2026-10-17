import { useState } from "react";
import { toast } from "sonner";
import { card, errorText } from "@/components/staff/StaffShell";
import { useMyPendingTasks, useRespondTask, useStaffRole } from "@/hooks/useStaffDesk";

const fmt = (iso: string) => new Date(iso).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg", dateStyle: "medium", timeStyle: "short" });

// Tasks the Administrator or the Founder gave to you, waiting for your answer. Shown on every staff
// landing page. Declining needs a reason; the task then goes back to whoever gave it.
export function PendingTasksPanel() {
  const { data: role } = useStaffRole();
  const enabled = !!role && role !== "owner";
  const pending = useMyPendingTasks(enabled);
  const respond = useRespondTask();
  const [reason, setReason] = useState<Record<string, string>>({});
  if (!enabled || !pending.data?.length) {
    return pending.error ? <p role="alert" className="text-sm text-red-600">{errorText(pending.error)}</p> : null;
  }

  return (
    <section className={`${card} border-brand-teal`}>
      <h2 className="mb-2 text-base font-bold text-brand-navy">Tasks given to you</h2>
      <p className="mb-2 text-xs text-muted-foreground">Accept a task to take it on, or decline it and say why.</p>
      <ul className="divide-y divide-border text-sm">
        {pending.data.map((t) => {
          const why = reason[t.id] ?? "";
          return (
            <li key={t.id} className="space-y-1 py-2">
              <p className="font-semibold text-brand-navy">
                {t.title}
                {t.priority === "high" ? <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-800">high</span> : null}
                {t.overdue ? <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-800">overdue</span> : null}
              </p>
              {t.notes ? <p className="text-muted-foreground">{t.notes}</p> : null}
              <p className="text-xs text-muted-foreground">
                From {t.assigned_by_name ?? "the Administrator"}{t.business_name ? ` · ${t.business_name}` : ""}{t.due_at ? ` · due ${fmt(t.due_at)}` : ""}
              </p>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button type="button" className="text-xs font-semibold text-green-700 underline" disabled={respond.isPending}
                  onClick={() => respond.mutate({ taskId: t.id, accept: true, reason: "" }, { onSuccess: () => toast.success("Task accepted"), onError: (e) => toast.error(errorText(e)) })}>
                  Accept
                </button>
                <input className="h-9 max-w-xs rounded-md border border-input px-3 text-sm" maxLength={500} aria-label="Reason for declining"
                  placeholder="Why you are declining (at least 10 characters)" value={why} onChange={(e) => setReason({ ...reason, [t.id]: e.target.value })} />
                <button type="button" className="text-xs font-semibold text-red-700 underline" disabled={respond.isPending || why.trim().length < 10}
                  onClick={() => respond.mutate({ taskId: t.id, accept: false, reason: why }, { onSuccess: () => toast.success("Task declined"), onError: (e) => toast.error(errorText(e)) })}>
                  Decline
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
