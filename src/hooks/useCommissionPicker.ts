import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/useSession";
import { invalidateActivity } from "@/hooks/useActivity";
import type { CommissionCalculation, DealCommissionState } from "@/lib/commissionPicker";

// Owner-side Commission Picker data layer. Every read/write goes through the
// PICKER-BACKEND SECURITY DEFINER RPCs (which each re-gate on is_owner()), so
// this hook never touches deal_commissions directly.
//
// POPIA cache-isolation (mirrors useProfileRole / usePortalDeals): the commission
// cache key carries the session uid, so a same-tab sign-out/sign-in as a
// different user can never surface the previous owner's commission data.

// ---- Read the current picker + lifecycle state ---------------------------
export function useCommissionPicker(dealId: string | undefined) {
  const session = useSession();
  const uid = session?.user?.id ?? null;

  return useQuery({
    queryKey: ["deal-commission", dealId, uid],
    enabled: !!dealId,
    queryFn: async (): Promise<DealCommissionState> => {
      const { data, error } = await supabase.rpc("get_deal_commission_state", {
        p_deal_id: dealId!,
      });
      if (error) throw error;
      return data as DealCommissionState;
    },
  });
}

function invalidateCommission(qc: ReturnType<typeof useQueryClient>, dealId: string) {
  // uid is part of the key; a prefix match refreshes it regardless of the uid.
  qc.invalidateQueries({ queryKey: ["deal-commission", dealId] });
  qc.invalidateQueries({ queryKey: ["deal-commission-record", dealId] });
  invalidateActivity(qc);
}

// ---- Set the initial picker (no row yet or re-pick in POTENTIAL) ----------
export function useSetCommissionPicker() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: {
      dealId: string;
      calculation: CommissionCalculation;
      estimatedGross: number;
    }) => {
      const { data, error } = await supabase.rpc("set_commission_picker", {
        p_deal_id: v.dealId,
        p_calculation: v.calculation,
        p_estimated_gross: v.estimatedGross,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, v) => invalidateCommission(qc, v.dealId),
  });
}

// ---- Edit the picker during POTENTIAL / PENDING --------------------------
export function useUpdateCommissionPicker() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: {
      dealId: string;
      calculation: CommissionCalculation;
      estimatedGross: number;
    }) => {
      const { data, error } = await supabase.rpc("update_commission_picker", {
        p_deal_id: v.dealId,
        p_calculation: v.calculation,
        p_estimated_gross: v.estimatedGross,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, v) => invalidateCommission(qc, v.dealId),
  });
}

// ---- State transitions ---------------------------------------------------
export function useTransitionToPending() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { dealId: string }) => {
      const { data, error } = await supabase.rpc("transition_to_pending", { p_deal_id: v.dealId });
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, v) => invalidateCommission(qc, v.dealId),
  });
}

export function useTransitionToLocked() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { dealId: string; actualGross: number }) => {
      const { data, error } = await supabase.rpc("transition_to_locked", {
        p_deal_id: v.dealId,
        p_actual_gross: v.actualGross,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, v) => invalidateCommission(qc, v.dealId),
  });
}

export function useUnlockCommission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { dealId: string; reason: string }) => {
      const { data, error } = await supabase.rpc("unlock_commission", {
        p_deal_id: v.dealId,
        p_reason: v.reason,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, v) => invalidateCommission(qc, v.dealId),
  });
}

// ---- Attribution dropdown options ----------------------------------------
// Owner-only surface (route is OwnerGate), so real names — no anonymisation
// (S7C anonymisation is partner-side). The referent id the tier engine expects
// differs by type: FNC_Contractor → a profiles.id (role=contractor);
// Bright_Destiny_Partner → a referral_partners.id (NOT a profile). So contractors
// come from profiles and partners from referral_partners.
export type PersonOption = { id: string; label: string };

export function useAttributionOptions() {
  const session = useSession();
  const uid = session?.user?.id ?? null;

  return useQuery({
    queryKey: ["attribution-options", uid],
    queryFn: async (): Promise<{ contractors: PersonOption[]; partners: PersonOption[] }> => {
      const [contractorsRes, partnersRes] = await Promise.all([
        supabase
          .from("profiles")
          .select("id, full_name, email")
          .eq("role", "contractor")
          .eq("is_active", true)
          .order("full_name", { ascending: true }),
        supabase
          .from("referral_partners")
          .select("id, name")
          .eq("is_active", true)
          .order("name", { ascending: true }),
      ]);
      if (contractorsRes.error) throw contractorsRes.error;
      if (partnersRes.error) throw partnersRes.error;
      return {
        contractors: (contractorsRes.data ?? []).map((r) => ({
          id: r.id as string,
          label: (r.full_name as string | null) || (r.email as string | null) || "Unnamed",
        })),
        partners: (partnersRes.data ?? []).map((r) => ({
          id: r.id as string,
          label: r.name as string,
        })),
      };
    },
  });
}

// ---- Deal attribution (deal_attributions), owner-only --------------------
// The tier engine's source of truth for who earned the deal. Read to hydrate the
// attribution section; written via set_deal_attribution.
export type DealAttribution = {
  attribution_type: string; // canonical token: Direct_FNC / FNC_Contractor / Bright_Destiny_Partner / Bright_Destiny_Sub_Agent
  attributed_to_id: string | null;
};

export function useDealAttribution(dealId: string | undefined) {
  const session = useSession();
  const uid = session?.user?.id ?? null;

  return useQuery({
    queryKey: ["deal-attribution", dealId, uid],
    enabled: !!dealId,
    queryFn: async (): Promise<DealAttribution | null> => {
      const { data, error } = await supabase
        .from("deal_attributions")
        .select("attribution_type, attributed_to_id")
        .eq("deal_id", dealId!)
        .maybeSingle();
      if (error) throw error;
      return (data as DealAttribution | null) ?? null;
    },
  });
}

// Set/update the deal's attribution via the tier-engine RPC. Immutable once the
// commission is locked or a tier record exists — the RPC raises in that case.
export function useSetDealAttribution() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { dealId: string; attributionType: string; attributedToId: string | null }) => {
      const { data, error } = await supabase.rpc("set_deal_attribution", {
        p_deal_id: v.dealId,
        p_attribution_type: v.attributionType,
        p_attributed_to_id: v.attributedToId,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["deal-attribution", v.dealId] });
      // Attribution feeds the eventual LOCK split, so refresh the tier result too.
      qc.invalidateQueries({ queryKey: ["deal-commission-record", v.dealId] });
      invalidateActivity(qc);
    },
  });
}

// ---- Resolve commission_locked_by → a display name -----------------------
export function useProfileName(id: string | null | undefined) {
  return useQuery({
    queryKey: ["profile-name", id],
    enabled: !!id,
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("full_name, email")
        .eq("id", id!)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return (data.full_name as string | null) || (data.email as string | null) || null;
    },
  });
}

// ---- Downstream tier result (commission_records), owner-only -------------
// Populated by the C2 money engine / tier engine once a deal's commission is
// processed. write_commission_record writes ONE ROW PER FUNDED SUBMISSION, so a
// deal can carry several rows (partial / multi-funder funding). We fetch every
// NON-VOID row and sum the money columns so the locked banner reflects the whole
// deal — never just the newest row, and never a voided one. Absent today (no
// genuine funding + tier engine not yet wired), so the widget degrades to an
// informational note when this returns nothing.
export type DealCommissionResult = {
  count: number;
  gross_commission: number;
  company_retention: number;
  partner_pool: number;
  partner_share: number;
  contractor_share: number;
  owner_share: number;
  // Only meaningful when every row shares the same tier band; null when rows
  // span different tiers (a single blended % would be misleading).
  tier_pct: number | null;
};

const numOr0 = (v: string | number | null | undefined): number => {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

export function useDealCommissionRecord(dealId: string | undefined, enabled: boolean) {
  const session = useSession();
  const uid = session?.user?.id ?? null;

  return useQuery({
    queryKey: ["deal-commission-record", dealId, uid],
    enabled: !!dealId && enabled,
    queryFn: async (): Promise<DealCommissionResult | null> => {
      const { data, error } = await supabase
        .from("commission_records")
        .select(
          "gross_commission, company_retention, partner_pool, partner_share, contractor_share, owner_share, tier_pct, status",
        )
        .eq("deal_id", dealId!)
        .neq("status", "void");
      if (error) throw error;
      const rows = data ?? [];
      if (rows.length === 0) return null;

      const tierPcts = new Set(rows.map((r) => numOr0(r.tier_pct as string | null)));
      return {
        count: rows.length,
        gross_commission: rows.reduce((s, r) => s + numOr0(r.gross_commission as string | null), 0),
        company_retention: rows.reduce((s, r) => s + numOr0(r.company_retention as string | null), 0),
        partner_pool: rows.reduce((s, r) => s + numOr0(r.partner_pool as string | null), 0),
        partner_share: rows.reduce((s, r) => s + numOr0(r.partner_share as string | null), 0),
        contractor_share: rows.reduce((s, r) => s + numOr0(r.contractor_share as string | null), 0),
        owner_share: rows.reduce((s, r) => s + numOr0(r.owner_share as string | null), 0),
        tier_pct: tierPcts.size === 1 ? [...tierPcts][0] : null,
      };
    },
  });
}
