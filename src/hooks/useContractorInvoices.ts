import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/useSession";
import { invalidateActivity } from "@/hooks/useActivity";
import type { ContractorInvoice, ContractorInvoiceLineItem } from "@/lib/contractorInvoices";

/*
 * Build 9 (Contractor invoicing FNC) data layer — the contractor analogue of
 * usePartnerInvoices. The contractor:
 *   - reads OWN invoices (contractor_invoices_contractor_read_own RLS),
 *   - generates a draft from his PAYABLE contractor-tier commissions in a period
 *     (contractor_generate_invoice),
 *   - edits a draft (contractor_remove_line_item),
 *   - submits for FNC approval (contractor_submit_invoice).
 *
 * Owner approve/reject + mark-paid live in Build 10, so no owner mutation hooks
 * here. Every write is a SECURITY DEFINER RPC (DML on these tables is revoked
 * from authenticated); money is recomputed server-side.
 */

const INVOICE_COLUMNS =
  "id, contractor_id, invoice_number, generated_at, invoice_period_start, " +
  "invoice_period_end, total_amount, state, submitted_at, approved_at, approved_by, " +
  "paid_at, paid_reference, rejected_at, rejected_reason, notes, created_by, created_at, updated_at";

// ---- reads -----------------------------------------------------------------

// The signed-in contractor's own invoices. Cache keyed by user id so a same-tab
// sign-out/sign-in as a different user can never reuse cached rows. RLS is the
// authoritative scope regardless.
export function useContractorInvoices() {
  const uid = useSession()?.user?.id ?? null;
  const query = useQuery({
    queryKey: ["contractor-invoices", uid],
    enabled: uid !== null,
    queryFn: async (): Promise<ContractorInvoice[]> => {
      const { data, error } = await supabase
        .from("contractor_invoices")
        .select(INVOICE_COLUMNS)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as ContractorInvoice[];
    },
  });
  return { ...query, isLoading: query.isLoading || uid === null };
}

// A single invoice (the owning contractor OR the owner — both satisfy RLS SELECT).
export function useContractorInvoice(id: string | undefined) {
  const uid = useSession()?.user?.id ?? null;
  const query = useQuery({
    queryKey: ["contractor-invoice", id, uid],
    enabled: !!id && uid !== null,
    queryFn: async (): Promise<ContractorInvoice> => {
      const { data, error } = await supabase
        .from("contractor_invoices")
        .select(INVOICE_COLUMNS)
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data as unknown as ContractorInvoice;
    },
  });
  return { ...query, isLoading: query.isLoading || uid === null };
}

// Enriched line items via the DEFINER RPC (authorizes owner-or-owning-contractor
// server-side). No funder name — contractor tier rows carry none (S7C).
export function useContractorInvoiceLineItems(invoiceId: string | undefined) {
  const uid = useSession()?.user?.id ?? null;
  return useQuery({
    queryKey: ["contractor-invoice-line-items", invoiceId, uid],
    enabled: !!invoiceId,
    queryFn: async (): Promise<ContractorInvoiceLineItem[]> => {
      const { data, error } = await supabase.rpc("list_contractor_invoice_line_items", {
        p_invoice_id: invoiceId!,
      });
      if (error) throw error;
      return (data ?? []) as ContractorInvoiceLineItem[];
    },
  });
}

// ---- shared cache refresh --------------------------------------------------
function useContractorInvoiceInvalidator() {
  const qc = useQueryClient();
  return (invoiceId?: string) => {
    qc.invalidateQueries({ queryKey: ["contractor-invoices"] });
    if (invoiceId) {
      qc.invalidateQueries({ queryKey: ["contractor-invoice", invoiceId] });
      qc.invalidateQueries({ queryKey: ["contractor-invoice-line-items", invoiceId] });
    }
    invalidateActivity(qc);
  };
}

type RpcResult = Record<string, unknown>;

// ---- contractor mutations --------------------------------------------------

// Generate a draft from the contractor's PAYABLE commissions in [start, end].
// Returns {was_created:false, reason} when nothing is eligible (no CI number burned).
export function useGenerateContractorInvoice() {
  const invalidate = useContractorInvoiceInvalidator();
  return useMutation({
    mutationFn: async (vars: { periodStart: string; periodEnd: string }): Promise<RpcResult> => {
      const { data, error } = await supabase.rpc("contractor_generate_invoice", {
        p_period_start: vars.periodStart,
        p_period_end: vars.periodEnd,
      });
      if (error) throw error;
      return (data ?? {}) as RpcResult;
    },
    onSuccess: (d) => invalidate((d?.invoice_id as string) || undefined),
  });
}

export function useSubmitContractorInvoice() {
  const invalidate = useContractorInvoiceInvalidator();
  return useMutation({
    mutationFn: async (vars: { invoiceId: string }): Promise<RpcResult> => {
      const { data, error } = await supabase.rpc("contractor_submit_invoice", {
        p_invoice_id: vars.invoiceId,
      });
      if (error) throw error;
      return (data ?? {}) as RpcResult;
    },
    onSuccess: (_d, v) => invalidate(v.invoiceId),
  });
}

export function useRemoveContractorLineItem() {
  const invalidate = useContractorInvoiceInvalidator();
  return useMutation({
    mutationFn: async (vars: { lineItemId: string; invoiceId: string }): Promise<RpcResult> => {
      const { data, error } = await supabase.rpc("contractor_remove_line_item", {
        p_line_item_id: vars.lineItemId,
      });
      if (error) throw error;
      return (data ?? {}) as RpcResult;
    },
    onSuccess: (_d, v) => invalidate(v.invoiceId),
  });
}
