import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { DealStage } from "@/lib/dealStages";
import { invalidateActivity } from "@/hooks/useActivity";

export function one<T>(rel: T | T[] | null): T | null {
  return Array.isArray(rel) ? (rel[0] ?? null) : (rel ?? null);
}

export type PipelineDeal = {
  id: string;
  reference: string | null;
  stage: DealStage;
  is_priority: boolean;
  amount_requested: string | null;
  gross_commission: string | null;
  stage_entered_at: string;
  created_at: string;
  referral_partner_id: string | null;
  client: { id: string; business_name: string } | { id: string; business_name: string }[] | null;
  submissions: { funder: { id: string; name: string } | { id: string; name: string }[] | null }[];
};

export function clientName(d: PipelineDeal): string {
  return one(d.client)?.business_name ?? "—";
}
export function submittedFunders(d: PipelineDeal): string[] {
  return (d.submissions ?? []).map((s) => one(s.funder)?.name).filter((n): n is string => !!n);
}
export function submittedFunderIds(d: PipelineDeal): string[] {
  return (d.submissions ?? []).map((s) => one(s.funder)?.id).filter((n): n is string => !!n);
}

export function usePipeline() {
  return useQuery({
    queryKey: ["pipeline"],
    queryFn: async (): Promise<PipelineDeal[]> => {
      const { data, error } = await supabase
        .from("deals")
        .select(
          `id, reference, stage, is_priority, amount_requested, gross_commission,
           stage_entered_at, created_at, referral_partner_id,
           client:clients(id, business_name),
           submissions:deal_funder_submissions(funder:funders(id, name))`,
        )
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as PipelineDeal[];
    },
  });
}

// Lightweight lists for the filter bar and the New Deal dialog.
export function useClientOptions() {
  return useQuery({
    queryKey: ["client-options"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("id, business_name, referral_partner_id")
        .order("business_name");
      if (error) throw error;
      return (data ?? []) as { id: string; business_name: string; referral_partner_id: string | null }[];
    },
  });
}

export function useFunderOptions() {
  return useQuery({
    queryKey: ["funder-options"],
    queryFn: async () => {
      const { data, error } = await supabase.from("funders").select("id, name").order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
  });
}

export function useCreateDeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      clientId,
      referralPartnerId,
      isPurchaseOrder,
      amountRequested,
    }: {
      clientId: string;
      referralPartnerId: string | null;
      isPurchaseOrder: boolean;
      amountRequested: number | null;
    }) => {
      const { data, error } = await supabase
        .from("deals")
        .insert({
          client_id: clientId,
          referral_partner_id: referralPartnerId,
          is_purchase_order: isPurchaseOrder,
          amount_requested: amountRequested,
          stage: "new_lead",
        })
        .select("id")
        .single();
      if (error) throw error;
      return data as { id: string };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pipeline"] });
      invalidateActivity(qc);
    },
  });
}

// Drag-and-drop stage change — optimistic so the card moves instantly.
export function useUpdateDealStage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, stage }: { id: string; stage: DealStage }) => {
      const { error } = await supabase.from("deals").update({ stage }).eq("id", id);
      if (error) throw error;
    },
    onMutate: async ({ id, stage }) => {
      await qc.cancelQueries({ queryKey: ["pipeline"] });
      const prev = qc.getQueryData<PipelineDeal[]>(["pipeline"]);
      if (prev) {
        qc.setQueryData<PipelineDeal[]>(
          ["pipeline"],
          prev.map((d) =>
            d.id === id ? { ...d, stage, stage_entered_at: new Date().toISOString() } : d,
          ),
        );
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["pipeline"], ctx.prev);
    },
    onSuccess: () => {
      // Only a successful stage change writes an activity row.
      invalidateActivity(qc);
    },
    onSettled: () => {
      // Reconcile the optimistic update on both success and rollback.
      qc.invalidateQueries({ queryKey: ["pipeline"] });
    },
  });
}

export function useToggleDealPriority() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, isPriority }: { id: string; isPriority: boolean }) => {
      const { error } = await supabase.from("deals").update({ is_priority: isPriority }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["pipeline"] });
      qc.invalidateQueries({ queryKey: ["deal", v.id] });
      invalidateActivity(qc);
    },
  });
}
