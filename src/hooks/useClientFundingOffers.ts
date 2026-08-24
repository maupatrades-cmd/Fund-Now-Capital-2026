import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { invalidateActivity } from "@/hooks/useActivity";

export type ClientFundingOffer = {
  id: string;
  deal_id: string;
  deal_reference: string | null;
  funder_label: string;
  offer_amount: number;
  term_months: number | null;
  repayment_frequency: string | null;
  repayment_amount: number | null;
  total_repayment: number | null;
  fees_summary: string | null;
  conditions_summary: string | null;
  valid_until: string | null;
  published_at: string;
  evidence_document_id: string;
  decision: "accepted" | "declined" | null;
  decision_reason: string | null;
  decided_at: string | null;
};

export type OwnerOffer = {
  id: string; state: "draft" | "published" | "withdrawn"; client_funder_label: string;
  offer_amount: string; term_months: number | null; valid_until: string | null; published_at: string | null;
};

export function useClientFundingOfferWorkspace() {
  return useQuery({
    queryKey: ["client-funding-offer-workspace"],
    queryFn: async (): Promise<ClientFundingOffer[]> => {
      const { data, error } = await supabase.rpc("client_funding_offer_workspace");
      if (error) throw error;
      const value = data as { offers?: ClientFundingOffer[] } | null;
      return Array.isArray(value?.offers) ? value.offers : [];
    },
  });
}

export function useClientDecideFundingOffer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ offerId, decision, reason }: { offerId: string; decision: "accepted" | "declined"; reason?: string }) => {
      const { error } = await supabase.rpc("client_decide_funding_offer", { p_offer_id: offerId, p_decision: decision, p_reason: reason?.trim() || null });
      if (error) throw error;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["client-funding-offer-workspace"] }),
  });
}

export function useOwnerFundingOffers(dealId: string) {
  return useQuery({
    queryKey: ["owner-funding-offers", dealId],
    queryFn: async (): Promise<OwnerOffer[]> => {
      const { data, error } = await supabase.from("client_funding_offers")
        .select("id,state,client_funder_label,offer_amount,term_months,valid_until,published_at")
        .eq("deal_id", dealId).order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as OwnerOffer[];
    },
  });
}

export function useOwnerCreateFundingOffer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Record<string, unknown> & { p_deal_id: string }) => {
      const { data, error } = await supabase.rpc("owner_create_client_funding_offer", input);
      if (error) throw error;
      return data as string;
    },
    onSuccess: (_data, input) => { void qc.invalidateQueries({ queryKey: ["owner-funding-offers", input.p_deal_id] }); invalidateActivity(qc); },
  });
}

export function useOwnerPublishFundingOffer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ offerId }: { offerId: string; dealId: string }) => {
      const { error } = await supabase.rpc("owner_publish_client_funding_offer", { p_offer_id: offerId });
      if (error) throw error;
    },
    onSuccess: (_data, input) => { void qc.invalidateQueries({ queryKey: ["owner-funding-offers", input.dealId] }); invalidateActivity(qc); },
  });
}
