import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

// Files report + R100 chooser (owner, 20 Nov 2026; 20261119121000). Owner-only: every RPC refuses anyone else.
// Money comes from the server (numeric(14,2) as strings/numbers); nothing is computed client-side except display totals.

export type FilesReportRow = {
  deal_id: string | null; lead_id: string | null; client_id: string | null; deal_reference: string | null;
  business_name: string; stage: string | null; in_credit: boolean | null;
  reached_submitted_at: string | null; reached_in_credit_at: string | null;
  captured_by: string | null; handler: string | null; source: string | null;
  r29: { handler: string; counts_in_month: boolean; rate: number; signed_off: boolean; on_payslip: boolean } | null;
  r100: {
    id: string; beneficiary: string; kind: "agent" | "staff" | "outside"; amount: number; path: string;
    status: "paid" | "on_payslip" | "to_pay"; paid_on: string | null; paid_reference: string | null;
  } | null;
};
export type FilesReport = {
  month: string; stage: string; rows: FilesReportRow[]; r29_rate: number; r29_count: number; r29_total: number;
  r100_count: number; r100_total: number;
};
export type StageFilter = "all" | "submitted" | "in_credit" | "later";
export type FileHit = { kind: "deal" | "lead" | "client"; deal_id: string | null; lead_id: string | null; client_id: string | null; label: string; detail: string };
export type PersonHit = { profile_id: string; name: string; role: string; kind: "agent" | "staff" };

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
}

export function useFilesReport(month: string, stage: StageFilter) {
  return useQuery({
    queryKey: ["files-report", month, stage],
    queryFn: () => rpc<FilesReport>("owner_files_report", { p_month: month, p_stage: stage }),
  });
}

export function useFileSearch(query: string) {
  return useQuery({
    queryKey: ["file-search", query], enabled: query.trim().length >= 2,
    queryFn: () => rpc<FileHit[]>("owner_file_search", { p_query: query }),
  });
}

export function usePeopleSearch(query: string) {
  return useQuery({
    queryKey: ["reward-people-search", query], enabled: query.trim().length >= 2,
    queryFn: () => rpc<PersonHit[]>("owner_reward_people_search", { p_query: query }),
  });
}

export function useSetFileReward() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (i: { file: FileHit; profileId: string | null; name: string | null; reason: string }) => {
      const id = await rpc<string>("owner_set_file_reward", {
        p_deal_id: i.file.kind === "deal" ? i.file.deal_id : null,
        p_lead_id: i.file.kind === "lead" ? i.file.lead_id : null,
        p_client_id: i.file.kind === "client" ? i.file.client_id : null,
        p_beneficiary_profile_id: i.profileId, p_beneficiary_name: i.name, p_reason: i.reason || null,
      });
      if (!id) throw new Error("The R100 choice did not save");
      return id;
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["files-report"] }); },
  });
}

export function useMarkFileRewardPaid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (i: { id: string; paidOn: string; reference: string }) => {
      const id = await rpc<string>("owner_mark_file_reward_paid", { p_id: i.id, p_paid_on: i.paidOn, p_reference: i.reference });
      if (!id) throw new Error("Marking it paid did not save");
      return id;
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["files-report"] }); },
  });
}
