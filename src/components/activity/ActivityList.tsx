import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatRelative } from "@/lib/format";
import {
  type ActivityLog,
  eventTypeLabel,
  eventBadge,
  entityTypeLabel,
  fieldLabel,
  formatValue,
  formatTimestamp,
} from "@/lib/activity";

// Shared renderer for both the entity Activity tabs and the /activity timeline.
export function ActivityList({
  rows,
  showEntity = false,
}: {
  rows: ActivityLog[];
  showEntity?: boolean;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No activity recorded.</p>;
  }
  return (
    <ul className="divide-y divide-border">
      {rows.map((row) => (
        <ActivityRow key={row.id} row={row} showEntity={showEntity} />
      ))}
    </ul>
  );
}

function ActivityRow({ row, showEntity }: { row: ActivityLog; showEntity: boolean }) {
  const [open, setOpen] = useState(false);
  const fields = row.changed_fields ?? [];
  const hasDiff = fields.length > 0;

  return (
    <li className="py-2.5">
      <div className="flex items-start gap-3">
        <span
          className="mt-0.5 w-16 shrink-0 text-[11px] text-muted-foreground"
          title={formatTimestamp(row.occurred_at)}
        >
          {formatRelative(row.occurred_at)}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={"ring-1 ring-inset " + eventBadge(row.event_type)}>
              {eventTypeLabel(row.event_type)}
            </Badge>
            {showEntity && (
              <span className="text-[11px] text-muted-foreground">
                {entityTypeLabel(row.entity_type)}
              </span>
            )}
            <span className="text-sm text-brand-navy">{row.description ?? "—"}</span>
          </div>

          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
            <span>{row.user_email ?? "System"}</span>
            {hasDiff && (
              <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className="inline-flex items-center gap-0.5 text-brand-teal hover:underline"
                aria-expanded={open}
              >
                {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                {fields.length} field{fields.length === 1 ? "" : "s"} changed
              </button>
            )}
          </div>

          {open && hasDiff && (
            <div className="mt-2 overflow-x-auto rounded-lg border border-border bg-slate-50 p-3">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="pb-1 pr-4 font-medium">Field</th>
                    <th className="pb-1 pr-4 font-medium">Before</th>
                    <th className="pb-1 font-medium">After</th>
                  </tr>
                </thead>
                <tbody>
                  {fields.map((f) => (
                    <tr key={f} className="align-top">
                      <td className="py-0.5 pr-4 font-medium text-brand-navy">{fieldLabel(f)}</td>
                      <td className="py-0.5 pr-4 text-muted-foreground line-through decoration-red-300">
                        {formatValue(row.before_values?.[f])}
                      </td>
                      <td className="py-0.5 text-brand-navy">
                        {formatValue(row.after_values?.[f])}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}
