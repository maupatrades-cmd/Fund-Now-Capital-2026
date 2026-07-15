import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { useSession } from "@/lib/useSession";
import { NOTIFICATION_EVENT_TYPES, NOTIFICATION_CHANNELS } from "@/lib/notifications";
import {
  useNotificationPreferences,
  useSetChannelPreference,
  type ToggleableChannel,
} from "@/hooks/useNotificationPreferences";

export default function NotificationPreferencesPage() {
  const session = useSession();
  const userId = session?.user?.id;
  const { data: prefs, isLoading } = useNotificationPreferences();
  const setChannel = useSetChannelPreference();

  // Live channels default ON when no preference row exists yet.
  const channelEnabled = (eventType: string, channel: ToggleableChannel) =>
    (prefs?.[eventType]?.[channel] as boolean | undefined) ?? true;

  const onToggle = (eventType: string, channel: ToggleableChannel, enabled: boolean) => {
    if (!userId) return;
    setChannel.mutate(
      { userId, eventType, channel, enabled },
      { onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save preference") },
    );
  };

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-brand-navy">Notification preferences</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose how you're notified per event. In-app and email are live; WhatsApp and SMS are coming soon.
        </p>
      </div>

      {isLoading ? (
        // Wait for the real preference values before rendering toggles, so they
        // never flicker from a default state to the loaded state.
        <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-white py-16 text-sm text-muted-foreground shadow-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading preferences…
        </div>
      ) : (
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
              {NOTIFICATION_EVENT_TYPES.map((e) => (
                <tr key={e.value} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 font-medium text-brand-navy">{e.label}</td>
                  {NOTIFICATION_CHANNELS.map((c) =>
                    c.live ? (
                      <td key={c.key} className="px-4 py-3 text-center">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-border align-middle"
                          checked={channelEnabled(e.value, c.key as ToggleableChannel)}
                          disabled={
                            setChannel.isPending &&
                            setChannel.variables?.eventType === e.value &&
                            setChannel.variables?.channel === c.key
                          }
                          onChange={(ev) =>
                            onToggle(e.value, c.key as ToggleableChannel, ev.target.checked)
                          }
                          aria-label={`${c.label} notifications for ${e.label}`}
                        />
                      </td>
                    ) : (
                      <td key={c.key} className="px-4 py-3 text-center text-[11px] text-muted-foreground">
                        coming soon
                      </td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
