import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { invalidateActivity } from "@/hooks/useActivity";
import type { InvoiceListRow } from "@/lib/invoices";

// Columns selected for list/detail views (explicit — avoids over-fetching and
// keeps the shape stable against future column adds).
const INVOICE_COLUMNS =
  "id, invoice_number, deal_id, deal_funder_submission_id, funder_id, client_reference, " +
  "facility_advanced, finance_charge_amount, commission_amount, vat_amount, total_amount, " +
  "rate_snapshot, commission_description, contract_reference, payment_reference_expected, " +
  "issued_date, payment_terms, due_date, state, paid_at, paid_amount, payment_reference_received, " +
  "pdf_storage_path, notes, created_at, updated_at";

// All invoices (owner-only via RLS). Fetched whole — owner volume is small and
// the aging tiles need the full set regardless of table filters (filtering is
// client-side in InvoicesPage). funder embed is !left: funder_id is NOT NULL so
// the row always exists, but !left is defensive per the nullable-FK rule.
export function useInvoices() {
  return useQuery({
    queryKey: ["invoices"],
    queryFn: async (): Promise<InvoiceListRow[]> => {
      const { data, error } = await supabase
        .from("funder_invoices")
        .select(`${INVOICE_COLUMNS}, funder:funders!left(id, name, short_code)`)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as InvoiceListRow[];
    },
  });
}

export type InvoiceDetail = InvoiceListRow & {
  deal: { id: string; reference: string | null } | null;
};

export function useInvoice(id: string | undefined) {
  return useQuery({
    queryKey: ["invoice", id],
    enabled: !!id,
    queryFn: async (): Promise<InvoiceDetail> => {
      const { data, error } = await supabase
        .from("funder_invoices")
        .select(
          `${INVOICE_COLUMNS}, funder:funders!left(id, name, short_code), deal:deals!left(id, reference)`,
        )
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data as unknown as InvoiceDetail;
    },
  });
}

// Invoices attached to one deal (the deal-detail Invoices section).
export function useDealInvoices(dealId: string | undefined) {
  return useQuery({
    queryKey: ["deal-invoices", dealId],
    enabled: !!dealId,
    queryFn: async (): Promise<InvoiceListRow[]> => {
      const { data, error } = await supabase
        .from("funder_invoices")
        .select(`${INVOICE_COLUMNS}, funder:funders!left(id, name, short_code)`)
        .eq("deal_id", dealId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as InvoiceListRow[];
    },
  });
}

// Submissions on a deal that could be invoiced — carries the money columns the
// Generate preconditions + preview need (the FunderSubmissions hook omits them).
export type FundableSubmission = {
  id: string;
  deal_id: string;
  funder_id: string;
  status: string;
  amount_funded: string | number | null;
  finance_charge_amount: string | number | null;
  approved_at: string | null;
  funded_at: string | null;
  funder: { id: string; name: string; short_code: string | null } | null;
};

export function useFundableSubmissions(dealId: string | undefined) {
  return useQuery({
    queryKey: ["fundable-submissions", dealId],
    enabled: !!dealId,
    queryFn: async (): Promise<FundableSubmission[]> => {
      const { data, error } = await supabase
        .from("deal_funder_submissions")
        .select(
          "id, deal_id, funder_id, status, amount_funded, finance_charge_amount, approved_at, funded_at, " +
            "funder:funders!left(id, name, short_code)",
        )
        .eq("deal_id", dealId!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as FundableSubmission[];
    },
  });
}

// ---- mutations -------------------------------------------------------------
// Shared cache refresh after any invoice state change.
function useInvoiceInvalidator() {
  const qc = useQueryClient();
  return (vars: { dealId?: string; invoiceId?: string }) => {
    qc.invalidateQueries({ queryKey: ["invoices"] });
    if (vars.invoiceId) qc.invalidateQueries({ queryKey: ["invoice", vars.invoiceId] });
    if (vars.dealId) {
      qc.invalidateQueries({ queryKey: ["deal-invoices", vars.dealId] });
      qc.invalidateQueries({ queryKey: ["fundable-submissions", vars.dealId] });
      // Issue advances the deal Funded → Invoiced, so refresh the deal + pipeline.
      qc.invalidateQueries({ queryKey: ["deal", vars.dealId] });
      qc.invalidateQueries({ queryKey: ["pipeline"] });
    }
    invalidateActivity(qc);
  };
}

type RpcResult = Record<string, unknown>;

// Generate a draft invoice from a submission. p_finance_charge is passed through
// (the modal pre-fills it from the submission, owner-editable). When the owner
// edits it, the caller also persists it back to the submission first (one source
// of truth) — see DealInvoices.
export function useGenerateInvoice() {
  const invalidate = useInvoiceInvalidator();
  return useMutation({
    mutationFn: async (vars: {
      submissionId: string;
      dealId: string;
      financeCharge: number | null;
      contractRef?: string | null;
      notes?: string | null;
    }): Promise<RpcResult> => {
      const { data, error } = await supabase.rpc("generate_funder_invoice", {
        p_submission_id: vars.submissionId,
        p_finance_charge: vars.financeCharge,
        p_contract_ref: vars.contractRef ?? null,
        p_notes: vars.notes ?? null,
      });
      if (error) throw error;
      return (data ?? {}) as RpcResult;
    },
    onSuccess: (_d, v) => invalidate({ dealId: v.dealId }),
  });
}

export function useUpdateDraftInvoice() {
  const invalidate = useInvoiceInvalidator();
  return useMutation({
    mutationFn: async (vars: {
      invoiceId: string;
      dealId: string;
      description: string;
      notes: string | null;
    }): Promise<RpcResult> => {
      const { data, error } = await supabase.rpc("update_draft_invoice", {
        p_invoice_id: vars.invoiceId,
        p_description: vars.description,
        p_notes: vars.notes,
      });
      if (error) throw error;
      return (data ?? {}) as RpcResult;
    },
    onSuccess: (_d, v) => invalidate({ dealId: v.dealId, invoiceId: v.invoiceId }),
  });
}

export function useIssueInvoice() {
  const invalidate = useInvoiceInvalidator();
  return useMutation({
    mutationFn: async (vars: { invoiceId: string; dealId: string }): Promise<RpcResult> => {
      const { data, error } = await supabase.rpc("issue_funder_invoice", {
        p_invoice_id: vars.invoiceId,
      });
      if (error) throw error;
      return (data ?? {}) as RpcResult;
    },
    onSuccess: (_d, v) => invalidate({ dealId: v.dealId, invoiceId: v.invoiceId }),
  });
}

export function useMarkInvoicePaid() {
  const invalidate = useInvoiceInvalidator();
  return useMutation({
    mutationFn: async (vars: {
      invoiceId: string;
      dealId: string;
      paidAmount: number;
      paymentReference: string | null;
    }): Promise<RpcResult> => {
      const { data, error } = await supabase.rpc("mark_funder_invoice_paid", {
        p_invoice_id: vars.invoiceId,
        p_paid_amount: vars.paidAmount,
        p_payment_reference: vars.paymentReference,
      });
      if (error) throw error;
      return (data ?? {}) as RpcResult;
    },
    onSuccess: (_d, v) => invalidate({ dealId: v.dealId, invoiceId: v.invoiceId }),
  });
}

export function useVoidInvoice() {
  const invalidate = useInvoiceInvalidator();
  return useMutation({
    mutationFn: async (vars: {
      invoiceId: string;
      dealId: string;
      override: string | null;
      reason: string | null;
    }): Promise<RpcResult> => {
      const { data, error } = await supabase.rpc("void_funder_invoice", {
        p_invoice_id: vars.invoiceId,
        p_override: vars.override,
        p_reason: vars.reason,
      });
      if (error) throw error;
      return (data ?? {}) as RpcResult;
    },
    onSuccess: (_d, v) => invalidate({ dealId: v.dealId, invoiceId: v.invoiceId }),
  });
}
