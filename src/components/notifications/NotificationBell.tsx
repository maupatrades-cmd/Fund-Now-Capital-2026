import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Bell, CheckCheck } from "lucide-react";
import { useSession } from "@/lib/useSession";
import { formatRelative } from "@/lib/format";
import {
  eventIcon,
  eventIconClass,
  type Notification,
} from "@/lib/notifications";
import {
  useUnreadCount,
  useRecentNotifications,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
  useNotificationsRealtime,
} from "@/hooks/useNotifications";

export function NotificationBell() {
  const session = useSession();
  const userId = session?.user?.id;
  useNotificationsRealtime(userId);

  const [open, setOpen] = useState(false);
  const { data: unread = 0 } = useUnreadCount();
  const { data: recent, isLoading } = useRecentNotifications();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const navigate = useNavigate();

  const onItemClick = (n: Notification) => {
    if (!n.read_status) markRead.mutate(n.id);
    setOpen(false);
    if (n.link_url) navigate(n.link_url);
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ""}`}
        className="relative rounded-md p-2 text-brand-navy hover:bg-slate-100"
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="absolute right-0 z-40 mt-2 w-80 overflow-hidden rounded-xl border border-border bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
              <span className="text-sm font-semibold text-brand-navy">Notifications</span>
              {unread > 0 && (
                <button
                  type="button"
                  onClick={() => markAll.mutate()}
                  className="inline-flex items-center gap-1 text-xs font-medium text-brand-teal hover:underline"
                >
                  <CheckCheck className="h-3.5 w-3.5" /> Mark all read
                </button>
              )}
            </div>

            <div className="max-h-96 overflow-y-auto">
              {isLoading ? (
                <p className="px-4 py-6 text-center text-sm text-muted-foreground">Loading…</p>
              ) : recent && recent.length > 0 ? (
                <ul className="divide-y divide-border">
                  {recent.map((n) => {
                    const Icon = eventIcon(n.event_type);
                    return (
                      <li key={n.id}>
                        <button
                          type="button"
                          onClick={() => onItemClick(n)}
                          className={
                            "flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-slate-50 " +
                            (n.read_status ? "" : "bg-brand-teal/5")
                          }
                        >
                          <Icon className={"mt-0.5 h-4 w-4 shrink-0 " + eventIconClass(n.event_type)} />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2">
                              <span className="truncate text-sm font-medium text-brand-navy">{n.title}</span>
                              {!n.read_status && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-teal" />}
                            </span>
                            {n.body_text && (
                              <span className="mt-0.5 block truncate text-xs text-muted-foreground">{n.body_text}</span>
                            )}
                            <span className="mt-0.5 block text-[11px] text-muted-foreground">
                              {formatRelative(n.created_at)}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="px-4 py-6 text-center text-sm text-muted-foreground">You're all caught up.</p>
              )}
            </div>

            <div className="border-t border-border px-4 py-2 text-center">
              <Link
                to="/notifications"
                onClick={() => setOpen(false)}
                className="text-xs font-medium text-brand-teal hover:underline"
              >
                View all notifications
              </Link>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
