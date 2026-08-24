import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export type PartnerSubagentOperation = {
  membership_id: string;
  lead_referrer_profile_id: string;
  lead_referrer_name: string;
  referral_partner_id: string;
  referral_partner_name: string;
  membership_status: "invited" | "active" | "suspended" | "ended";
  profile_is_active: boolean;
  joined_at: string;
  membership_updated_at: string;
  captured_lead_count: number;
  deal_count: number;
  last_activity_type: string | null;
  last_activity_at: string | null;
};

export function usePartnerSubagentOperations() {
  return useQuery({
    queryKey: ["partner-subagent-operations"],
    staleTime: 60_000,
    queryFn: async (): Promise<PartnerSubagentOperation[]> => {
      const { data, error } = await supabase.rpc("list_partner_subagent_operations");
      if (error) throw error;

      return ((data ?? []) as PartnerSubagentOperation[]).map((row) => ({
        ...row,
        captured_lead_count: Number(row.captured_lead_count ?? 0),
        deal_count: Number(row.deal_count ?? 0),
      }));
    },
  });
}
