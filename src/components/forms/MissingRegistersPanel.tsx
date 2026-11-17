import { Link } from "react-router-dom";
import { card } from "@/components/staff/StaffShell";
import { periodLabel, useMissingRegisters } from "@/hooks/useScannedForms";

// Administrator / Director landing: daily and weekly registers with no scanned upload for their period.
export function MissingRegistersPanel({ enabled }: { enabled: boolean }) {
  const missing = useMissingRegisters(enabled);
  if (!enabled || !missing.data || missing.data.length === 0) return null;
  return (
    <section className={card}>
      <h2 className="mb-2 text-base font-bold text-brand-navy">Registers missing a scan</h2>
      <ul className="divide-y divide-border text-sm">
        {missing.data.map((m) => (
          <li key={`${m.form_code}-${m.period_start}`} className="flex flex-wrap justify-between gap-2 py-2">
            <span><span className="font-semibold text-brand-navy">{m.form_code}</span> · {m.title}</span>
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900">
              missing · {periodLabel({ period_kind: m.period_start === m.period_end ? "day" : "week", period_start: m.period_start, period_end: m.period_end })}
            </span>
          </li>
        ))}
      </ul>
      <Link to="/staff/forms" className="mt-2 inline-block text-sm font-semibold text-brand-teal underline">Open the Forms library</Link>
    </section>
  );
}
