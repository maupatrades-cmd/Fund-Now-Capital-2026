import { card, errorText } from "@/components/staff/StaffShell";
import { targetProgress, targetValue, useMyTargets, type TargetRow } from "@/hooks/useTargets";

// The signed-in person's targets against month-to-date (launch plan §7). Proposed targets are marked until the
// Director confirms them.
export function TargetLine({ r }: { r: TargetRow }) {
  const pct = targetProgress(r);
  return (
    <li className="space-y-1 py-2 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-brand-navy">{r.label}{r.scope === "office" ? <span className="text-xs text-muted-foreground"> (whole office)</span> : null}</span>
        <span className="font-semibold text-brand-navy">
          {r.unit === "text" ? (r.target !== null ? `Target ${Number(r.target)}` : "Routine")
            : r.actual === null ? <span className="font-normal text-muted-foreground">Not tracked yet · target {targetValue(r.target, r.unit)}</span>
            : `${targetValue(r.actual, r.unit)} of ${targetValue(r.target, r.unit)}`}
          {r.status === "proposed" ? <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-normal text-muted-foreground">proposed</span> : null}
        </span>
      </div>
      {pct !== null ? (
        <div className="h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-label={r.label} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className={`h-full ${pct >= 100 ? "bg-green-600" : "bg-brand-teal"}`} style={{ width: `${pct}%` }} />
        </div>
      ) : null}
    </li>
  );
}

export function MyTargetsPanel() {
  const q = useMyTargets();
  if (q.data && q.data.length === 0) return null;
  return (
    <section className={`${card} space-y-2`}>
      <h2 className="text-base font-bold text-brand-navy">My targets this month</h2>
      {q.error ? <p role="alert" className="text-sm text-red-600">{errorText(q.error)}</p> : null}
      <ul className="divide-y divide-border">{(q.data ?? []).map((r) => <TargetLine key={r.metric_key} r={r} />)}</ul>
    </section>
  );
}
