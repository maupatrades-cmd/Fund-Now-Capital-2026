import { useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { TargetLine } from "@/components/staff/MyTargetsPanel";
import { card, errorText, primaryButton } from "@/components/staff/StaffShell";
import { useStaffRole } from "@/hooks/useStaffDesk";
import { targetValue, useSetTarget, useTargetsOverview, type TargetOverviewRow } from "@/hooks/useTargets";

// The Director's one screen (launch plan §7): every staff member's targets against month-to-date, and the place to
// confirm or change a role's target. Changing a target changes it for everyone in that role.
const ROLE_LABEL: Record<string, string> = {
  administrator: "Office Administrator", coordinator: "Sales Coordinator", switchboard: "Switchboard", hr: "HR",
  field_supervisor: "Field Supervisor", field_consultant: "Field consultant",
};

function EditTarget({ r }: { r: TargetOverviewRow }) {
  const save = useSetTarget();
  const [v, setV] = useState(r.target === null ? "" : String(Number(r.target)));
  return (
    <div className="flex flex-wrap items-center gap-2 pb-2 text-xs">
      <Input className="h-8 w-24" inputMode="decimal" aria-label={`Target for ${r.label}`} value={v} onChange={(e) => setV(e.target.value.trim())} />
      <button type="button" className={`${primaryButton} !px-3 !py-1 text-xs`} disabled={save.isPending || (v !== "" && !/^\d{1,6}(\.\d{1,2})?$/.test(v))}
        onClick={() => save.mutate({ role: r.role, metric: r.metric_key, target: v === "" ? null : Number(v) }, {
          onSuccess: () => toast.success("Target confirmed for the role"), onError: (x) => toast.error(errorText(x)),
        })}>{r.status === "proposed" ? "Confirm" : "Save"}</button>
      {r.unit === "percent" ? <span className="text-muted-foreground">%</span> : null}
    </div>
  );
}

export default function StaffTargetsPage() {
  const { data: role } = useStaffRole();
  const q = useTargetsOverview(role === "owner");
  if (role !== "owner") return <p className="text-sm text-muted-foreground">This screen is for the Director.</p>;
  const people = new Map<string, TargetOverviewRow[]>();
  for (const r of q.data ?? []) people.set(r.profile_id, [...(people.get(r.profile_id) ?? []), r]);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-brand-navy">Targets: all roles</h1>
        <p className="text-sm text-muted-foreground">This month so far, for every staff member who is switched on. Proposed targets need your confirmation.</p>
      </div>
      {q.error ? <p role="alert" className="text-sm text-red-600">{errorText(q.error)}</p> : null}
      {q.data && q.data.length === 0 ? <p className="text-sm text-muted-foreground">No staff are switched on yet.</p> : null}
      {[...people.values()].map((rows) => (
        <section key={rows[0].profile_id} className={`${card} space-y-1`}>
          <h2 className="text-base font-bold text-brand-navy">{rows[0].full_name ?? "Unnamed"} <span className="text-sm font-normal text-muted-foreground">· {ROLE_LABEL[rows[0].role] ?? rows[0].role}</span></h2>
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <li key={r.metric_key}>
                <ul><TargetLine r={r} /></ul>
                {r.unit !== "text" ? <EditTarget r={r} /> : null}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">Targets apply to the whole role. Shown: {rows.filter((r) => r.actual !== null).map((r) => `${r.label} ${targetValue(r.actual, r.unit)}`).join(" · ") || "nothing measured yet"}</p>
        </section>
      ))}
    </div>
  );
}
