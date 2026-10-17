import { card, errorText } from "@/components/staff/StaffShell";
import { useCoordinatorKpis, useQualifyingFiles, type CoordinatorKpi } from "@/hooks/useStaffDesk";

const day = (iso: string) => new Date(iso).toLocaleDateString("en-ZA", { timeZone: "Africa/Johannesburg", dateStyle: "medium" });

function kpiState(k: CoordinatorKpi): { text: string; cls: string } {
  if (k.not_tracked) return { text: "Not tracked yet", cls: "text-muted-foreground" };
  if (k.value_pct == null) return { text: "No data yet", cls: "text-muted-foreground" };
  const met = k.direction === "min" ? k.value_pct >= k.target_pct : k.value_pct <= k.target_pct;
  return { text: `${k.value_pct}%`, cls: met ? "text-green-700" : "text-red-600" };
}

// R35 qualifying-file count for the month (an estimate until the Founder signs off) and the
// Coordinator's KPI scorecard against the agreed targets.
export function QualifyingAndKpis({ enabled }: { enabled: boolean }) {
  const q = useQualifyingFiles(enabled);
  const k = useCoordinatorKpis(enabled);
  return (
    <>
      <section className={card}>
        <h2 className="mb-1 text-base font-bold text-brand-navy">Qualifying files this month</h2>
        {q.error ? <p role="alert" className="text-sm text-red-600">{errorText(q.error)}</p> : null}
        {q.data ? (
          <>
            <p className="text-sm">
              <span className="text-2xl font-bold text-brand-navy">{q.data.count}</span> file{q.data.count === 1 ? "" : "s"} × R{q.data.rate_per_file} ={" "}
              <span className="font-semibold">R{q.data.estimate_total}</span>{" "}
              <span className="text-xs text-muted-foreground">(estimate until the Founder signs off)</span>
            </p>
            <p className="text-xs text-muted-foreground">Cut-off {day(q.data.cutoff_date)} · paid {day(q.data.pay_date)}. A file counts once, when it reaches With Founder, if you were assigned before it became Complete.</p>
            <ul className="mt-2 divide-y divide-border text-sm">
              {q.data.files.map((f) => (
                <li key={f.lead_id} className="py-1.5">{f.business_name} <span className="text-xs text-muted-foreground">· reached the Founder {day(f.reached_founder_at)}</span></li>
              ))}
              {q.data.files.length === 0 ? <li className="py-1.5 text-muted-foreground">None yet this month.</li> : null}
            </ul>
          </>
        ) : null}
      </section>
      <section className={card}>
        <h2 className="mb-1 text-base font-bold text-brand-navy">Your scorecard (last 30 days)</h2>
        {k.error ? <p role="alert" className="text-sm text-red-600">{errorText(k.error)}</p> : null}
        <ul className="divide-y divide-border text-sm">
          {k.data?.kpis.map((x) => {
            const s = kpiState(x);
            return (
              <li key={x.key} className="flex items-baseline justify-between gap-3 py-1.5">
                <span>{x.label}<span className="block text-xs text-muted-foreground">Target {x.direction === "min" ? "at least" : "at most"} {x.target_pct}%{x.sample != null ? ` · ${x.sample} counted` : ""}</span></span>
                <span className={`font-semibold ${s.cls}`}>{s.text}</span>
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}
