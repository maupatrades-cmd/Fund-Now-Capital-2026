import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { PortalKind } from "@/components/portal/PortalShell";

/*
 * The submitter's own DEALS (partner or contractor) — the deals that grew out
 * of the leads they referred. Read-only. Backed by the SECURITY DEFINER RPCs
 * partner_list_own_deals() / contractor_list_own_deals(), which filter strictly
 * on auth.uid() through the lead's attribution, so a partner never sees a
 * contractor's deals and vice-versa (POPIA). Funder identity is already
 * anonymised server-side (fictional name only).
 *
 * No earnings/commission columns are returned or shown here — that surface
 * arrives in a follow-up PR after the commission backend merges.
 */

const RPC_FOR: Record<PortalKind, "partner_list_own_deals" | "contractor_list_own_deals"> = {
  partner: "partner_list_own_deals",
  contractor: "contractor_list_own_deals",
};

export type PortalDealRow = {
  deal_id: string;
  deal_reference: string | null;
  client_business_name: string;
  current_stage: string;
  anonymized_funder_name: string | null;
  submitted_at: string;
};

export function usePortalDeals(portal: PortalKind) {
  return useQuery({
    queryKey: ["portal-deals", portal],
    queryFn: async (): Promise<PortalDealRow[]> => {
      const { data, error } = await supabase.rpc(RPC_FOR[portal]);
      if (error) throw error;
      return (data ?? []) as PortalDealRow[];
    },
  });
}

// Submitter-facing status derived from the owner's 15-stage deal pipeline. The
// partner/contractor sees a simple 6-state view, not the owner's internal
// vocabulary — mirrors the leadStatus() treatment in usePortalLeads.
export type PortalDealStatus =
  | "New"
  | "Qualified"
  | "Submitted"
  | "Approved"
  | "Funded"
  | "Declined";

export function dealStatus(stage: string): PortalDealStatus {
  switch (stage) {
    case "declined":
      return "Declined";
    case "funded":
    case "invoiced":
    case "commission_paid":
      return "Funded";
    case "approved_quote_received":
    case "client_deciding":
    case "verification_kyc":
    case "contract_signed":
    case "advance_pending":
      return "Approved";
    case "submitted":
    case "in_credit":
      return "Submitted";
    case "qualifying":
    case "document_collection":
    case "deal_review":
      return "Qualified";
    case "new_lead":
      return "New";
    default:
      return "New";
  }
}

export const DEAL_STATUS_BADGE: Record<PortalDealStatus, string> = {
  New: "bg-slate-100 text-slate-600 ring-slate-500/20",
  Qualified: "bg-indigo-50 text-indigo-700 ring-indigo-600/20",
  Submitted: "bg-blue-50 text-blue-700 ring-blue-600/20",
  Approved: "bg-teal-50 text-teal-700 ring-teal-600/20",
  Funded: "bg-green-50 text-green-700 ring-green-600/20",
  Declined: "bg-red-50 text-red-700 ring-red-600/20",
};
