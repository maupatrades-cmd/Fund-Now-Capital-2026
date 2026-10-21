import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/lib/useSession";
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

// Whether the signed-in person can be paid yet: R100 is not payable before the Agent Code (after a cleared iFacts check).
export function useMyRewardGate() {
  const uid = useSession()?.user.id;
  return useQuery({
    queryKey: ["my-reward-gate", uid],
    enabled: Boolean(uid),
    queryFn: async (): Promise<{ cleared: boolean; agent_code: string | null }> => {
      const { data, error } = await supabase.rpc("my_reward_gate");
      if (error) throw error;
      return data as { cleared: boolean; agent_code: string | null };
    },
  });
}

export function useQualifiedRewardPayroll() {
  const uid = useSession()?.user.id;
  return useQuery({
    queryKey: [...KEY, uid],
    enabled: Boolean(uid),
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
    mutationFn: async ({ cycleMonth }: { cycleMonth: string }) => {
      const { data, error } = await supabase.rpc("owner_schedule_qualified_reward_batch", {
        p_cycle_month: cycleMonth,
        p_selected_payday: 15,
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
      idempotencyKey,
    }: {
      rewardLockId: string;
      eventType: "held" | "released" | "carried_forward" | "reversed";
      reason: string;
      idempotencyKey: string;
    }) => {
      const { data, error } = await supabase.rpc("owner_record_qualified_reward_action", {
        p_reward_lock_id: rewardLockId,
        p_event_type: eventType,
        p_reason: reason,
        p_idempotency_key: idempotencyKey,
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

// Agent Codes (issued by the Director once iFacts has cleared). R100 lines are only scheduled for cleared agents.
export type AgentClearance = { profile_id: string; full_name: string | null; role: string; agent_code: string; ifacts_cleared_on: string; set_at: string };
export function useAgentClearances(enabled: boolean) {
  return useQuery({
    queryKey: ["agent-clearances"],
    enabled,
    queryFn: async (): Promise<AgentClearance[]> => {
      const { data, error } = await supabase.rpc("agent_clearances_list");
      if (error) throw error;
      return (data ?? []) as AgentClearance[];
    },
  });
}
export function useIssueAgentCode() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ profileId, agentCode, clearedOn }: { profileId: string; agentCode: string; clearedOn: string }) => {
      const { data, error } = await supabase.rpc("owner_issue_agent_code", {
        p_profile: profileId, p_agent_code: agentCode, p_ifacts_cleared_on: clearedOn,
      });
      if (error) throw error;
      if (!data) throw new Error("The Agent Code was not saved");
      return data as string;
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ["agent-clearances"] }),
  });
}
