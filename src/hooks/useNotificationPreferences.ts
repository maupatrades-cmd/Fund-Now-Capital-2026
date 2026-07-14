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

// Only in_app is toggleable in Phase A; email/whatsapp/sms are wired in A12/D6.
export function useSetInAppPreference() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      userId,
      eventType,
      enabled,
    }: {
      userId: string;
      eventType: string;
      enabled: boolean;
    }) => {
      const { error } = await supabase
        .from("notification_preferences")
        .upsert(
          { user_id: userId, event_type: eventType, in_app_enabled: enabled, updated_at: new Date().toISOString() },
          { onConflict: "user_id,event_type" },
        );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notification-preferences"] }),
  });
}
