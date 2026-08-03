import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import {
  normaliseBonus,
  normaliseCommission,
  normaliseLead,
  type BonusReportRow,
  type CommissionReportRow,
  type LeadReportRow,
  type PersonRow,
} from "@/lib/reports";

// Reports v1 data layer — owner-only, read-only. Five small queries feed the
// whole dashboard; each is guarded by the existing owner-all RLS on its table
// (commission_records / bonus_records / leads / referral_partners / profiles).
// All embeds are !left per the nullable-FK rule so a legacy row never vanishes.
//
// Funder REAL name is reached via the submission → funders chain (owner view —
// no anonymisation). The contractor attribution for a commission row is reached
// via deal → lead → attributed_to_contractor_id.

const COMMISSION_SELECT =
  "id, deal_id, referral_partner_id, gross_commission, partner_share, status, earned_at, created_at, " +
  "deal:deals!left(reference, client:clients!left(business_name), lead:leads!left(attributed_to_contractor_id)), " +
  "submission:deal_funder_submissions!left(amount_funded, funder:funders!left(id, name)), " +
  "partner:referral_partners!left(id, name)";

export function useReports() {
  const commissions = useQuery({
    queryKey: ["reports", "commissions"],
    queryFn: async (): Promise<CommissionReportRow[]> => {
      const { data, error } = await supabase
        .from("commission_records")
        .select(COMMISSION_SELECT)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return ((data ?? []) as never[]).map((r) => normaliseCommission(r));
    },
  });

  const leads = useQuery({
    queryKey: ["reports", "leads"],
    queryFn: async (): Promise<LeadReportRow[]> => {
      const { data, error } = await supabase
        .from("leads")
        .select("id, referral_partner_id, attributed_to_contractor_id, created_at");
      if (error) throw error;
      return ((data ?? []) as never[]).map((r) => normaliseLead(r));
    },
  });

  // Discretionary owner bonuses (C2.4). Owner-all RLS; state enum matches
  // commission_state. Folded into the partner leaderboard's earnings.
  const bonuses = useQuery({
    queryKey: ["reports", "bonuses"],
    queryFn: async (): Promise<BonusReportRow[]> => {
      const { data, error } = await supabase
        .from("bonus_records")
        .select("id, deal_id, referral_partner_id, bonus_amount, state, earned_at, created_at");
      if (error) throw error;
      return ((data ?? []) as never[]).map((r) => normaliseBonus(r));
    },
  });

  const partners = useQuery({
    queryKey: ["reports", "partners"],
    queryFn: async (): Promise<PersonRow[]> => {
      const { data, error } = await supabase
        .from("referral_partners")
        .select("id, name")
        .order("name");
      if (error) throw error;
      return ((data ?? []) as { id: string; name: string }[]).map((p) => ({
        id: p.id,
        name: p.name,
      }));
    },
  });

  const contractors = useQuery({
    queryKey: ["reports", "contractors"],
    queryFn: async (): Promise<PersonRow[]> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .eq("role", "contractor");
      if (error) throw error;
      return ((data ?? []) as { id: string; full_name: string | null; email: string | null }[]).map(
        (p) => ({ id: p.id, name: p.full_name || p.email || "Unnamed contractor" }),
      );
    },
  });

  const isLoading =
    commissions.isLoading ||
    leads.isLoading ||
    bonuses.isLoading ||
    partners.isLoading ||
    contractors.isLoading;
  const isError =
    commissions.isError ||
    leads.isError ||
    bonuses.isError ||
    partners.isError ||
    contractors.isError;
  const error = (commissions.error ??
    leads.error ??
    bonuses.error ??
    partners.error ??
    contractors.error) as Error | null;

  const refetch = () => {
    void commissions.refetch();
    void leads.refetch();
    void bonuses.refetch();
    void partners.refetch();
    void contractors.refetch();
  };

  const data = useMemo(
    () => ({
      commissions: commissions.data ?? [],
      leads: leads.data ?? [],
      bonuses: bonuses.data ?? [],
      partners: partners.data ?? [],
      contractors: contractors.data ?? [],
    }),
    [commissions.data, leads.data, bonuses.data, partners.data, contractors.data],
  );

  return { ...data, isLoading, isError, error, refetch };
}
