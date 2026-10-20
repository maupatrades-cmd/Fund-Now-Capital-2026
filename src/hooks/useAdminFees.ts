import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

// Admin fees (owner spec §10, §12; Batch 5b): admin-fee invoices on a client file, Yoco card and EFT payments captured
// from the statements and matched to invoices (a receipt is issued automatically once an invoice is fully paid), and
// a daily reconciliation. For the Administrator and the Director only. Admin fees are FNC's own fee income: nothing
// here touches success fees, commission or funders. Amounts are checked and stored by the database.

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
}

export type InvoiceStatus = "unpaid" | "part_paid" | "paid" | "void";
export const INVOICE_STATUS: Record<InvoiceStatus, string> = { unpaid: "Unpaid", part_paid: "Part paid", paid: "Paid", void: "Void" };
export type AdminFeeInvoice = {
  invoice_id: string; invoice_number: string; lead_id: string; business_name: string; billed_to: string; billed_email: string | null;
  description: string; amount: string; paid: string; balance: string; status: InvoiceStatus; issued_at: string; due_on: string;
  overdue: boolean; receipt_number: string | null; void_reason: string | null;
};
export type PaymentStatus = "unmatched" | "matched" | "set_aside";
export type AdminFeePayment = {
  payment_id: string; method: "yoco" | "eft"; amount: string; received_on: string; reference: string; payer: string | null;
  status: PaymentStatus; invoice_id: string | null; invoice_number: string | null; business_name: string | null;
  exclude_reason: string | null; suggested_invoice_id: string | null; suggested_invoice_number: string | null; day_reconciled: boolean;
};
export type AdminFeeDay = {
  day: string; payments: number; unmatched: number; total_received: string; reconciled_at: string | null;
  reconciled_by: string | null; changed_after: boolean;
};
export type AdminFeeSettings = Partial<Record<
  "legal_name" | "registration_number" | "address" | "contact_email" | "contact_phone" | "bank_name" | "account_holder"
  | "account_number" | "branch_code" | "yoco_link" | "payment_note" | "updated_at", string | null>>;
export type AdminFeeDocument = {
  invoice: Omit<AdminFeeInvoice, "lead_id" | "overdue" | "receipt_number">;
  receipt: { receipt_number: string; issued_at: string } | null;
  payments: { method: "yoco" | "eft"; amount: string; received_on: string; reference: string }[];
  settings: AdminFeeSettings;
};

export const rands = (v: string | number | null | undefined) =>
  v === null || v === undefined ? "" : new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(Number(v));

const keys = ["admin-fee-invoices", "admin-fee-payments", "admin-fee-days"];
function useInvalidate() {
  const qc = useQueryClient();
  return () => { for (const k of keys) void qc.invalidateQueries({ queryKey: [k] }); };
}
const must = <T,>(v: T | null | undefined, what: string): T => { if (v === null || v === undefined) throw new Error(`${what} did not save`); return v; };

export function useAdminFeeInvoices(openOnly: boolean) {
  return useQuery({ queryKey: ["admin-fee-invoices", openOnly], queryFn: () => rpc<AdminFeeInvoice[]>("admin_fee_invoices_list", { p_open_only: openOnly }) });
}
export function useAdminFeePayments(openOnly: boolean) {
  return useQuery({ queryKey: ["admin-fee-payments", openOnly], queryFn: () => rpc<AdminFeePayment[]>("admin_fee_payments_list", { p_day: null, p_open_only: openOnly }) });
}
export function useAdminFeeDays() {
  return useQuery({ queryKey: ["admin-fee-days"], queryFn: () => rpc<AdminFeeDay[]>("admin_fee_days", { p_days: 14 }) });
}
export function useAdminFeeSettings() {
  return useQuery({ queryKey: ["admin-fee-settings"], queryFn: () => rpc<AdminFeeSettings>("admin_fee_settings_get") });
}
export function useAdminFeeDocument(invoiceId: string | undefined) {
  return useQuery({ queryKey: ["admin-fee-document", invoiceId], enabled: !!invoiceId, queryFn: () => rpc<AdminFeeDocument>("admin_fee_document", { p_invoice: invoiceId }) });
}

export function useIssueInvoice() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (i: { leadId: string; billedTo: string; billedEmail: string; description: string; amount: string; dueOn: string; key: string }) =>
      rpc<string>("admin_fee_issue_invoice", {
        p_lead_id: i.leadId, p_billed_to: i.billedTo, p_billed_email: i.billedEmail || null, p_description: i.description,
        p_amount: i.amount, p_due_on: i.dueOn, p_idempotency_key: i.key,
      }).then((id) => must(id, "The invoice")),
    onSuccess: invalidate,
  });
}
export function useVoidInvoice() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (i: { invoiceId: string; reason: string }) =>
      rpc<string>("admin_fee_void_invoice", { p_invoice: i.invoiceId, p_reason: i.reason }).then((v) => must(v, "The void")),
    onSuccess: invalidate,
  });
}
export function useRecordPayment() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (i: { method: "yoco" | "eft"; amount: string; receivedOn: string; reference: string; payer: string }) =>
      rpc<string>("admin_fee_record_payment", {
        p_method: i.method, p_amount: i.amount, p_received_on: i.receivedOn, p_reference: i.reference, p_payer: i.payer || null,
      }).then((id) => must(id, "The payment")),
    onSuccess: invalidate,
  });
}
export function useMatchPayment() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (i: { paymentId: string; invoiceId: string }) =>
      rpc<"paid" | "part_paid">("admin_fee_match", { p_payment: i.paymentId, p_invoice: i.invoiceId }).then((s) => must(s, "The match")),
    onSuccess: invalidate,
  });
}
export function useUnmatchPayment() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (i: { paymentId: string; reason: string }) =>
      rpc<string>("admin_fee_unmatch", { p_payment: i.paymentId, p_reason: i.reason }).then((v) => must(v, "The reversal")),
    onSuccess: invalidate,
  });
}
export function useExcludePayment() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (i: { paymentId: string; reason: string }) =>
      rpc<string>("admin_fee_exclude_payment", { p_payment: i.paymentId, p_reason: i.reason }).then((v) => must(v, "Setting it aside")),
    onSuccess: invalidate,
  });
}
export function useReconcileDay() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (i: { day: string; note: string }) =>
      rpc<string>("admin_fee_reconcile_day", { p_day: i.day, p_note: i.note || null }).then((v) => must(v, "The reconciliation")),
    onSuccess: invalidate,
  });
}
export function useSaveAdminFeeSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (s: AdminFeeSettings) => rpc<string>("owner_save_admin_fee_settings", { p: s }).then((v) => must(v, "The details")),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["admin-fee-settings"] }); },
  });
}
