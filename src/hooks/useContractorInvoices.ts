import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/useSession";
import { invalidateActivity } from "@/hooks/useActivity";
import type {
  ContractorInvoice,
  ContractorInvoiceLineItem,
  ContractorInvoiceableSummary,
  OwnerContractorInvoiceRow,
} from "@/lib/contractorInvoices";

/*
 * Build 9 (Contractor invoicing FNC) data layer — the contractor analogue of
 * usePartnerInvoices. The contractor:
 *   - reads OWN invoices (contractor_invoices_contractor_read_own RLS),
 *   - generates a draft from his PAYABLE contractor-tier commissions in a period
 *     (contractor_generate_invoice),
 *   - edits a draft (contractor_remove_line_item),
 *   - submits for FNC approval (contractor_submit_invoice).
 *
 * The owner reviews + approves/rejects submitted invoices (owner_approve_/
 * owner_reject_contractor_invoice, both from Build 8). Mark-paid + EFT proof +
 * atomic settle are Build 10 (they need a settle migration) — not here. Every
 * write is a SECURITY DEFINER RPC (DML on these tables is revoked from
 * authenticated); money is recomputed server-side.
 */

const INVOICE_COLUMNS =
  "id, contractor_id, invoice_number, generated_at, invoice_period_start, " +
  "invoice_period_end, total_amount, state, submitted_at, approved_at, approved_by, " +
  "paid_at, paid_reference, paid_proof_path, due_date, rejected_at, rejected_reason, notes, " +
  "created_by, created_at, updated_at";

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

// Owner view: every contractor invoice + the contractor's real name (owner
// privilege). Owner RLS (is_owner()) returns all rows; the embedded profiles
// join is disambiguated to the contractor_id FK (approved_by/created_by also
// reference profiles).
export function useOwnerContractorInvoices() {
  const uid = useSession()?.user?.id ?? null;
  return useQuery({
    queryKey: ["owner-contractor-invoices", uid],
    queryFn: async (): Promise<OwnerContractorInvoiceRow[]> => {
      const { data, error } = await supabase
        .from("contractor_invoices")
        .select(
          `${INVOICE_COLUMNS}, contractor:profiles!contractor_invoices_contractor_id_fkey(id, full_name)`,
        )
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as OwnerContractorInvoiceRow[];
    },
  });
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

// Read-only eligibility preview for the "Generate invoice" dialog, via the
// DEFINER RPC (contractors can't read commission_records directly — no read-own
// RLS). Returns take-only aggregates for the caller's payable, not-yet-invoiced
// commissions. Advisory: if the RPC isn't deployed yet the query errors and the
// dialog falls back to letting the generate RPC decide (it no-ops when nothing
// is eligible), so the preview is never a hard gate on its own failure.
export function useContractorInvoiceableSummary(periodStart: string, periodEnd: string) {
  const uid = useSession()?.user?.id ?? null;
  return useQuery({
    queryKey: ["contractor-invoiceable-summary", uid, periodStart, periodEnd],
    enabled: !!uid && !!periodStart && !!periodEnd,
    queryFn: async (): Promise<ContractorInvoiceableSummary | null> => {
      const { data, error } = await supabase.rpc("contractor_my_invoiceable_summary", {
        p_start: periodStart,
        p_end: periodEnd,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return (row ?? null) as ContractorInvoiceableSummary | null;
    },
    retry: false, // don't hammer the RPC if it isn't deployed yet
  });
}

// ---- shared cache refresh --------------------------------------------------
function useContractorInvoiceInvalidator() {
  const qc = useQueryClient();
  return (invoiceId?: string) => {
    qc.invalidateQueries({ queryKey: ["contractor-invoices"] });
    qc.invalidateQueries({ queryKey: ["owner-contractor-invoices"] });
    qc.invalidateQueries({ queryKey: ["contractor-invoiceable-summary"] });
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

// ---- owner mutations -------------------------------------------------------
// Approve/reject only (Build 8 RPCs). Mark-paid + settle are Build 10.

export function useApproveContractorInvoice() {
  const invalidate = useContractorInvoiceInvalidator();
  return useMutation({
    mutationFn: async (vars: { invoiceId: string }): Promise<RpcResult> => {
      const { data, error } = await supabase.rpc("owner_approve_contractor_invoice", {
        p_invoice_id: vars.invoiceId,
      });
      if (error) throw error;
      return (data ?? {}) as RpcResult;
    },
    onSuccess: (_d, v) => invalidate(v.invoiceId),
  });
}

export function useRejectContractorInvoice() {
  const invalidate = useContractorInvoiceInvalidator();
  return useMutation({
    mutationFn: async (vars: { invoiceId: string; reason: string }): Promise<RpcResult> => {
      const { data, error } = await supabase.rpc("owner_reject_contractor_invoice", {
        p_invoice_id: vars.invoiceId,
        p_reason: vars.reason,
      });
      if (error) throw error;
      return (data ?? {}) as RpcResult;
    },
    onSuccess: (_d, v) => invalidate(v.invoiceId),
  });
}

// Mark an approved contractor invoice paid (EFT reference required, optional
// proof path). Atomically settles the invoiced commissions server-side
// (payable -> settled). Build 10.
export function useMarkContractorInvoicePaid() {
  const invalidate = useContractorInvoiceInvalidator();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      invoiceId: string;
      paidReference: string;
      paidProofPath?: string | null;
    }): Promise<RpcResult> => {
      const { data, error } = await supabase.rpc("owner_mark_contractor_invoice_paid", {
        p_invoice_id: vars.invoiceId,
        p_paid_reference: vars.paidReference,
        p_paid_proof_path: vars.paidProofPath ?? null,
      });
      if (error) throw error;
      return (data ?? {}) as RpcResult;
    },
    onSuccess: (_d, v) => {
      invalidate(v.invoiceId);
      // Settling moves the contractor's earnings — refresh any earnings view.
      qc.invalidateQueries({ queryKey: ["partner-earnings"] });
    },
  });
}
