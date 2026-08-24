import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { DocumentType } from "@/lib/documents";

export type DealDocumentTaskEvidence = {
  deal_id: string;
  document_type: DocumentType;
  requirement: "required" | "optional" | "waived";
  document_status: "missing" | "submitted" | "rejected" | "accepted" | "waived";
  is_submission_blocker: boolean;
  blocking_reason: string | null;
  task_id: string | null;
  assigned_to: string | null;
};

export function useDealDocumentTaskEvidence(dealId?: string) {
  return useQuery({
    queryKey: ["deal-document-task-evidence", dealId],
    enabled: Boolean(dealId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("deal_document_task_evidence")
        .select("deal_id,document_type,requirement,document_status,is_submission_blocker,blocking_reason,task_id,assigned_to")
        .eq("deal_id", dealId!);
      if (error) throw error;
      return (data ?? []) as DealDocumentTaskEvidence[];
    },
  });
}
