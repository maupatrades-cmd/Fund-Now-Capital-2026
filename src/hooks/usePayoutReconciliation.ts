import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
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
// invoice tables. EVERY read is paged past the PostgREST 1000-row cap — a
// long-lived ledger or invoice table must never silently truncate, or the
// reconciliation would under-count the very money it exists to reconcile.

const RECON_PAGE_SIZE = 1000;

// Generic explicit-range pager. Loops until a short page signals the end.
async function fetchAllPaged<Row>(
  buildPage: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: unknown }>,
): Promise<Row[]> {
  const all: Row[] = [];
  for (let from = 0; ; from += RECON_PAGE_SIZE) {
    const { data, error } = await buildPage(from, from + RECON_PAGE_SIZE - 1);
    if (error) throw error;
    const batch = data ?? [];
    all.push(...batch);
    if (batch.length < RECON_PAGE_SIZE) break;
  }
  return all;
}

const COMMISSION_COLUMNS =
  "id, status, attribution_type, referral_partner_id, contractor_id, partner_share, contractor_share, " +
  "partner:referral_partners!commission_records_referral_partner_id_fkey(id, name), " +
  "contractor:profiles!commission_records_contractor_fkey(id, full_name)";

// supabase-js types to-one embeds as arrays; at runtime they are objects. Cast
// at the boundary to the true row shape (the codebase's established pattern).
type PagePromise<Row> = PromiseLike<{ data: Row[] | null; error: unknown }>;

const fetchAllCommissions = () =>
  fetchAllPaged<RawReconCommission>(
    (from, to) =>
      supabase.from("commission_records").select(COMMISSION_COLUMNS).range(from, to) as unknown as PagePromise<RawReconCommission>,
  );

type RawPartnerInvoice = {
  state: ReconInvoice["state"];
  total_amount: string | number;
  referral_partner_id: string;
  partner: { id: string; name: string | null } | null;
};

const fetchAllPartnerInvoices = () =>
  fetchAllPaged<RawPartnerInvoice>(
    (from, to) =>
      supabase
        .from("partner_invoices")
        .select("state, total_amount, referral_partner_id, partner:referral_partners!left(id, name)")
        .range(from, to) as unknown as PagePromise<RawPartnerInvoice>,
  );

type RawContractorInvoice = {
  state: ReconInvoice["state"];
  total_amount: string | number;
  contractor_id: string;
  contractor: { id: string; full_name: string | null } | null;
};

const fetchAllContractorInvoices = () =>
  fetchAllPaged<RawContractorInvoice>(
    (from, to) =>
      supabase
        .from("contractor_invoices")
        .select(
          "state, total_amount, contractor_id, contractor:profiles!contractor_invoices_contractor_id_fkey(id, full_name)",
        )
        .range(from, to) as unknown as PagePromise<RawContractorInvoice>,
  );

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
  const partnerInvoices = useQuery({
    queryKey: ["payout-reconciliation", "partner-invoices"],
    queryFn: fetchAllPartnerInvoices,
  });
  const contractorInvoices = useQuery({
    queryKey: ["payout-reconciliation", "contractor-invoices"],
    queryFn: fetchAllContractorInvoices,
  });

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
