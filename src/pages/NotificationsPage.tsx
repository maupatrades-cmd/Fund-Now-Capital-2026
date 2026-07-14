import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CheckCheck, Settings } from "lucide-react";
import { formatRelative } from "@/lib/format";
import { eventIcon, eventIconClass, eventLabel, NOTIFICATION_EVENT_TYPES } from "@/lib/notifications";
import {
  useNotificationList,
  useMarkNotificationsRead,
  useMarkAllNotificationsRead,
  type NotificationFilters,
} from "@/hooks/useNotifications";

const ctl =
  "rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/20";

export default function NotificationsPage() {
  const [filters, setFilters] = useState<NotificationFilters>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { data: rows, isLoading, isError, error } = useNotificationList(filters);
  const markMany = useMarkNotificationsRead();
  const markAll = useMarkAllNotificationsRead();
  const navigate = useNavigate();

  const set = (patch: Partial<NotificationFilters>) => setFilters((f) => ({ ...f, ...patch }));
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const markSelected = () => {
    if (selected.size === 0) return;
    markMany.mutate([...selected], { onSuccess: () => setSelected(new Set()) });
  };

  return (
    <div className="max-w-4xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-brand-navy">Notifications</h1>
          <p className="mt-1 text-sm text-muted-foreground">Everything that's happened on your deals.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/settings/notifications"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-brand-navy hover:bg-slate-50"
          >
            <Settings className="h-4 w-4" /> Preferences
          </Link>
          <button
            type="button"
            onClick={markSelected}
            disabled={selected.size === 0}
            className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-brand-navy hover:bg-slate-50 disabled:opacity-50"
          >
            Mark selected read ({selected.size})
          </button>
          <button
            type="button"
            onClick={() => markAll.mutate()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-teal px-3 py-2 text-sm font-semibold text-white hover:bg-brand-teal/90"
          >
            <CheckCheck className="h-4 w-4" /> Mark all read
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 gap-3 rounded-xl border border-border bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          From
          <input type="date" className={ctl} value={filters.from ?? ""} onChange={(e) => set({ from: e.target.value || undefined })} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          To
          <input type="date" className={ctl} value={filters.to ?? ""} onChange={(e) => set({ to: e.target.value || undefined })} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          Event type
          <select className={ctl} value={filters.eventType ?? ""} onChange={(e) => set({ eventType: e.target.value || undefined })}>
            <option value="">All events</option>
            {NOTIFICATION_EVENT_TYPES.map((e) => (
              <option key={e.value} value={e.value}>{e.label}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          Status
          <select className={ctl} value={filters.read ?? ""} onChange={(e) => set({ read: (e.target.value || undefined) as NotificationFilters["read"] })}>
            <option value="">All</option>
            <option value="unread">Unread</option>
            <option value="read">Read</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground sm:col-span-2 lg:col-span-1">
          Search
          <input type="search" placeholder="title or body…" className={ctl} value={filters.search ?? ""} onChange={(e) => set({ search: e.target.value || undefined })} />
        </label>
        <div className="sm:col-span-2 lg:col-span-3">
          <button type="button" onClick={() => setFilters({})} className="text-xs font-medium text-brand-teal hover:underline">
            Clear filters
          </button>
        </div>
      </div>

      {/* List */}
      <div className="rounded-xl border border-border bg-white p-2 shadow-sm">
        {isLoading ? (
          <p className="p-4 text-sm text-muted-foreground">Loading…</p>
        ) : isError ? (
          <p className="p-4 text-sm text-red-600">
            Couldn't load notifications: {error instanceof Error ? error.message : "Unknown error"}
          </p>
        ) : rows && rows.length > 0 ? (
          <ul className="divide-y divide-border">
            {rows.map((n) => {
              const Icon = eventIcon(n.event_type);
              return (
                <li key={n.id} className={"flex items-start gap-3 p-3 " + (n.read_status ? "" : "bg-brand-teal/5")}>
                  <input
                    type="checkbox"
                    className="mt-1.5 h-4 w-4 rounded border-border"
                    checked={selected.has(n.id)}
                    onChange={() => toggle(n.id)}
                    aria-label="Select notification"
                  />
                  <Icon className={"mt-1 h-4 w-4 shrink-0 " + eventIconClass(n.event_type)} />
                  <button
                    type="button"
                    onClick={() => n.link_url && navigate(n.link_url)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-brand-navy">{n.title}</span>
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                        {eventLabel(n.event_type)}
                      </span>
                      {!n.read_status && <span className="h-1.5 w-1.5 rounded-full bg-brand-teal" />}
                    </span>
                    {n.body_text && <span className="mt-0.5 block text-sm text-muted-foreground">{n.body_text}</span>}
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">{formatRelative(n.created_at)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="p-6 text-center text-sm text-muted-foreground">No notifications match these filters.</p>
        )}
      </div>
    </div>
  );
}
