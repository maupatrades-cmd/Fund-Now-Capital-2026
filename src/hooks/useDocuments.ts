import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { DOCUMENT_COLUMNS, type DocumentRow } from "@/hooks/useClientDocuments";

// A document plus the name of its owning entity (client XOR lead). Nullable FK
// embeds use !left so a lead-owned (client_id null) row still returns.
export type AllDocumentRow = DocumentRow & {
  client: { id: string; business_name: string } | null;
  lead: { id: string; business_name: string } | null;
};

export function owningEntityName(d: AllDocumentRow): string {
  return d.client?.business_name ?? d.lead?.business_name ?? "—";
}

// Owner-only: every CURRENT document across the CRM, for the global /documents
// page. Superseded versions are excluded here (version history lives per-entity).
export function useAllDocuments() {
  return useQuery({
    queryKey: ["all-documents"],
    queryFn: async (): Promise<AllDocumentRow[]> => {
      const { data, error } = await supabase
        .from("documents")
        .select(
          `${DOCUMENT_COLUMNS}, client:clients!left(id, business_name), lead:leads!left(id, business_name)`,
        )
        .eq("is_current_version", true)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as AllDocumentRow[];
    },
  });
}
