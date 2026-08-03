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

// ---- Attribution dropdown options (active contractors / partners) --------
// profiles is owner-readable via RLS. Owner-only surface (route is OwnerGate),
// so this reads real names — no anonymisation (S7C anonymisation is partner-side).
export type PersonOption = { id: string; label: string };

export function useAttributionOptions() {
  const session = useSession();
  const uid = session?.user?.id ?? null;

  return useQuery({
    queryKey: ["attribution-options", uid],
    queryFn: async (): Promise<{ contractors: PersonOption[]; partners: PersonOption[] }> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email, role, is_active")
        .in("role", ["contractor", "partner"])
        .eq("is_active", true)
        .order("full_name", { ascending: true });
      if (error) throw error;
      const toOption = (r: Record<string, unknown>): PersonOption => ({
        id: r.id as string,
        label: (r.full_name as string | null) || (r.email as string | null) || "Unnamed",
      });
      const rows = data ?? [];
      return {
        contractors: rows.filter((r) => r.role === "contractor").map(toOption),
        partners: rows.filter((r) => r.role === "partner").map(toOption),
      };
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
// processed. Absent today (no genuine funding + tier engine not yet wired), so
// the widget degrades to an informational note when this returns nothing.
export type DealCommissionRecord = {
  id: string;
  gross_commission: string | null;
  company_retention: string | null;
  partner_pool: string | null;
  partner_share: string | null;
  owner_share: string | null;
  tier_pct: string | null;
  status: string | null;
};

export function useDealCommissionRecord(dealId: string | undefined, enabled: boolean) {
  const session = useSession();
  const uid = session?.user?.id ?? null;

  return useQuery({
    queryKey: ["deal-commission-record", dealId, uid],
    enabled: !!dealId && enabled,
    queryFn: async (): Promise<DealCommissionRecord | null> => {
      const { data, error } = await supabase
        .from("commission_records")
        .select(
          "id, gross_commission, company_retention, partner_pool, partner_share, owner_share, tier_pct, status",
        )
        .eq("deal_id", dealId!)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data as DealCommissionRecord | null) ?? null;
    },
  });
}
