import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import {
  normaliseBonus,
  normaliseCommission,
  type EarningRow,
  type RawBonusRow,
  type RawCommissionRow,
} from "@/lib/partnerEarnings";

// Shared embed for both tables. All embeds are !left per the nullable-FK rule
// (referral_partner_id + a bonus's deal_funder_submission_id are nullable, and
// !left is used defensively even on the NOT-NULL links so a legacy row never
// vanishes). Funder name is reached through the submission → funders chain.
const EMBED =
  "deal:deals!left(id, reference, client:clients!left(id, business_name)), " +
  "submission:deal_funder_submissions!left(id, funder:funders!left(id, name, short_code)), " +
  "partner:referral_partners!left(id, name)";

const COMMISSION_COLUMNS =
  "id, deal_id, referral_partner_id, gross_commission, company_retention, partner_pool, " +
  "partner_share, owner_share, tier_pct, is_purchase_order, status, earned_at, outstanding_at, " +
  "payable_at, settled_at, notes, created_at";

const BONUS_COLUMNS =
  "id, deal_id, referral_partner_id, bonus_amount, bonus_reason, state, earned_at, " +
  "outstanding_at, payable_at, settled_at, notes, created_at";

// Owner-only via RLS (commission_records_owner_all / bonus_records_owner_all).
// Both sets are fetched whole and normalised into one EarningRow[] — owner
// volume is small and the KPI/aging tiles need the full set regardless of the
// table's client-side filters (same approach as useInvoices / C1.2).
export function usePartnerEarnings() {
  const commissions = useQuery({
    queryKey: ["partner-earnings", "commissions"],
    queryFn: async (): Promise<EarningRow[]> => {
      const { data, error } = await supabase
        .from("commission_records")
        .select(`${COMMISSION_COLUMNS}, ${EMBED}`)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return ((data ?? []) as unknown as RawCommissionRow[]).map(normaliseCommission);
    },
  });

  const bonuses = useQuery({
    queryKey: ["partner-earnings", "bonuses"],
    queryFn: async (): Promise<EarningRow[]> => {
      const { data, error } = await supabase
        .from("bonus_records")
        .select(`${BONUS_COLUMNS}, ${EMBED}`)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return ((data ?? []) as unknown as RawBonusRow[]).map(normaliseBonus);
    },
  });

  const rows = useMemo<EarningRow[]>(() => {
    const all = [...(commissions.data ?? []), ...(bonuses.data ?? [])];
    // Newest first across both sources for a stable default table order.
    return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [commissions.data, bonuses.data]);

  return {
    rows,
    isLoading: commissions.isLoading || bonuses.isLoading,
    isError: commissions.isError || bonuses.isError,
    error: (commissions.error ?? bonuses.error) as Error | null,
  };
}
