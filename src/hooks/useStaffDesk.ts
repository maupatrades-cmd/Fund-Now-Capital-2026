import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

// Switchboard / Coordinator workspace data. Every read and write goes through a
// role-checked database function (staff roles have no table access), so these
// hooks only shape requests and responses. Money, bank, ID contents, funder
// identity and stored documents are not reachable from here by design.

export type StaffRole = "owner" | "coordinator" | "switchboard";

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
}

export function useStaffRole() {
  return useQuery({
    queryKey: ["staff-actor-role"],
    staleTime: 60_000,
    queryFn: () => rpc<StaffRole | null>("staff_actor_role"),
  });
}

// "Waiting for the Owner to activate your account" screen: own row only.
export function useOwnStaffAccess() {
  return useQuery({
    queryKey: ["staff-access-own"],
    queryFn: async () => {
      const { data, error } = await supabase.from("staff_access").select("access_enabled").maybeSingle();
      if (error) throw error;
      return { enabled: data?.access_enabled === true };
    },
  });
}

// ---- Calls ---------------------------------------------------------------
export const CALLER_KINDS = [
  ["new_enquirer", "New enquirer"], ["existing_client", "Existing client"], ["referral_agent", "Referral agent"],
  ["team_leader", "Team Leader"], ["partner", "Partner"], ["funder_contact", "Funder contact"], ["other", "Other"],
] as const;
export const CALL_TOPICS = [
  ["new_enquiry", "New enquiry"], ["document_followup", "Document follow-up"], ["status_query", "Status query"],
  ["callback_request", "Callback request"], ["complaint", "Complaint"], ["other", "Other"],
] as const;
export const CALL_OUTCOMES = [
  ["resolved", "Resolved"], ["routed", "Routed to someone"], ["callback_needed", "Callback needed"], ["no_action", "No action"],
] as const;

export type StaffCall = {
  id: string; shift_date: string; logged_at: string; logged_by_name: string; logged_by_role: string;
  direction: "inbound" | "outbound"; caller_kind: string; caller_name: string; caller_phone: string | null;
  business_name: string | null; topic: string; summary: string; outcome: string;
  callback_due_at: string | null; lead_id: string | null; corrects_id: string | null;
};

export type LogCallInput = {
  direction: "inbound" | "outbound"; callerKind: string; callerName: string; callerPhone: string;
  businessName: string; topic: string; summary: string; outcome: string;
  callbackDueAt: string | null; leadId: string | null; correctsId?: string | null;
};

export function useStaffCalls(shiftDate?: string) {
  return useQuery({
    queryKey: ["staff-calls", shiftDate ?? "all"],
    queryFn: () => rpc<StaffCall[]>("staff_call_log_list", { p_shift_date: shiftDate ?? null, p_limit: 100 }),
  });
}

export function useLogCall() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (i: LogCallInput) => rpc<string>("staff_log_call", {
      p_direction: i.direction, p_caller_kind: i.callerKind, p_caller_name: i.callerName,
      p_caller_phone: i.callerPhone || null, p_business_name: i.businessName || null, p_topic: i.topic,
      p_summary: i.summary, p_outcome: i.outcome, p_callback_due_at: i.callbackDueAt,
      p_lead_id: i.leadId, p_corrects_id: i.correctsId ?? null,
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["staff-calls"] });
      void qc.invalidateQueries({ queryKey: ["staff-diary"] });
    },
  });
}

// ---- Handover ------------------------------------------------------------
export type StaffHandover = {
  id: string; shift_date: string; shift_label: string; author_name: string; author_role: string;
  summary: string; open_items: { text: string }[]; created_at: string;
  acknowledged_by_name: string | null; acknowledged_at: string | null;
};

export function useStaffHandovers() {
  return useQuery({ queryKey: ["staff-handovers"], queryFn: () => rpc<StaffHandover[]>("staff_handover_list", { p_days: 3 }) });
}

export function useWriteHandover() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (i: { shiftLabel: string; summary: string; openItems: string[] }) =>
      rpc<string>("staff_write_handover", {
        p_shift_label: i.shiftLabel, p_summary: i.summary,
        p_open_items: i.openItems.filter((t) => t.trim()).map((text) => ({ text: text.trim() })),
      }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["staff-handovers"] }); void qc.invalidateQueries({ queryKey: ["staff-diary"] }); },
  });
}

export function useAcknowledgeHandover() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => rpc<void>("staff_acknowledge_handover", { p_handover_id: id }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["staff-handovers"] }); void qc.invalidateQueries({ queryKey: ["staff-diary"] }); },
  });
}

// ---- Tasks ---------------------------------------------------------------
export type RouteTo = "switchboard" | "coordinator" | "owner";
export type StaffTask = {
  id: string; title: string; notes: string | null; task_kind: string; priority: string; status: string;
  due_at: string | null; route_to: RouteTo; assigned_name: string | null; lead_id: string | null;
  business_name: string | null; created_by_name: string; created_role: string; created_at: string; overdue: boolean;
};

export function useStaffTasks(status: "open" | "done" | "cancelled" | null = "open") {
  return useQuery({ queryKey: ["staff-tasks", status], queryFn: () => rpc<StaffTask[]>("staff_task_list", { p_status: status, p_limit: 100 }) });
}

function invalidateTasks(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ["staff-tasks"] });
  void qc.invalidateQueries({ queryKey: ["staff-diary"] });
}

export function useCreateStaffTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (i: { title: string; notes: string; kind: string; priority: string; dueAt: string | null; routeTo: RouteTo; leadId?: string | null; callLogId?: string | null }) =>
      rpc<string>("staff_create_task", {
        p_title: i.title, p_notes: i.notes || null, p_task_kind: i.kind, p_priority: i.priority, p_due_at: i.dueAt,
        p_route_to: i.routeTo, p_lead_id: i.leadId ?? null, p_call_log_id: i.callLogId ?? null,
      }),
    onSuccess: () => invalidateTasks(qc),
  });
}

export function useRouteStaffTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (i: { taskId: string; routeTo: RouteTo; reason: string }) =>
      rpc<void>("staff_route_task", { p_task_id: i.taskId, p_route_to: i.routeTo, p_reason: i.reason, p_assigned_to: null }),
    onSuccess: () => invalidateTasks(qc),
  });
}

export function useCloseStaffTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (i: { taskId: string; outcome: "done" | "cancelled"; note: string }) =>
      rpc<void>("staff_close_task", { p_task_id: i.taskId, p_outcome: i.outcome, p_note: i.note || null }),
    onSuccess: () => invalidateTasks(qc),
  });
}

// ---- Intake queue, lookups, documents, diary -------------------------------
export type IntakeRow = {
  lead_id: string; business_name: string; contact_name: string; contact_cell: string | null; contact_email: string | null;
  funding_type: string; funding_type_label: string; requested_amount: number | null; channel: string;
  organisation_name: string | null; team_name: string | null; agent_name: string | null;
  workflow_status: string; assignee_name: string | null; registered_at: string; first_complete_at: string | null;
  archived_at: string | null; missing_documents: string[]; has_review_flag: boolean;
};

export function useIntakeQueue(status: string | null = null, includeArchived = false) {
  return useQuery({
    queryKey: ["staff-intake-queue", status, includeArchived],
    queryFn: () => rpc<IntakeRow[]>("staff_intake_queue", { p_status: status, p_include_archived: includeArchived, p_limit: 100, p_offset: 0 }),
  });
}

export type IntakeLookups = {
  funding_types: { code: string; label: string }[];
  organisations: { id: string; name: string }[];
  teams: { id: string; name: string; organisation_id: string }[];
  members: { profile_id: string; name: string; team_id: string; membership_role: string }[];
  direct_agents: { profile_id: string; name: string }[];
  partner_agents: { profile_id: string; name: string; organisation_id: string }[];
};

export function useIntakeLookups() {
  return useQuery({ queryKey: ["staff-intake-lookups"], staleTime: 5 * 60_000, queryFn: () => rpc<IntakeLookups>("staff_intake_lookups") });
}

export type RegisterIntakeInput = {
  businessName: string; contactName: string; contactCell: string; contactEmail: string; cipc: string;
  fundingType: string; amount: number | null; purpose: string;
  channel: "direct_agent" | "team" | "referral_partner";
  organisationId: string | null; teamId: string | null; agentId: string | null; claimedAgent: string;
  idempotencyKey: string;
};

export type RegisterIntakeResult = { status: string; lead_id?: string; [k: string]: unknown };

export function useRegisterIntake() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (i: RegisterIntakeInput) => rpc<RegisterIntakeResult>("staff_register_intake", {
      p_business_name: i.businessName, p_contact_name: i.contactName, p_contact_cell: i.contactCell || null,
      p_contact_email: i.contactEmail || null, p_cipc_number: i.cipc || null, p_funding_type: i.fundingType,
      p_funding_amount: i.amount, p_funding_purpose: i.purpose || null, p_channel: i.channel,
      p_organisation_id: i.organisationId, p_team_id: i.teamId, p_agent_profile_id: i.agentId,
      p_claimed_agent_reference: i.claimedAgent || null, p_idempotency_key: i.idempotencyKey,
    }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["staff-intake-queue"] }); },
  });
}

export type ChecklistRow = {
  document_type: string; requirement: string; received: boolean; received_count: number;
  last_received_at: string | null; flagged_suspicious: boolean;
};

export function useDocumentChecklist(leadId: string | null) {
  return useQuery({
    queryKey: ["staff-doc-checklist", leadId],
    enabled: !!leadId,
    queryFn: () => rpc<ChecklistRow[]>("staff_document_checklist", { p_lead_id: leadId }),
  });
}

export function useRecordReceipt(leadId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (i: { documentType: string; via: string; label: string }) =>
      rpc<{ receipt_id: string }>("staff_record_document_receipt", {
        p_lead_id: leadId, p_document_type: i.documentType, p_received_via: i.via,
        p_file_label: i.label || null, p_original_filename: null, p_sha256: null,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["staff-doc-checklist", leadId] });
      void qc.invalidateQueries({ queryKey: ["staff-intake-queue"] });
    },
  });
}

export type StaffDiary = {
  date: string;
  tasks_due: { id: string; title: string; due_at: string; route_to: string; priority: string; overdue: boolean }[];
  callbacks_due: { id: string; caller_name: string; caller_phone: string | null; due_at: string; topic: string }[];
  unacknowledged_handovers: number;
};

export function useStaffDiary() {
  return useQuery({ queryKey: ["staff-diary"], queryFn: () => rpc<StaffDiary>("staff_diary", { p_date: null }) });
}
