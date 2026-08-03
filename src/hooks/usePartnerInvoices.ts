import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/useSession";
import { invalidateActivity } from "@/hooks/useActivity";
import type {
  OwnerPartnerInvoiceRow,
  PartnerInvoice,
  PartnerInvoiceLineItem,
} from "@/lib/partnerInvoices";

/*
 * C4 (Doctor Invoicing FNC) data layer. Two audiences share the same tables via
 * RLS + SECURITY DEFINER RPCs:
 *   - PARTNER: reads OWN invoices (partner_invoices_partner_read_own), generates
 *     drafts from his PAYABLE commissions, edits a draft, submits for approval.
 *   - OWNER: reads ALL invoices (owner RLS) + real partner name, approves /
 *     rejects / marks-paid (which settles the linked commissions server-side).
 *
 * Every write is a DEFINER RPC (partner_generate_invoice / partner_submit_invoice
 * / partner_remove_line_item / owner_approve_invoice / owner_reject_invoice /
 * owner_mark_invoice_paid). Money is recomputed server-side; the client never
 * writes these tables directly (DML is revoked from authenticated).
 */

const INVOICE_COLUMNS =
  "id, referral_partner_id, invoice_number, generated_at, invoice_period_start, " +
  "invoice_period_end, total_amount, state, submitted_at, approved_at, approved_by, " +
  "paid_at, paid_reference, rejected_at, rejected_reason, notes, pdf_storage_path, " +
  "created_by, created_at, updated_at";

// ---- reads -----------------------------------------------------------------

// The signed-in partner's own invoices. Cache keyed by user id so a same-tab
// sign-out/sign-in as a different partner can never reuse cached rows (mirrors
// usePortalDeals / useProfileRole). RLS is the authoritative scope regardless.
export function usePartnerInvoices() {
  const uid = useSession()?.user?.id ?? null;
  return useQuery({
    queryKey: ["partner-invoices", uid],
    queryFn: async (): Promise<PartnerInvoice[]> => {
      const { data, error } = await supabase
        .from("partner_invoices")
        .select(INVOICE_COLUMNS)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as PartnerInvoice[];
    },
  });
}

// Owner view: every partner invoice + the REAL partner name (owner privilege).
export function useOwnerPartnerInvoices() {
  const uid = useSession()?.user?.id ?? null;
  return useQuery({
    queryKey: ["owner-partner-invoices", uid],
    queryFn: async (): Promise<OwnerPartnerInvoiceRow[]> => {
      const { data, error } = await supabase
        .from("partner_invoices")
        .select(`${INVOICE_COLUMNS}, partner:referral_partners!left(id, name)`)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as OwnerPartnerInvoiceRow[];
    },
  });
}

// A single invoice (owner OR the owning partner — both satisfy RLS SELECT).
export function usePartnerInvoice(id: string | undefined) {
  const uid = useSession()?.user?.id ?? null;
  return useQuery({
    queryKey: ["partner-invoice", id, uid],
    enabled: !!id,
    queryFn: async (): Promise<PartnerInvoice> => {
      const { data, error } = await supabase
        .from("partner_invoices")
        .select(INVOICE_COLUMNS)
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data as unknown as PartnerInvoice;
    },
  });
}

// Enriched line items via the DEFINER RPC — funder name is audience-scoped
// (fictional for a partner caller, real for the owner) server-side (S7C).
export function usePartnerInvoiceLineItems(invoiceId: string | undefined) {
  const uid = useSession()?.user?.id ?? null;
  return useQuery({
    queryKey: ["partner-invoice-line-items", invoiceId, uid],
    enabled: !!invoiceId,
    queryFn: async (): Promise<PartnerInvoiceLineItem[]> => {
      const { data, error } = await supabase.rpc("list_partner_invoice_line_items", {
        p_invoice_id: invoiceId!,
      });
      if (error) throw error;
      return (data ?? []) as PartnerInvoiceLineItem[];
    },
  });
}

// ---- shared cache refresh --------------------------------------------------
function usePartnerInvoiceInvalidator() {
  const qc = useQueryClient();
  return (invoiceId?: string) => {
    qc.invalidateQueries({ queryKey: ["partner-invoices"] });
    qc.invalidateQueries({ queryKey: ["owner-partner-invoices"] });
    if (invoiceId) {
      qc.invalidateQueries({ queryKey: ["partner-invoice", invoiceId] });
      qc.invalidateQueries({ queryKey: ["partner-invoice-line-items", invoiceId] });
    }
    // Marking paid settles commissions → the owner partner-earnings view moves.
    qc.invalidateQueries({ queryKey: ["partner-earnings"] });
    invalidateActivity(qc);
  };
}

type RpcResult = Record<string, unknown>;

// ---- partner mutations -----------------------------------------------------

// Generate a draft from the partner's PAYABLE commissions in [start, end].
// Returns {was_created:false, reason} when nothing is eligible (no number burned).
export function useGeneratePartnerInvoice() {
  const invalidate = usePartnerInvoiceInvalidator();
  return useMutation({
    mutationFn: async (vars: { periodStart: string; periodEnd: string }): Promise<RpcResult> => {
      const { data, error } = await supabase.rpc("partner_generate_invoice", {
        p_period_start: vars.periodStart,
        p_period_end: vars.periodEnd,
      });
      if (error) throw error;
      return (data ?? {}) as RpcResult;
    },
    onSuccess: (d) => invalidate((d?.invoice_id as string) || undefined),
  });
}

export function useSubmitPartnerInvoice() {
  const invalidate = usePartnerInvoiceInvalidator();
  return useMutation({
    mutationFn: async (vars: { invoiceId: string }): Promise<RpcResult> => {
      const { data, error } = await supabase.rpc("partner_submit_invoice", {
        p_invoice_id: vars.invoiceId,
      });
      if (error) throw error;
      return (data ?? {}) as RpcResult;
    },
    onSuccess: (_d, v) => invalidate(v.invoiceId),
  });
}

export function useRemovePartnerLineItem() {
  const invalidate = usePartnerInvoiceInvalidator();
  return useMutation({
    mutationFn: async (vars: { lineItemId: string; invoiceId: string }): Promise<RpcResult> => {
      const { data, error } = await supabase.rpc("partner_remove_line_item", {
        p_line_item_id: vars.lineItemId,
      });
      if (error) throw error;
      return (data ?? {}) as RpcResult;
    },
    onSuccess: (_d, v) => invalidate(v.invoiceId),
  });
}

// ---- owner mutations -------------------------------------------------------

export function useApprovePartnerInvoice() {
  const invalidate = usePartnerInvoiceInvalidator();
  return useMutation({
    mutationFn: async (vars: { invoiceId: string }): Promise<RpcResult> => {
      const { data, error } = await supabase.rpc("owner_approve_invoice", {
        p_invoice_id: vars.invoiceId,
      });
      if (error) throw error;
      return (data ?? {}) as RpcResult;
    },
    onSuccess: (_d, v) => invalidate(v.invoiceId),
  });
}

export function useRejectPartnerInvoice() {
  const invalidate = usePartnerInvoiceInvalidator();
  return useMutation({
    mutationFn: async (vars: { invoiceId: string; reason: string }): Promise<RpcResult> => {
      const { data, error } = await supabase.rpc("owner_reject_invoice", {
        p_invoice_id: vars.invoiceId,
        p_reason: vars.reason,
      });
      if (error) throw error;
      return (data ?? {}) as RpcResult;
    },
    onSuccess: (_d, v) => invalidate(v.invoiceId),
  });
}

export function useMarkPartnerInvoicePaid() {
  const invalidate = usePartnerInvoiceInvalidator();
  return useMutation({
    mutationFn: async (vars: { invoiceId: string; paidReference: string }): Promise<RpcResult> => {
      const { data, error } = await supabase.rpc("owner_mark_invoice_paid", {
        p_invoice_id: vars.invoiceId,
        p_paid_reference: vars.paidReference,
      });
      if (error) throw error;
      return (data ?? {}) as RpcResult;
    },
    onSuccess: (_d, v) => invalidate(v.invoiceId),
  });
}
