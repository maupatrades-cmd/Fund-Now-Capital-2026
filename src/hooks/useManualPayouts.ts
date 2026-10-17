import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/useSession";
import { useProfileRole } from "@/hooks/useProfileRole";
import { collectCommissionRows, type CommissionAdjustment, type CommissionFlag, type ManualCommissionEntry } from "@/lib/ownerCommission";

export type ManualPayoutEntry = ManualCommissionEntry & {
  paid_at: string | null;
  payment_reference: string | null;
  profile: { full_name: string | null } | null;
  organisation: { name: string | null } | null;
};

export function useManualPayouts() {
  const uid = useSession()?.user.id;
  const role = useProfileRole();
  return useQuery({
    queryKey: ["owner-manual-payouts", uid],
    enabled: !!uid && role.data === "owner",
    gcTime: 0,
    queryFn: async () => {
      const checkIdentity = async () => {
        const { data, error } = await supabase.auth.getUser();
        if (error || data.user?.id !== uid) throw new Error("Your session changed. Reopen Payouts.");
      };
      await checkIdentity();
      const [entries, adjustments, flags] = await Promise.all([
        collectCommissionRows<ManualPayoutEntry>((start, end) => supabase.from("owner_commission_entries")
          .select("id,deal_id,beneficiary_kind,beneficiary_profile_id,beneficiary_organisation_id,beneficiary_name,currency,amount,basis,percentage,status,reason,paid_at,payment_reference,profile:profiles!owner_commission_entries_beneficiary_profile_id_fkey(full_name),organisation:referral_partners!owner_commission_entries_beneficiary_organisation_id_fkey(name)")
          .order("id").range(start, end)),
        collectCommissionRows<CommissionAdjustment>((start, end) => supabase.from("owner_commission_adjustments")
          .select("id,entry_id,delta,reason,created_at").order("id").range(start, end)),
        collectCommissionRows<CommissionFlag>((start, end) => supabase.from("owner_commission_flags")
          .select("id,entry_id,flag_kind,note,status,resolution").eq("status", "open").order("id").range(start, end)),
      ]);
      await checkIdentity();
      return { entries, adjustments, flags };
    },
  });
}
