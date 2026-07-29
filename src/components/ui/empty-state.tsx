import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Canonical empty-state for lists, tables, and detail sections.
 *
 * The brand pattern (owner-approved, DESIGN lane): a brand-tinted icon medallion
 * + a short navy title + optional helper copy + an optional primary action.
 * Reuse this everywhere instead of hand-rolling one-line "No X yet" text so the
 * whole CRM reads as one system. Keep copy warm and specific to the surface.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  /** Optional one-line helper under the title. */
  description?: string;
  /** Optional primary action (a Link or button). */
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-xl border border-border bg-white px-6 py-14 text-center shadow-sm",
        className,
      )}
    >
      {/* Subtle brand element: teal→green tinted medallion behind the icon. */}
      <span
        aria-hidden="true"
        className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-brand-teal/10 to-brand-green/10 ring-1 ring-brand-teal/15"
      >
        <Icon className="h-7 w-7 text-brand-teal" strokeWidth={1.75} />
      </span>
      <div className="space-y-1">
        <p className="text-base font-semibold text-brand-navy">{title}</p>
        {description && (
          <p className="mx-auto max-w-sm text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
