import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Notification } from "@/lib/notifications";

const RECENT_LIMIT = 10;
export const NOTIFICATIONS_LIST_LIMIT = 200;

// RLS returns only the caller's own rows, so no user filter is needed here.
export function useUnreadCount() {
  return useQuery({
    queryKey: ["notifications", "unread-count"],
    queryFn: async (): Promise<number> => {
      const { count, error } = await supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("read_status", false);
      if (error) throw error;
      return count ?? 0;
    },
  });
}

export function useRecentNotifications() {
  return useQuery({
    queryKey: ["notifications", "recent"],
    queryFn: async (): Promise<Notification[]> => {
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(RECENT_LIMIT);
      if (error) throw error;
      return (data ?? []) as Notification[];
    },
  });
}

export type NotificationFilters = {
  from?: string;
  to?: string;
  eventType?: string;
  read?: "read" | "unread";
  search?: string;
};

export function useNotificationList(filters: NotificationFilters) {
  return useQuery({
    queryKey: ["notifications", "list", filters],
    queryFn: async (): Promise<Notification[]> => {
      let q = supabase
        .from("notifications")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(NOTIFICATIONS_LIST_LIMIT);

      if (filters.from) q = q.gte("created_at", filters.from);
      if (filters.to) q = q.lte("created_at", `${filters.to}T23:59:59.999Z`);
      if (filters.eventType) q = q.eq("event_type", filters.eventType);
      if (filters.read === "read") q = q.eq("read_status", true);
      if (filters.read === "unread") q = q.eq("read_status", false);
      if (filters.search) {
        const s = filters.search.replace(/[%,]/g, " ");
        q = q.or(`title.ilike.%${s}%,body_text.ilike.%${s}%`);
      }

      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Notification[];
    },
  });
}

function useInvalidateNotifications() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["notifications"] });
}

export function useMarkNotificationRead() {
  const invalidate = useInvalidateNotifications();
  return useMutation({
    mutationFn: async (id: string) => {
      // RPC returns the updated id, or null if nothing was written (wrong owner /
      // missing row). A null with no error is a silent failure — surface it.
      const { data, error } = await supabase.rpc("mark_notification_read", { p_id: id });
      if (error) throw error;
      if (!data) throw new Error("Notification was not updated");
    },
    onSuccess: invalidate,
  });
}

export function useMarkNotificationsRead() {
  const invalidate = useInvalidateNotifications();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      // RPC returns the number of rows updated. Any mismatch from the requested
      // count — total no-op or a partial ownership/RLS mismatch on a subset —
      // means not everything was written, so surface it rather than assume success.
      const { data, error } = await supabase.rpc("mark_notifications_read", { p_ids: ids });
      if (error) throw error;
      if (ids.length > 0 && data !== ids.length) throw new Error("Notifications were not updated");
    },
    onSuccess: invalidate,
  });
}

export function useMarkAllNotificationsRead() {
  const invalidate = useInvalidateNotifications();
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("mark_all_notifications_read");
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

// Live badge: subscribe to this user's notification row changes and refresh the
// notification queries whenever one is inserted or updated.
export function useNotificationsRealtime(userId: string | undefined) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        () => qc.invalidateQueries({ queryKey: ["notifications"] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, qc]);
}
