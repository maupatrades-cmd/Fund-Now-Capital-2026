import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

// Field leads (launch plan §2 item 3, §6, §8): field consultants and the Field Supervisor capture prospects in the
// field; the Sales Coordinator assigns them; the owner of the lead marks Contacted and Ready for sale; the Sales
// Coordinator opens the client file. Ready for sale writes the R150 / R100 lead fees, which the Sales Coordinator
// confirms and the Administrator approves. The database enforces every step; these hooks only call it.

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
}

export type FieldLeadStatus = "captured" | "new_leads" | "assigned" | "contacted" | "ready_for_sale" | "converted" | "dropped";
export const FIELD_LEAD_STATUS_LABEL: Record<FieldLeadStatus, string> = {
  captured: "Captured", new_leads: "New Leads", assigned: "Assigned", contacted: "Contacted",
  ready_for_sale: "Ready for sale", converted: "Converted to client file", dropped: "Dropped",
};
export type FieldLead = {
  lead_id: string; business_name: string; contact_name: string; contact_cell: string | null; contact_email: string | null;
  area: string | null; status: FieldLeadStatus; captured_by: string; captured_by_name: string | null; captured_role: string;
  assigned_to: string | null; assigned_name: string | null; drop_reason: string | null; ready_at: string | null;
  created_at: string; updated_at: string;
  history: { at: string; who: string | null; role: string; from: FieldLeadStatus | null; to: FieldLeadStatus; note: string | null }[];
};
export type LeadFee = {
  id: string; lead_id: string; business_name: string; fee_kind: "consultant_lead_fee" | "supervisor_lead_fee";
  beneficiary_name: string | null; amount: string; status: "pending" | "confirmed" | "approved" | "rejected"; earned_on: string;
};
export type MyLeadFee = Pick<LeadFee, "id" | "business_name" | "fee_kind" | "amount" | "status" | "earned_on">;
export type FieldSummary = { captured_mtd: number; ready_mtd: number; open_leads: number; fees_pending: string; fees_approved: string };
export const LEAD_FEE_STATUS_LABEL: Record<LeadFee["status"], string> = {
  pending: "Waiting for the Sales Coordinator", confirmed: "Waiting for the Administrator", approved: "Approved", rejected: "Rejected",
};

const invalidate = (qc: ReturnType<typeof useQueryClient>) => {
  for (const key of ["field-leads", "field-summary", "my-lead-fees", "lead-fees", "my-targets"]) void qc.invalidateQueries({ queryKey: [key] });
};

export function useFieldLeads(openOnly: boolean, enabled = true) {
  return useQuery({ queryKey: ["field-leads", openOnly], enabled, queryFn: () => rpc<FieldLead[]>("staff_field_leads", { p_open_only: openOnly }) });
}
export function useFieldLeadAssignees(enabled: boolean) {
  return useQuery({
    queryKey: ["field-lead-assignees"], enabled, staleTime: 60_000,
    queryFn: () => rpc<{ profile_id: string; full_name: string | null; staff_role: string }[]>("staff_field_lead_assignees"),
  });
}
export function useLeadFees(status: LeadFee["status"] | null, enabled: boolean) {
  return useQuery({ queryKey: ["lead-fees", status], enabled, queryFn: () => rpc<LeadFee[]>("staff_lead_fees", { p_status: status }) });
}
export function useMyLeadFees(enabled: boolean) {
  return useQuery({ queryKey: ["my-lead-fees"], enabled, queryFn: () => rpc<MyLeadFee[]>("my_lead_fees") });
}
export function useFieldSummary(enabled: boolean) {
  return useQuery({
    queryKey: ["field-summary"], enabled,
    queryFn: () => rpc<FieldSummary[]>("my_field_lead_summary").then((rows) => rows[0] ?? null),
  });
}

export type CaptureInput = {
  businessName: string; contactName: string; contactCell: string; contactEmail: string; cipc: string; area: string; note: string;
  idempotencyKey: string;
};
export type CaptureResult = { status: "created" | "existing" | "already_registered"; lead_id: string | null; possible_duplicate?: boolean };
export function useCaptureFieldLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (i: CaptureInput) => rpc<CaptureResult>("staff_capture_field_lead", {
      p_business_name: i.businessName, p_contact_name: i.contactName, p_contact_cell: i.contactCell, p_contact_email: i.contactEmail,
      p_cipc_number: i.cipc, p_area: i.area, p_note: i.note, p_idempotency_key: i.idempotencyKey,
    }),
    onSuccess: () => invalidate(qc),
  });
}
export function useMoveFieldLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (i: { leadId: string; to: FieldLeadStatus; note: string; assignedTo: string | null }) =>
      rpc<string>("staff_move_field_lead", { p_lead_id: i.leadId, p_to: i.to, p_note: i.note || null, p_assigned_to: i.assignedTo })
        .then((to) => { if (to !== i.to) throw new Error("The lead was not moved"); return to; }),
    onSuccess: () => invalidate(qc),
  });
}
export function useConvertFieldLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (i: { leadId: string; fundingType: string; amount: number | null; note: string }) =>
      rpc<string>("staff_convert_field_lead", { p_lead_id: i.leadId, p_funding_type: i.fundingType, p_funding_amount: i.amount, p_note: i.note || null })
        .then((id) => { if (id !== i.leadId) throw new Error("The client file was not opened"); return id; }),
    onSuccess: () => { invalidate(qc); void qc.invalidateQueries({ queryKey: ["staff-intake-queue"] }); },
  });
}
export function useDecideLeadFee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (i: { feeId: string; decision: "confirm" | "approve" | "reject"; note: string }) =>
      rpc<string>("staff_decide_lead_fee", { p_fee_id: i.feeId, p_decision: i.decision, p_note: i.note || null })
        .then((s) => { if (!s) throw new Error("The decision was not saved"); return s; }),
    onSuccess: () => invalidate(qc),
  });
}

export const rand = (v: string | number) =>
  `R${Number(v).toLocaleString("en-ZA", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
