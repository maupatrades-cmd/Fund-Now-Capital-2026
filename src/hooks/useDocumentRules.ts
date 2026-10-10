import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

// Owner-only. The per-product required-documents lists that gate "Complete" on a file.
export type DocumentRuleRow = {
  product_code: string;
  document_type: string;
  requirement: "required" | "optional" | "waived";
  is_active: boolean;
  // True while the row is the unconfirmed SC1 draft: loaded from the blueprint, not yet enforced.
  is_draft: boolean;
};

const KEY = ["owner-document-rules"];

export function useOwnerDocumentRules() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<DocumentRuleRow[]> => {
      const { data, error } = await supabase.rpc("owner_list_document_rules");
      if (error) throw new Error(error.message || "Could not load the document lists.");
      return (data ?? []) as DocumentRuleRow[];
    },
  });
}

export function useConfirmDocumentRules() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (productCode: string) => {
      const { data, error } = await supabase.rpc("owner_confirm_document_rules", { p_product_code: productCode });
      if (error) throw new Error(error.message || "Could not confirm the list.");
      return data as number;
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: KEY }); },
  });
}

export function useSetDocumentRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (i: { productCode: string; documentType: string; requirement: DocumentRuleRow["requirement"] }) => {
      const { error } = await supabase.rpc("owner_set_document_rule", {
        p_product_code: i.productCode, p_document_type: i.documentType, p_requirement: i.requirement,
      });
      if (error) throw new Error(error.message || "Could not save the change.");
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: KEY }); },
  });
}
