import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/useSession";
import { useProfileRole } from "@/hooks/useProfileRole";
import { collectCommissionRows, commissionAmount, UnconfirmedCommissionChange } from "@/lib/ownerCommission";
import { invalidateActivity } from "@/hooks/useActivity";

export type CommissionNotice = {
  commission_notice_id: string; client_name: string; deal_reference: string;
  beneficiary_kind: string; beneficiary_name: string; commission_amount: string | number;
  currency: "ZAR"; issued_at: string; is_current: boolean;
};

export function useOwnerCommissionNotices(dealId: string) {
  const uid = useSession()?.user.id;
  const role = useProfileRole();
  return useQuery({
    queryKey: ["owner-commission-notices", uid, dealId], gcTime: 0,
    enabled: !!uid && role.data === "owner",
    queryFn: async () => {
      const check = async () => {
        const identity = await supabase.auth.getUser();
        if (identity.error || identity.data.user?.id !== uid) throw new Error("Your session changed. Reopen the deal.");
      };
      await check();
      const notices = await collectCommissionRows<CommissionNotice>(async (start, end) => {
        const response = await supabase.rpc("staff_commission_notices_for_deal", { p_deal_id: dealId })
          .order("issued_at").order("commission_notice_id").range(start, end);
        if (response.error) throw response.error;
        if (!Array.isArray(response.data)) throw new Error("Commission notices could not be verified.");
        return { data: response.data, error: null };
      });
      await check();
      return notices;
    },
  });
}

export function useIssueCommissionNotice(dealId: string, openedUid: string | undefined) {
  const uid = useSession()?.user.id;
  const cache = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: async (input: { entryId: string; amount: string }) => {
      const identity = await supabase.auth.getUser();
      if (!uid || uid !== openedUid || identity.error || identity.data.user?.id !== uid) throw new Error("Your session changed. Reopen the deal.");
      const response = await supabase.rpc("owner_issue_commission_notice", { p_entry_id: input.entryId, p_expected_amount: commissionAmount(input.amount) });
      if (response.error) throw response.error.code ? response.error : new UnconfirmedCommissionChange();
      if (!response.data) throw new UnconfirmedCommissionChange();
      return response.data as string;
    },
    onSettled: async () => {
      await cache.invalidateQueries({ queryKey: ["owner-commission-notices", uid, dealId] });
      invalidateActivity(cache);
    },
  });
}
