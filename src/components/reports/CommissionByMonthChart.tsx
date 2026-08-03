import { formatZAR } from "@/lib/format";
import type { MonthBucket } from "@/lib/reports";

// Dependency-free bar chart — Commission earned by month (fixed last 12 months).
// A single 12-bar chart doesn't justify pulling in a charting library, so this
// is plain flexbox + divs, matching the dashboard's inline bar style. Each bar
// carries a native tooltip with the exact Rand value; the y-axis shows the peak.
export function CommissionByMonthChart({ data }: { data: MonthBucket[] }) {
  const max = Math.max(0, ...data.map((d) => d.total));
  const hasData = max > 0;

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-brand-navy">Commission earned by month</h2>
      <div className="rounded-xl border border-border bg-white p-4 shadow-sm">
        {!hasData && (
          <p className="mb-3 text-xs text-muted-foreground">
            No commission recorded in the last 12 months yet.
          </p>
        )}
        <div className="flex items-end justify-between gap-1.5" style={{ height: 180 }}>
          {data.map((d) => {
            const pct = hasData ? Math.round((d.total / max) * 100) : 0;
            return (
              <div key={d.key} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                <div
                  className="w-full max-w-[36px] rounded-t bg-brand-teal transition-all"
                  style={{ height: `${pct}%`, minHeight: d.total > 0 ? 2 : 0 }}
                  title={`${d.label}: ${formatZAR(d.total)}`}
                  aria-label={`${d.label}: ${formatZAR(d.total)}`}
                />
              </div>
            );
          })}
        </div>
        <div className="mt-2 flex items-end justify-between gap-1.5">
          {data.map((d) => (
            <div
              key={d.key}
              className="flex-1 text-center text-[10px] leading-tight text-muted-foreground"
            >
              {d.label}
            </div>
          ))}
        </div>
        {hasData && (
          <p className="mt-3 text-right text-xs text-muted-foreground">
            Peak month <span className="font-medium text-brand-navy">{formatZAR(max)}</span>
          </p>
        )}
      </div>
    </section>
  );
}
