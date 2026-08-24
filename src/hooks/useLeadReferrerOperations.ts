import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/useSession";
import type { PortalDealRow } from "@/hooks/usePortalDeals";

export type LeadReferrerLeadRow = {
  id: string;
  business_name: string;
  contact_name: string;
  funding_amount: string | null;
  qualification_stage: string;
  created_at: string;
};

export function useLeadReferrerLeads() {
  const uid = useSession()?.user.id ?? null;
  const query = useQuery({
    queryKey: ["lead-referrer", "operational-leads", uid],
    enabled: uid !== null,
    queryFn: async (): Promise<LeadReferrerLeadRow[]> => {
      const { data, error } = await supabase
        .from("leads")
        .select("id, business_name, contact_name, funding_amount, qualification_stage, created_at")
        .or(`attributed_to_lead_referrer_id.eq.${uid},sourced_by_lead_refer_id.eq.${uid}`)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as LeadReferrerLeadRow[];
    },
  });
  return { ...query, isLoading: query.isLoading || uid === null };
}

export function useLeadReferrerDeals() {
  const uid = useSession()?.user.id ?? null;
  const query = useQuery({
    queryKey: ["lead-referrer", "operational-deals", uid],
    enabled: uid !== null,
    queryFn: async (): Promise<PortalDealRow[]> => {
      const { data, error } = await supabase.rpc("lead_referrer_list_own_deals");
      if (error) throw error;
      return (data ?? []) as PortalDealRow[];
    },
  });
  return { ...query, isLoading: query.isLoading || uid === null };
}
