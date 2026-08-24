import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export type ContractorDocumentChaseItem = {
  deal_id: string;
  deal_reference: string | null;
  client_business_name: string;
  current_stage: string;
  product_name: string;
  document_type: string;
  requirement: "required" | "optional";
  client_safe_reason: string | null;
  document_status: "missing" | "submitted" | "accepted" | "rejected";
  rejection_reason: string | null;
  task_id: string | null;
  task_status: "open" | "in_progress" | "blocked" | "completed" | null;
  task_due_at: string | null;
};

const KEY = ["contractor-document-chase"] as const;

export function useContractorDocumentChase() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<ContractorDocumentChaseItem[]> => {
      const { data, error } = await supabase.rpc("contractor_document_chase_items");
      if (error) throw error;
      return (data ?? []) as ContractorDocumentChaseItem[];
    },
  });
}

export function useCreateContractorDocumentChaseTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ dealId, documentType }: { dealId: string; documentType: string }) => {
      const { data, error } = await supabase.rpc("contractor_create_document_chase_task", {
        p_deal_id: dealId,
        p_document_type: documentType,
        p_due_in_days: 2,
      });
      if (error) throw error;
      if (!data) throw new Error("The follow-up task was not created.");
      return data as string;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: KEY }),
  });
}

export function useSetContractorChaseTaskStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ taskId, status }: { taskId: string; status: "in_progress" | "completed" }) => {
      const { error } = await supabase.rpc("task_assignee_set_status", {
        p_task_id: taskId,
        p_status: status,
        p_blocker_reason: null,
      });
      if (error) throw error;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: KEY }),
  });
}
