import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export type SearchResult = { id: string; label: string; kind: "Client" | "Lead" | "Deal" | "Funder"; to: string };

export function useGlobalSearch(term: string) {
  const query = term.trim();
  return useQuery({
    queryKey: ["global-search", query],
    enabled: query.length >= 2,
    staleTime: 30_000,
    queryFn: async (): Promise<SearchResult[]> => {
      const sanitizedQuery = query.replace(/[%_\\]/g, "").trim();
      if (sanitizedQuery.length < 2) return [];
      const pattern = `%${sanitizedQuery}%`;
      const [clients, leads, deals, funders] = await Promise.all([
        supabase.from("clients").select("id,business_name").ilike("business_name", pattern).limit(5),
        supabase.from("leads").select("id,business_name").ilike("business_name", pattern).limit(5),
        supabase.from("deals").select("id,reference").ilike("reference", pattern).limit(5),
        supabase.from("funders").select("id,name").ilike("name", pattern).limit(5),
      ]);
      const error = clients.error || leads.error || deals.error || funders.error;
      if (error) throw error;
      return [
        ...(clients.data ?? []).map((row) => ({ id: row.id, label: row.business_name, kind: "Client" as const, to: `/clients/${row.id}` })),
        ...(leads.data ?? []).map((row) => ({ id: row.id, label: row.business_name, kind: "Lead" as const, to: `/leads/${row.id}` })),
        ...(deals.data ?? []).map((row) => ({ id: row.id, label: row.reference ?? "Deal", kind: "Deal" as const, to: `/deals/${row.id}` })),
        ...(funders.data ?? []).map((row) => ({ id: row.id, label: row.name, kind: "Funder" as const, to: `/funders/${row.id}` })),
      ];
    },
  });
}
