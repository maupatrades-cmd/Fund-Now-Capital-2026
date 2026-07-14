import { toast } from "sonner";
import { useSession } from "@/lib/useSession";
import { NOTIFICATION_EVENT_TYPES, NOTIFICATION_CHANNELS } from "@/lib/notifications";
import {
  useNotificationPreferences,
  useSetInAppPreference,
} from "@/hooks/useNotificationPreferences";

export default function NotificationPreferencesPage() {
  const session = useSession();
  const userId = session?.user?.id;
  const { data: prefs, isLoading } = useNotificationPreferences();
  const setInApp = useSetInAppPreference();

  const inAppEnabled = (eventType: string) => prefs?.[eventType]?.in_app_enabled ?? true;

  const onToggle = (eventType: string, enabled: boolean) => {
    if (!userId) return;
    setInApp.mutate(
      { userId, eventType, enabled },
      { onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save preference") },
    );
  };

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-brand-navy">Notification preferences</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose how you're notified per event. In-app is live now; email, WhatsApp, and SMS are coming soon.
        </p>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-3 font-semibold">Event</th>
              {NOTIFICATION_CHANNELS.map((c) => (
                <th key={c.key} className="px-4 py-3 text-center font-semibold">{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={1 + NOTIFICATION_CHANNELS.length} className="px-4 py-6 text-center text-muted-foreground">
                  Loading…
                </td>
              </tr>
            ) : (
              NOTIFICATION_EVENT_TYPES.map((e) => (
                <tr key={e.value} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 font-medium text-brand-navy">{e.label}</td>
                  {NOTIFICATION_CHANNELS.map((c) =>
                    c.live ? (
                      <td key={c.key} className="px-4 py-3 text-center">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-border align-middle"
                          checked={inAppEnabled(e.value)}
                          disabled={setInApp.isPending}
                          onChange={(ev) => onToggle(e.value, ev.target.checked)}
                          aria-label={`In-app notifications for ${e.label}`}
                        />
                      </td>
                    ) : (
                      <td key={c.key} className="px-4 py-3 text-center text-[11px] text-muted-foreground">
                        coming soon
                      </td>
                    ),
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
