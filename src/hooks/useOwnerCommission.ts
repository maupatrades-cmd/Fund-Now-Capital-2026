import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/useSession";
import { useProfileRole } from "@/hooks/useProfileRole";
import { invalidateActivity } from "@/hooks/useActivity";
import { collectCommissionRows as allRows, commissionAmount, UnconfirmedCommissionChange, type CommissionAdjustment, type CommissionFlag, type CommissionOrganisation, type CommissionPerson, type CommissionReconciliation, type ManualCommissionEntry } from "@/lib/ownerCommission";

export function useOwnerCommission(dealId: string, open: boolean) {
  const session = useSession();
  const uid = session?.user.id;
  const role = useProfileRole();
  return useQuery({
    queryKey: ["owner-manual-commission", uid, dealId],
    enabled: open && !!uid && role.data === "owner",
    gcTime: 0,
    queryFn: async () => {
      const { data: identity, error: identityError } = await supabase.auth.getUser();
      if (identityError || identity.user?.id !== uid) throw new Error("Your session changed. Reopen this deal.");
      const [reconciliation, entries, adjustments, flags, people, organisations, leaders] = await Promise.all([
        supabase.rpc("owner_commission_reconciliation", { p_deal_id: dealId }),
        allRows<ManualCommissionEntry>((start, end) => supabase.from("owner_commission_entries")
          .select("id,deal_id,beneficiary_kind,beneficiary_profile_id,beneficiary_organisation_id,beneficiary_name,currency,amount,basis,percentage,status,reason")
          .eq("deal_id", dealId).order("id").range(start, end)),
        allRows<CommissionAdjustment>((start, end) => supabase.from("owner_commission_adjustments")
          .select("id,entry_id,delta,reason,created_at,entry:owner_commission_entries!inner(deal_id)")
          .eq("entry.deal_id", dealId).order("id").range(start, end)),
        allRows<CommissionFlag>((start, end) => supabase.from("owner_commission_flags")
          .select("id,entry_id,flag_kind,note,status,resolution,entry:owner_commission_entries!inner(deal_id)")
          .eq("entry.deal_id", dealId).order("id").range(start, end)),
        allRows<CommissionPerson>((start, end) => supabase.from("profiles")
          .select("id,full_name,email,role,is_active").order("id").range(start, end)),
        allRows<CommissionOrganisation>((start, end) => supabase.from("referral_partners")
          .select("id,name,is_active").order("id").range(start, end)),
        allRows<{ profile_id: string }>((start, end) => supabase.from("referral_team_memberships")
          .select("id,profile_id").eq("membership_role", "team_leader").order("id").range(start, end)),
      ]);
      if (reconciliation.error) throw reconciliation.error;
      if (!reconciliation.data) throw new Error("Commission totals could not be verified.");
      return { reconciliation: reconciliation.data as CommissionReconciliation, entries, adjustments, flags, people, organisations, leaderIds: new Set(leaders.map((item) => item.profile_id)) };
    },
  });
}

export type CommissionCommand =
  | { action: "total"; amount: string }
  | { action: "save"; entry: Omit<ManualCommissionEntry, "id" | "status" | "amount"> & { id: string | null; amount: string } }
  | { action: "approve" }
  | { action: "void" | "adjust" | "flag"; entryId: string; reason: string; delta?: string }
  | { action: "resolve"; flagId: string; reason: string };

export function useOwnerCommissionCommand(dealId: string) {
  const session = useSession();
  const uid = session?.user.id;
  const cache = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: async (command: CommissionCommand) => {
      const { data: identity, error: identityError } = await supabase.auth.getUser();
      if (!uid || identityError || identity.user?.id !== uid) throw new Error("Your session changed. Reopen this deal.");
      const execute = () => {
        switch (command.action) {
          case "total": return supabase.rpc("owner_set_commission_total", { p_deal_id: dealId, p_currency: "ZAR", p_total: commissionAmount(command.amount), p_reason: "Owner entered the deal commission total" });
          case "save": {
            const entry = command.entry;
            if (entry.deal_id !== dealId) throw new Error("This allocation belongs to another deal.");
            return supabase.rpc("owner_save_commission_entry", {
              p_entry_id: entry.id, p_deal_id: dealId, p_beneficiary_kind: entry.beneficiary_kind,
              p_beneficiary_profile_id: entry.beneficiary_profile_id, p_beneficiary_organisation_id: entry.beneficiary_organisation_id,
              p_beneficiary_name: entry.beneficiary_name, p_currency: entry.currency, p_amount: commissionAmount(entry.amount),
              p_basis: entry.basis, p_percentage: entry.percentage, p_reason: entry.reason,
            });
          }
          case "approve": return supabase.rpc("owner_approve_commission_entries", { p_deal_id: dealId });
          case "void": return supabase.rpc("owner_void_commission_entry", { p_entry_id: command.entryId, p_reason: command.reason });
          case "adjust": return supabase.rpc("owner_adjust_commission_entry", { p_entry_id: command.entryId, p_delta: commissionAmount(command.delta ?? "", true), p_reason: command.reason });
          case "flag": return supabase.rpc("owner_flag_commission_entry", { p_entry_id: command.entryId, p_kind: "other", p_note: command.reason });
          case "resolve": return supabase.rpc("owner_resolve_commission_flag", { p_flag_id: command.flagId, p_resolution: command.reason });
        }
      };
      const { data, error } = await execute();
      if (error) throw error.code ? error : new UnconfirmedCommissionChange();
      if (data == null) throw new UnconfirmedCommissionChange();
      return data;
    },
    onSettled: async () => {
      await cache.invalidateQueries({ queryKey: ["owner-manual-commission", uid, dealId] });
      invalidateActivity(cache);
    },
  });
}
