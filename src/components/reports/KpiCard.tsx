import type { LucideIcon } from "lucide-react";

// Single KPI tile for the Reports dashboard — matches the dashboard card style
// (icon chip + label + big value + optional sub-line). `tone` tints the value
// for money/action emphasis.
export function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  tone = "navy",
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  sub?: string;
  tone?: "navy" | "teal" | "green";
}) {
  const valueCls =
    tone === "teal" ? "text-brand-teal" : tone === "green" ? "text-brand-green" : "text-brand-navy";
  return (
    <div className="rounded-xl border border-border bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand-teal/10 text-brand-teal">
          <Icon className="h-4 w-4" />
        </span>
        {label}
      </div>
      <p className={"mt-3 text-2xl font-bold " + valueCls}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

// Skeleton placeholder shown while the report queries load.
export function KpiCardSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-white p-4 shadow-sm">
      <div className="h-4 w-32 animate-pulse rounded bg-slate-100" />
      <div className="mt-3 h-8 w-24 animate-pulse rounded bg-slate-100" />
    </div>
  );
}
