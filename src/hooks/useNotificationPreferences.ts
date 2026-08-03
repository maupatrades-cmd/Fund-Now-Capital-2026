import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/useSession";
import type { PrefChannel } from "@/lib/notifications";

// A user's stored preference for one event: whether each configurable channel is
// on. Rows come from the get_my_notification_preferences() RPC (self-scoped to
// auth.uid()). Events with no row are absent here and treated as "on" by the UI,
// matching check_notification_channel_enabled()'s default-ON behaviour.
export type NotificationPreferenceRow = {
  event_type: string;
  email_enabled: boolean;
  in_app_enabled: boolean;
};

export type PreferenceMap = Record<string, NotificationPreferenceRow>;

// The caller's preferences, keyed by event_type. Cache is keyed by the session
// user id (mirrors useProfileRole) so a same-tab sign-out/sign-in as a different
// user can never reuse the previous user's cached preferences.
export function useMyNotificationPreferences() {
  const session = useSession();
  const uid = session?.user?.id ?? null;

  return useQuery({
    queryKey: ["notification-preferences", uid],
    queryFn: async (): Promise<PreferenceMap> => {
      const { data, error } = await supabase.rpc("get_my_notification_preferences");
      if (error) throw error;
      const byEvent: PreferenceMap = {};
      for (const row of (data ?? []) as NotificationPreferenceRow[]) {
        byEvent[row.event_type] = row;
      }
      return byEvent;
    },
  });
}

// Column each channel maps to on a preference row (for optimistic patching).
const CHANNEL_COLUMN: Record<PrefChannel, "in_app_enabled" | "email_enabled"> = {
  in_app: "in_app_enabled",
  email: "email_enabled",
};

// Toggle one channel for one event via the set_notification_preference RPC
// (server enforces auth.uid()). Optimistic: the matrix flips instantly and rolls
// back on error. Keyed by uid so the optimistic patch targets the right cache.
export function useSetNotificationPreference() {
  const qc = useQueryClient();
  const session = useSession();
  const uid = session?.user?.id ?? null;
  const key = ["notification-preferences", uid] as const;

  return useMutation({
    mutationFn: async ({
      eventType,
      channel,
      enabled,
    }: {
      eventType: string;
      channel: PrefChannel;
      enabled: boolean;
    }) => {
      const { error } = await supabase.rpc("set_notification_preference", {
        p_event_type: eventType,
        p_channel: channel,
        p_enabled: enabled,
      });
      if (error) throw error;
    },
    onMutate: async ({ eventType, channel, enabled }) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<PreferenceMap>(key);
      qc.setQueryData<PreferenceMap>(key, (old) => {
        const existing = old?.[eventType] ?? {
          event_type: eventType,
          email_enabled: true,
          in_app_enabled: true,
        };
        return {
          ...(old ?? {}),
          [eventType]: { ...existing, [CHANNEL_COLUMN[channel]]: enabled },
        };
      });
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous !== undefined) qc.setQueryData(key, ctx.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });
}
