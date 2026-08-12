import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { one } from "@/hooks/useDeals";
import { invalidateActivity } from "@/hooks/useActivity";
import type { DealStage } from "@/lib/dealStages";

export type Deal = {
  id: string;
  reference: string | null;
  client_id: string;
  referral_partner_id: string | null;
  stage: DealStage;
  is_purchase_order: boolean;
  is_priority: boolean;
  amount_requested: string | null;
  gross_commission: string | null;
  awarded_funder_id: string | null;
  declined_reason: string | null;
  notes: string | null;
  stage_entered_at: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  archived_by: string | null;
  archive_reason: string | null;
  client: { id: string; business_name: string; referral_partner_id: string | null } | { id: string; business_name: string; referral_partner_id: string | null }[] | null;
};

export function useDeal(id: string | undefined) {
  return useQuery({
    queryKey: ["deal", id],
    enabled: !!id,
    queryFn: async (): Promise<Deal> => {
      const { data, error } = await supabase
        .from("deals")
        .select("*, client:clients(id, business_name, referral_partner_id)")
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data as Deal;
    },
  });
}

export function useSetDealArchived() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, archived, reason }: { id: string; archived: boolean; reason?: string }) => {
      const { data, error } = await supabase.rpc("owner_set_deal_archived", {
        p_deal_id: id,
        p_archived: archived,
        p_reason: reason ?? null,
      });
      if (error) throw error;
      if (!data) throw new Error("Deal archive state was not changed.");
    },
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ["deal", vars.id] });
      void qc.invalidateQueries({ queryKey: ["pipeline"] });
      void qc.invalidateQueries({ queryKey: ["archived-deals"] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
      void qc.invalidateQueries({ queryKey: ["portal-deals"] });
      invalidateActivity(qc);
    },
  });
}

export function useUpdateDeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: Record<string, unknown> }) => {
      // RETURNING id + row-count check — an RLS-filtered / no-op update otherwise
      // resolves "successfully" (silent-RLS rule), which would e.g. fire a
      // "Funded!" celebration for a stage change that never happened.
      const { data, error } = await supabase.from("deals").update(input).eq("id", id).select("id");
      if (error) throw error;
      if (!data || data.length !== 1) throw new Error("Deal was not updated (no row written).");
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["deal", v.id] });
      qc.invalidateQueries({ queryKey: ["pipeline"] });
      invalidateActivity(qc);
    },
  });
}

// Deliberate revival of a declined deal — goes through the reopen_deal()
// database function (the only way past the terminal-stage trigger).
export function useReopenDeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, stage }: { id: string; stage: DealStage }) => {
      const { error } = await supabase.rpc("reopen_deal", {
        p_deal_id: id,
        p_stage: stage,
      });
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["deal", v.id] });
      qc.invalidateQueries({ queryKey: ["deal-stage-history", v.id] });
      qc.invalidateQueries({ queryKey: ["pipeline"] });
      invalidateActivity(qc);
    },
  });
}

// ---- Funder submissions --------------------------------------------------
export type DealSubmission = {
  id: string;
  deal_id: string;
  funder_id: string;
  status: string;
  submitted_at: string | null;
  responded_at: string | null;
  quote_amount: string | null;
  offered_commission: string | null;
  amount_funded: string | null;
  finance_charge_amount: string | null;
  approved_at: string | null;
  funded_at: string | null;
  notes: string | null;
  // Owner-only decline detail. decline_reason_category is partner-safe (shown in
  // the Phase-D portal); decline_notes_internal is never exposed to partners.
  decline_reason_category: string | null;
  decline_notes_internal: string | null;
  created_at: string;
  funder: { id: string; name: string } | { id: string; name: string }[] | null;
};

export type SubmissionInput = {
  funder_id: string;
  status: string;
  submitted_at: string | null;
  quote_amount: number | null;
  offered_commission: number | null;
  notes: string | null;
  decline_reason_category: string | null;
  decline_notes_internal: string | null;
};

export function funderName(s: DealSubmission): string {
  return one(s.funder)?.name ?? "Unknown funder";
}

export function useDealSubmissions(dealId: string | undefined) {
  return useQuery({
    queryKey: ["deal-submissions", dealId],
    enabled: !!dealId,
    queryFn: async (): Promise<DealSubmission[]> => {
      const { data, error } = await supabase
        .from("deal_funder_submissions")
        .select("*, funder:funders(id, name)")
        .eq("deal_id", dealId!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as DealSubmission[];
    },
  });
}

export function useSaveSubmission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      dealId,
      submissionId,
      input,
    }: {
      dealId: string;
      submissionId?: string;
      input: SubmissionInput;
    }) => {
      if (submissionId) {
        const { error } = await supabase
          .from("deal_funder_submissions")
          .update(input)
          .eq("id", submissionId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("deal_funder_submissions")
          .insert({ ...input, deal_id: dealId });
        if (error) throw error;
      }
    },
    onSuccess: (_d, v) => {
      // The pipeline cards embed submissions, so keep that cache fresh too.
      qc.invalidateQueries({ queryKey: ["deal-submissions", v.dealId] });
      qc.invalidateQueries({ queryKey: ["pipeline"] });
      invalidateActivity(qc);
    },
  });
}

export function useDeleteSubmission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string; dealId: string }) => {
      const { error } = await supabase.from("deal_funder_submissions").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["deal-submissions", v.dealId] });
      qc.invalidateQueries({ queryKey: ["pipeline"] });
      invalidateActivity(qc);
    },
  });
}

export function useRecordSubmissionFunding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      dealId,
      submissionId,
      funderId,
      dealStage,
      amountFunded,
      fundedAt,
      financeCharge,
    }: {
      dealId: string;
      submissionId: string;
      funderId: string;
      dealStage: DealStage;
      amountFunded: number;
      fundedAt: string;
      financeCharge: number | null;
    }) => {
      const { data: submissionRows, error: submissionError } = await supabase
        .from("deal_funder_submissions")
        .update({
          status: "funded",
          amount_funded: amountFunded,
          funded_at: fundedAt,
          finance_charge_amount: financeCharge,
        })
        .eq("id", submissionId)
        .eq("deal_id", dealId)
        .is("amount_funded", null)
        .select("id");
      if (submissionError) throw submissionError;
      if (!submissionRows || submissionRows.length !== 1) {
        // A prior attempt may have recorded the submission before a later deal
        // update failed. Permit an exact retry, but never overwrite different
        // financial facts.
        const { data: existing, error: existingError } = await supabase
          .from("deal_funder_submissions")
          .select("amount_funded, funded_at")
          .eq("id", submissionId)
          .eq("deal_id", dealId)
          .single();
        if (existingError) throw existingError;
        const exactRetry =
          Number(existing.amount_funded) === amountFunded &&
          existing.funded_at === fundedAt;
        if (!exactRetry) {
          throw new Error("Funding was already recorded or the submission could not be updated.");
        }
      }

      // Never regress an invoiced deal. Earlier stages advance to Funded when
      // the actual disbursement is recorded.
      if (dealStage !== "funded" && dealStage !== "invoiced") {
        const { data: dealRows, error: dealError } = await supabase
          .from("deals")
          .update({ stage: "funded", awarded_funder_id: funderId })
          .eq("id", dealId)
          .select("id");
        if (dealError) throw dealError;
        if (!dealRows || dealRows.length !== 1) {
          throw new Error("Funding was recorded, but the deal could not be moved to Funded. Refresh and retry.");
        }
      }
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["deal-submissions", vars.dealId] });
      qc.invalidateQueries({ queryKey: ["fundable-submissions", vars.dealId] });
      qc.invalidateQueries({ queryKey: ["deal-invoices", vars.dealId] });
      qc.invalidateQueries({ queryKey: ["deal", vars.dealId] });
      qc.invalidateQueries({ queryKey: ["pipeline"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      invalidateActivity(qc);
    },
  });
}

// ---- Communications ------------------------------------------------------
export type Communication = {
  id: string;
  channel: string;
  direction: string | null;
  subject: string | null;
  body: string | null;
  occurred_at: string;
};

export function useDealCommunications(dealId: string | undefined) {
  return useQuery({
    queryKey: ["deal-communications", dealId],
    enabled: !!dealId,
    queryFn: async (): Promise<Communication[]> => {
      const { data, error } = await supabase
        .from("communications")
        .select("id, channel, direction, subject, body, occurred_at")
        .eq("deal_id", dealId!)
        .order("occurred_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Communication[];
    },
  });
}

export function useAddCommunication() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      dealId,
      clientId,
      referralPartnerId,
      channel,
      subject,
      body,
    }: {
      dealId: string;
      clientId: string | null;
      referralPartnerId: string | null;
      channel: string;
      subject: string;
      body: string;
    }) => {
      const uid = (await supabase.auth.getUser()).data.user?.id ?? null;
      const { error } = await supabase.from("communications").insert({
        deal_id: dealId,
        client_id: clientId,
        referral_partner_id: referralPartnerId,
        channel,
        subject: subject || null,
        body: body || null,
        created_by: uid,
      });
      if (error) throw error;
    },
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ["deal-communications", v.dealId] }),
  });
}

// Client-portal conversations are deliberately separate from the internal
// communications log above. Only messages explicitly written to the portal
// are returned here; funder/internal notes cannot enter this result shape.
export type OwnerPortalMessageThread = {
  id: string;
  subject: string;
  status: "open" | "closed";
  updated_at: string;
  client_portal_messages: {
    id: string;
    sender_kind: "client" | "owner";
    body: string;
    created_at: string;
  }[];
};

export function useDealPortalMessages(dealId: string | undefined) {
  return useQuery({
    queryKey: ["deal-portal-messages", dealId],
    enabled: !!dealId,
    queryFn: async (): Promise<OwnerPortalMessageThread[]> => {
      const { data, error } = await supabase
        .from("client_message_threads")
        .select("id,subject,status,updated_at,client_portal_messages(id,sender_kind,body,created_at)")
        .eq("deal_id", dealId!)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as OwnerPortalMessageThread[];
    },
  });
}

export function useReplyToClientPortalMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ threadId, body }: { threadId: string; body: string; dealId: string }) => {
      const { error } = await supabase.rpc("owner_send_client_portal_message", {
        p_thread_id: threadId,
        p_body: body,
      });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: ["deal-portal-messages", variables.dealId] });
    },
  });
}

// ---- Stage history -------------------------------------------------------
export type StageHistoryRow = {
  id: string;
  from_stage: string | null;
  to_stage: string;
  changed_at: string;
};

export function useDealStageHistory(dealId: string | undefined) {
  return useQuery({
    queryKey: ["deal-stage-history", dealId],
    enabled: !!dealId,
    queryFn: async (): Promise<StageHistoryRow[]> => {
      const { data, error } = await supabase
        .from("deal_stage_history")
        .select("id, from_stage, to_stage, changed_at")
        .eq("deal_id", dealId!)
        .order("changed_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as StageHistoryRow[];
    },
  });
}

// ---- Commission calculator (server-side database function) ---------------
export type CommissionBreakdown = {
  tier_pct: number;
  company_retention: number;
  partner_pool: number;
  partner_share: number;
  owner_share: number;
};

export function useCalculateCommission(gross: number | null, isPurchaseOrder: boolean) {
  return useQuery({
    queryKey: ["commission", gross, isPurchaseOrder],
    enabled: gross != null && gross > 0,
    queryFn: async (): Promise<CommissionBreakdown> => {
      const { data, error } = await supabase.rpc("calculate_commission", {
        gross_commission: gross,
        is_purchase_order: isPurchaseOrder,
      });
      if (error) throw error;
      // PostgREST returns the composite as an object (or a 1-row array).
      const row = Array.isArray(data) ? data[0] : data;
      return row as CommissionBreakdown;
    },
  });
}
