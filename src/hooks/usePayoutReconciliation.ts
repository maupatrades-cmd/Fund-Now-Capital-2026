import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useOwnerPartnerInvoices } from "@/hooks/usePartnerInvoices";
import { useOwnerContractorInvoices } from "@/hooks/useContractorInvoices";
import {
  buildPayoutRows,
  sumTotals,
  type PayoutRow,
  type PayoutTotals,
  type RawReconCommission,
  type ReconInvoice,
} from "@/lib/payoutReconciliation";

// Build 11 — owner-only unified payout reconciliation data layer.
//
// Sources (all owner-full RLS): commission_records (the money ledger) + both
// invoice tables (reused via their existing owner hooks). We page the commission
// read so a long-lived ledger can't be silently truncated at the PostgREST
// 1000-row cap.

const RECON_PAGE_SIZE = 1000;

const COMMISSION_COLUMNS =
  "id, status, attribution_type, referral_partner_id, contractor_id, partner_share, contractor_share, " +
  "partner:referral_partners!commission_records_referral_partner_id_fkey(id, name), " +
  "contractor:profiles!commission_records_contractor_fkey(id, full_name)";

async function fetchAllCommissions(): Promise<RawReconCommission[]> {
  const all: RawReconCommission[] = [];
  for (let from = 0; ; from += RECON_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("commission_records")
      .select(COMMISSION_COLUMNS)
      .range(from, from + RECON_PAGE_SIZE - 1);
    if (error) throw error;
    const batch = (data ?? []) as unknown as RawReconCommission[];
    all.push(...batch);
    if (batch.length < RECON_PAGE_SIZE) break;
  }
  return all;
}

export type PayoutReconciliation = {
  partnerRows: PayoutRow[];
  contractorRows: PayoutRow[];
  partnerTotals: PayoutTotals;
  contractorTotals: PayoutTotals;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
};

export function usePayoutReconciliation(): PayoutReconciliation {
  const commissions = useQuery({
    queryKey: ["payout-reconciliation", "commissions"],
    queryFn: fetchAllCommissions,
  });
  const partnerInvoices = useOwnerPartnerInvoices();
  const contractorInvoices = useOwnerContractorInvoices();

  const partnerInvoiceRows = useMemo<ReconInvoice[]>(
    () =>
      (partnerInvoices.data ?? []).map((i) => ({
        state: i.state,
        total_amount: i.total_amount,
        payeeId: i.referral_partner_id,
        payeeName: i.partner?.name ?? null,
      })),
    [partnerInvoices.data],
  );

  const contractorInvoiceRows = useMemo<ReconInvoice[]>(
    () =>
      (contractorInvoices.data ?? []).map((i) => ({
        state: i.state,
        total_amount: i.total_amount,
        payeeId: i.contractor_id,
        payeeName: i.contractor?.full_name ?? null,
      })),
    [contractorInvoices.data],
  );

  const partnerRows = useMemo(
    () => buildPayoutRows("partner", commissions.data ?? [], partnerInvoiceRows),
    [commissions.data, partnerInvoiceRows],
  );
  const contractorRows = useMemo(
    () => buildPayoutRows("contractor", commissions.data ?? [], contractorInvoiceRows),
    [commissions.data, contractorInvoiceRows],
  );

  return {
    partnerRows,
    contractorRows,
    partnerTotals: useMemo(() => sumTotals(partnerRows), [partnerRows]),
    contractorTotals: useMemo(() => sumTotals(contractorRows), [contractorRows]),
    isLoading: commissions.isLoading || partnerInvoices.isLoading || contractorInvoices.isLoading,
    isError: commissions.isError || partnerInvoices.isError || contractorInvoices.isError,
    error: (commissions.error ?? partnerInvoices.error ?? contractorInvoices.error) as Error | null,
  };
}
