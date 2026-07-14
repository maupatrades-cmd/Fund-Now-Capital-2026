import { useQuery, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { ActivityLog } from "@/lib/activity";

// Cap on rows fetched in one page — surfaced to the user when hit.
export const ACTIVITY_FEED_LIMIT = 500;
const ENTITY_LIMIT = 200;

// Activity rows are written by DB triggers as a side effect of other mutations,
// so those mutations can't know an audit row appeared. Any mutation that writes
// to a trigger-backed table (deals, deal_funder_submissions, clients,
// client_contacts, commission_records) must call this in onSuccess/onSettled so
// the entity feeds and the /activity timeline refetch instead of showing a
// stale snapshot taken before the change.
export function invalidateActivity(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ["activity-entity"] });
  qc.invalidateQueries({ queryKey: ["activity-feed"] });
}

// Activity for a single entity: the entity's own log rows PLUS rows that
// reference it via related_entity_ids (a deal picks up its submissions; a
// client picks up its deals + contacts). Two queries merged client-side to
// avoid brittle PostgREST or/jsonb-containment string building.
export function useEntityActivity(entityId: string | undefined) {
  return useQuery({
    queryKey: ["activity-entity", entityId],
    enabled: !!entityId,
    queryFn: async (): Promise<ActivityLog[]> => {
      const [own, related] = await Promise.all([
        supabase
          .from("activity_logs")
          .select("*")
          .eq("entity_id", entityId!)
          .order("occurred_at", { ascending: false })
          .limit(ENTITY_LIMIT),
        supabase
          .from("activity_logs")
          .select("*")
          // related_entity_ids is jsonb, so containment needs a JSON string
          // ('["uuid"]'), not a JS array (which serialises to a {..} array literal).
          .contains("related_entity_ids", JSON.stringify([entityId!]))
          .order("occurred_at", { ascending: false })
          .limit(ENTITY_LIMIT),
      ]);
      if (own.error) throw own.error;
      if (related.error) throw related.error;

      const byId = new Map<string, ActivityLog>();
      for (const r of [...(own.data ?? []), ...(related.data ?? [])]) {
        byId.set(r.id, r as ActivityLog);
      }
      return [...byId.values()].sort((a, b) =>
        b.occurred_at.localeCompare(a.occurred_at),
      );
    },
  });
}

export type ActivityFilters = {
  from?: string; // ISO date (inclusive)
  to?: string; // ISO date (inclusive end-of-day)
  userId?: string;
  eventType?: string;
  entityType?: string;
  search?: string;
};

// Global chronological timeline for the /activity screen, with filters.
export function useActivityFeed(filters: ActivityFilters) {
  return useQuery({
    queryKey: ["activity-feed", filters],
    queryFn: async (): Promise<ActivityLog[]> => {
      let q = supabase
        .from("activity_logs")
        .select("*")
        .order("occurred_at", { ascending: false })
        .limit(ACTIVITY_FEED_LIMIT);

      if (filters.from) q = q.gte("occurred_at", filters.from);
      if (filters.to) q = q.lte("occurred_at", `${filters.to}T23:59:59.999Z`);
      if (filters.userId) q = q.eq("user_id", filters.userId);
      if (filters.eventType) q = q.eq("event_type", filters.eventType);
      if (filters.entityType) q = q.eq("entity_type", filters.entityType);
      if (filters.search) q = q.ilike("description", `%${filters.search}%`);

      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as ActivityLog[];
    },
  });
}

// Users for the timeline's "user" filter (owner can read all profiles).
export function useActivityUsers() {
  return useQuery({
    queryKey: ["activity-users"],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<{ id: string; email: string | null }[]> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, email")
        .order("email");
      if (error) throw error;
      return (data ?? []) as { id: string; email: string | null }[];
    },
  });
}
