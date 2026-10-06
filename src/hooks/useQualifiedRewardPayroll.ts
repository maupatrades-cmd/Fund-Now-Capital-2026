import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export type QualifiedRewardRow = {
  reward_lock_id: string;
  deal_id: string;
  lead_id: string | null;
  beneficiary_profile_id: string;
  beneficiary_name: string;
  beneficiary_role: "partner" | "contractor" | "lead_referrer";
  partner_organisation_id: string | null;
  amount: number;
  locked_at: string;
  cutoff_date: string;
  payout_date: string | null;
  batch_id: string | null;
  current_status: "locked" | "scheduled" | "held" | "released" | "paid" | "carried_forward" | "reversed";
  payment_reference: string | null;
  proof_storage_path: string | null;
  last_event_at: string | null;
};

const KEY = ["qualified-reward-payroll"] as const;

export function useQualifiedRewardPayroll() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<QualifiedRewardRow[]> => {
      const { data, error } = await supabase.rpc("qualified_reward_workspace");
      if (error) throw error;
      return (data ?? []) as QualifiedRewardRow[];
    },
  });
}

export function useScheduleQualifiedRewardBatch() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ cycleMonth, payday }: { cycleMonth: string; payday: 25 | 30 }) => {
      const { data, error } = await supabase.rpc("owner_schedule_qualified_reward_batch", {
        p_cycle_month: cycleMonth,
        p_selected_payday: payday,
        p_owner_note: null,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => client.invalidateQueries({ queryKey: KEY }),
  });
}

export function useRecordQualifiedRewardAction() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({
      rewardLockId,
      eventType,
      reason,
    }: {
      rewardLockId: string;
      eventType: "held" | "released" | "carried_forward" | "reversed";
      reason: string;
    }) => {
      const { data, error } = await supabase.rpc("owner_record_qualified_reward_action", {
        p_reward_lock_id: rewardLockId,
        p_event_type: eventType,
        p_reason: reason,
        p_idempotency_key: `${eventType}:${rewardLockId}:${crypto.randomUUID()}`,
        p_evidence: { source: "owner_reward_workspace" },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => client.invalidateQueries({ queryKey: KEY }),
  });
}

export function useMarkQualifiedRewardBatchPaid() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ batchId, reference, proofPath }: { batchId: string; reference: string; proofPath: string }) => {
      const { data, error } = await supabase.rpc("owner_mark_qualified_reward_batch_paid", {
        p_batch_id: batchId,
        p_payment_reference: reference,
        p_proof_storage_path: proofPath,
        p_owner_note: null,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => client.invalidateQueries({ queryKey: KEY }),
  });
}
