import type { ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { STATE_TONE, stateLabel } from "@/lib/statements";

/*
 * Shared presentational pieces for all three role statements: a totals tile, a
 * commission-state badge, and a frame that renders the header (title + picker +
 * export) with loading / error / content states. Keeping these in one place
 * makes the owner / partner / contractor views thin and consistent.
 */

export function TotalTile({
  label,
  value,
  emphasis,
  sub,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  sub?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border bg-white p-4 shadow-sm",
        emphasis ? "border-brand-teal/40 ring-1 ring-brand-teal/20" : "border-border",
      )}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1 text-lg font-bold",
          emphasis ? "text-brand-teal" : "text-brand-navy",
        )}
      >
        {value}
      </p>
      {sub && <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

export function StateBadge({ state }: { state: string }) {
  return (
    <span
      className={cn(
        "inline-block rounded-full px-2 py-0.5 text-xs font-medium",
        STATE_TONE[state] ?? "bg-slate-100 text-slate-600",
      )}
    >
      {stateLabel(state)}
    </span>
  );
}

export function KindBadge({ kind }: { kind: string }) {
  const isBonus = kind === "bonus";
  return (
    <span
      className={cn(
        "inline-block rounded-full px-2 py-0.5 text-xs font-medium",
        isBonus ? "bg-brand-green/15 text-brand-green" : "bg-slate-100 text-slate-600",
      )}
    >
      {isBonus ? "Bonus" : "Commission"}
    </span>
  );
}

// Header + state wrapper. `title`, the month picker and the export button live in
// the header; `children` render the body once loaded.
export function StatementFrame({
  title,
  subtitle,
  picker,
  actions,
  isLoading,
  isError,
  error,
  onRetry,
  children,
}: {
  title: string;
  subtitle?: string;
  picker: ReactNode;
  actions?: ReactNode;
  isLoading: boolean;
  isError: boolean;
  error?: Error | null;
  onRetry: () => void;
  children: ReactNode;
}) {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-brand-navy">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {picker}
          {actions}
        </div>
      </div>

      {isError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <p>Couldn't load this statement: {error?.message ?? "unknown error"}</p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-brand-navy px-3 py-1.5 text-xs font-semibold text-white"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Retry
          </button>
        </div>
      ) : isLoading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-20 animate-pulse rounded-xl border border-border bg-slate-100" />
            ))}
          </div>
          <div className="h-40 animate-pulse rounded-xl border border-border bg-slate-100" />
        </div>
      ) : (
        children
      )}
    </div>
  );
}
