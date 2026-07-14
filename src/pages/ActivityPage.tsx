import { useState } from "react";
import { Download } from "lucide-react";
import {
  useActivityFeed,
  useActivityUsers,
  ACTIVITY_FEED_LIMIT,
  type ActivityFilters,
} from "@/hooks/useActivity";
import { ActivityList } from "@/components/activity/ActivityList";
import {
  ACTIVITY_EVENT_TYPES,
  ACTIVITY_ENTITY_TYPES,
  downloadActivityCsv,
} from "@/lib/activity";

const ctl =
  "rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/20";

export default function ActivityPage() {
  const [filters, setFilters] = useState<ActivityFilters>({});
  const { data: rows, isLoading, isError, error } = useActivityFeed(filters);
  const { data: users } = useActivityUsers();

  const set = (patch: Partial<ActivityFilters>) =>
    setFilters((f) => ({ ...f, ...patch }));
  const clear = () => setFilters({});

  const capped = (rows?.length ?? 0) >= ACTIVITY_FEED_LIMIT;

  return (
    <div className="max-w-5xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-brand-navy">Activity</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Chronological audit trail across all records.
          </p>
        </div>
        <button
          type="button"
          onClick={() => rows && downloadActivityCsv(rows)}
          disabled={!rows || rows.length === 0}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-teal px-4 py-2 text-sm font-semibold text-white hover:bg-brand-teal/90 disabled:opacity-50"
        >
          <Download className="h-4 w-4" /> Export CSV
        </button>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 gap-3 rounded-xl border border-border bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          From
          <input
            type="date"
            className={ctl}
            value={filters.from ?? ""}
            onChange={(e) => set({ from: e.target.value || undefined })}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          To
          <input
            type="date"
            className={ctl}
            value={filters.to ?? ""}
            onChange={(e) => set({ to: e.target.value || undefined })}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          User
          <select
            className={ctl}
            value={filters.userId ?? ""}
            onChange={(e) => set({ userId: e.target.value || undefined })}
          >
            <option value="">All users</option>
            {(users ?? []).map((u) => (
              <option key={u.id} value={u.id}>{u.email ?? u.id}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          Event type
          <select
            className={ctl}
            value={filters.eventType ?? ""}
            onChange={(e) => set({ eventType: e.target.value || undefined })}
          >
            <option value="">All events</option>
            {ACTIVITY_EVENT_TYPES.map((e) => (
              <option key={e.value} value={e.value}>{e.label}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          Entity type
          <select
            className={ctl}
            value={filters.entityType ?? ""}
            onChange={(e) => set({ entityType: e.target.value || undefined })}
          >
            <option value="">All entities</option>
            {ACTIVITY_ENTITY_TYPES.map((e) => (
              <option key={e.value} value={e.value}>{e.label}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          Search description
          <input
            type="search"
            placeholder="e.g. DEAL-001"
            className={ctl}
            value={filters.search ?? ""}
            onChange={(e) => set({ search: e.target.value || undefined })}
          />
        </label>

        <div className="sm:col-span-2 lg:col-span-3">
          <button
            type="button"
            onClick={clear}
            className="text-xs font-medium text-brand-teal hover:underline"
          >
            Clear filters
          </button>
        </div>
      </div>

      {/* Timeline */}
      <div className="rounded-xl border border-border bg-white p-5 shadow-sm">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : isError ? (
          <p className="text-sm text-red-600">
            Couldn't load activity: {error instanceof Error ? error.message : "Unknown error"}
          </p>
        ) : (
          <>
            {capped && (
              <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Showing the most recent {ACTIVITY_FEED_LIMIT} entries. Narrow the
                filters to see older activity.
              </p>
            )}
            <ActivityList rows={rows ?? []} showEntity />
          </>
        )}
      </div>
    </div>
  );
}
