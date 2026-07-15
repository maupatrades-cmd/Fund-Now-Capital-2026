import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export type NotificationPreference = {
  id: string;
  user_id: string;
  event_type: string;
  email_enabled: boolean;
  whatsapp_enabled: boolean;
  sms_enabled: boolean;
  in_app_enabled: boolean;
  updated_at: string;
};

// Returns the caller's preference rows keyed by event_type (RLS scopes to own).
export function useNotificationPreferences() {
  return useQuery({
    queryKey: ["notification-preferences"],
    queryFn: async (): Promise<Record<string, NotificationPreference>> => {
      const { data, error } = await supabase.from("notification_preferences").select("*");
      if (error) throw error;
      const byEvent: Record<string, NotificationPreference> = {};
      for (const row of (data ?? []) as NotificationPreference[]) {
        byEvent[row.event_type] = row;
      }
      return byEvent;
    },
  });
}

// Channels toggleable from the preferences page. in_app (A11) + email (A12).
export type ToggleableChannel = "in_app_enabled" | "email_enabled";

// Upserts a single channel column for (user, event). Only the toggled column is
// written; the row's other columns keep their values (or table defaults on
// insert). RLS scopes writes to the caller's own rows. Returns the affected row
// so a silent RLS no-op surfaces loudly (see CLAUDE.md working-style rule).
export function useSetChannelPreference() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      userId,
      eventType,
      channel,
      enabled,
    }: {
      userId: string;
      eventType: string;
      channel: ToggleableChannel;
      enabled: boolean;
    }) => {
      const { data, error } = await supabase
        .from("notification_preferences")
        .upsert(
          {
            user_id: userId,
            event_type: eventType,
            [channel]: enabled,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id,event_type" },
        )
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("Preference was not saved");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notification-preferences"] }),
  });
}
