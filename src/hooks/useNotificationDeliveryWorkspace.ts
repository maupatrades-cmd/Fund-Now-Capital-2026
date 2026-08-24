import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export type EmailDeliveryStatus = "pending" | "sent" | "delivered" | "failed" | "skipped" | "dead_letter";

export type EmailDeliveryAttempt = {
  id: string;
  status: EmailDeliveryStatus;
  attemptNumber: number;
  createdAt: string;
  sentAt: string | null;
  errorMessage: string | null;
  externalId: string | null;
  retryOf: string | null;
};

export type NotificationDeliveryWorkspaceRow = {
  notification_id: string;
  event_type: string;
  title: string;
  body_text: string | null;
  link_url: string | null;
  created_at: string;
  recipient_name: string | null;
  recipient_email: string | null;
  attempts: EmailDeliveryAttempt[];
};

export function useNotificationDeliveryWorkspace() {
  return useQuery({
    queryKey: ["owner-notification-delivery-workspace"],
    queryFn: async (): Promise<NotificationDeliveryWorkspaceRow[]> => {
      const { data, error } = await supabase.rpc("owner_notification_delivery_workspace");
      if (error) throw error;
      if (!Array.isArray(data)) throw new Error("Owner notification delivery access is required.");
      return data as NotificationDeliveryWorkspaceRow[];
    },
  });
}

export function useRetryNotificationEmail() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (deliveryId: string) => {
      const { data, error } = await supabase.rpc("owner_retry_notification_email", {
        p_delivery_id: deliveryId,
      });
      if (error) throw error;
      if (typeof data !== "string" || !data) throw new Error("The retry was not queued.");
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["owner-notification-delivery-workspace"] }),
  });
}
