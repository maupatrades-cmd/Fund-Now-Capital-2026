import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import {
  applicableEventTypesForRole,
  eventIcon,
  eventIconClass,
  PREF_MATRIX_CHANNELS,
  type PortalRole,
  type PrefChannel,
} from "@/lib/notifications";
import {
  useMyNotificationPreferences,
  useSetNotificationPreference,
} from "@/hooks/useNotificationPreferences";

/*
 * Shared per-event × per-channel notification preferences matrix, used by all
 * three portals (owner / partner / contractor). Rows are the events applicable
 * to the given role; columns are the two configurable channels (In-app, Email).
 *
 * A missing preference row means "on" for both channels — matching the server's
 * check_notification_channel_enabled() default-ON. Toggling a checkbox calls the
 * set_notification_preference RPC and updates optimistically.
 */
export default function NotificationPreferencesMatrix({ role }: { role: PortalRole }) {
  const { data: prefs, isLoading, isError, refetch } = useMyNotificationPreferences();
  const setPref = useSetNotificationPreference();

  const events = applicableEventTypesForRole(role);

  // Default ON when no stored row / column exists.
  const channelEnabled = (eventType: string, channel: PrefChannel): boolean => {
    const row = prefs?.[eventType];
    if (!row) return true;
    return channel === "email" ? row.email_enabled : row.in_app_enabled;
  };

  const onToggle = (eventType: string, channel: PrefChannel, enabled: boolean) => {
    setPref.mutate(
      { eventType, channel, enabled },
      {
        onError: (e) =>
          toast.error(e instanceof Error ? e.message : "Could not save preference"),
      },
    );
  };

  const isPending = (eventType: string, channel: PrefChannel) =>
    setPref.isPending &&
    setPref.variables?.eventType === eventType &&
    setPref.variables?.channel === channel;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-white py-16 text-sm text-muted-foreground shadow-sm">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading preferences…
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-xl border border-border bg-white p-6 text-sm shadow-sm">
        <p className="text-red-600">Could not load your notification preferences.</p>
        <button
          type="button"
          onClick={() => void refetch()}
          className="mt-3 rounded-lg border border-border px-3 py-2 text-sm font-medium text-brand-navy hover:bg-slate-50"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-white shadow-sm">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="px-4 py-3 font-semibold">Event</th>
            {PREF_MATRIX_CHANNELS.map((c) => (
              <th key={c.channel} className="px-4 py-3 text-center font-semibold">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {events.map((e) => {
            const Icon = eventIcon(e.value);
            return (
              <tr key={e.value} className="border-b border-border last:border-0">
                <td className="px-4 py-3 font-medium text-brand-navy">
                  <span className="flex items-center gap-2">
                    <Icon className={`h-4 w-4 shrink-0 ${eventIconClass(e.value)}`} />
                    {e.label}
                  </span>
                </td>
                {PREF_MATRIX_CHANNELS.map((c) => (
                  <td key={c.channel} className="px-4 py-3 text-center">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-border align-middle accent-brand-teal"
                      checked={channelEnabled(e.value, c.channel)}
                      disabled={isPending(e.value, c.channel)}
                      onChange={(ev) => onToggle(e.value, c.channel, ev.target.checked)}
                      aria-label={`${c.label} notifications for ${e.label}`}
                    />
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
