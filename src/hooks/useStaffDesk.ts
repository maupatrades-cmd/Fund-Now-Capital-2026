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

export type RegisterIntakeResult = {
  status: string;
  lead_id?: string;
  // The RPC returns an object of booleans, not a list.
  flags?: { recent_submission?: boolean; duplicate_contact?: boolean; registration_conflict?: boolean };
  [k: string]: unknown;
};

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

// ---- Calendar (Batch 3) ----------------------------------------------------
export type CalendarPermission = "view_availability" | "create" | "change_own" | "manage_others";
export const CALENDAR_PERMISSIONS: { value: CalendarPermission; label: string; help: string }[] = [
  { value: "view_availability", label: "View availability", help: "See busy and open blocks only" },
  { value: "create", label: "Create bookings", help: "Add bookings to this calendar" },
  { value: "change_own", label: "Change own bookings", help: "Reschedule or cancel bookings they created" },
  { value: "manage_others", label: "Manage others' bookings", help: "Reschedule or cancel anyone's booking on this calendar" },
];
export const BOOKING_CATEGORIES = [
  ["call", "Call"], ["consultation", "Consultation"], ["presentation", "Presentation"], ["paperwork_review", "Paperwork review"],
  ["submission", "Submission"], ["submission_update", "Submission update"], ["urgent", "Urgent"],
] as const;

export type MyGrant = { calendar_owner_id: string; calendar_owner_name: string; permission: CalendarPermission; effective_to: string | null };
export function useMyCalendarGrants() {
  return useQuery({ queryKey: ["staff-calendar-grants"], queryFn: () => rpc<MyGrant[]>("staff_my_calendar_grants") });
}

export type AvailabilityBlock = { kind: "busy" | "open"; starts_at: string; ends_at: string };
export function useCalendarAvailability(calendarOwner: string | null, from: string, to: string, enabled: boolean) {
  return useQuery({
    queryKey: ["staff-calendar-availability", calendarOwner, from, to],
    enabled: !!calendarOwner && enabled,
    queryFn: () => rpc<AvailabilityBlock[]>("calendar_availability", { p_calendar_owner: calendarOwner, p_from: from, p_to: to }),
  });
}

export type DiaryEvent = {
  event_id: string; starts_at: string; ends_at: string; status: string; display_title: string; is_mine: boolean;
  can_change: boolean; lead_id: string | null; notice_status: string | null; short_notice: boolean;
  needs_short_notice_handling: boolean; confirmation_id: string | null;
};
export function useCalendarDiary(calendarOwner: string | null, from: string, to: string, enabled: boolean) {
  return useQuery({
    queryKey: ["staff-calendar-diary", calendarOwner, from, to],
    enabled: !!calendarOwner && enabled,
    queryFn: () => rpc<DiaryEvent[]>("staff_calendar_diary", { p_calendar_owner: calendarOwner, p_from: from, p_to: to }),
  });
}

function invalidateCalendar(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ["staff-calendar-diary"] });
  void qc.invalidateQueries({ queryKey: ["staff-calendar-availability"] });
}

export type CreateBookingInput = {
  calendarOwner: string; title: string; category: string; startsAt: string; endsAt: string; visibility: "private" | "busy" | "public";
  publicTitle: string; agenda: string; attendeeEmail: string; attendeeName: string; idempotencyKey: string;
};
export function useCreateBooking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (i: CreateBookingInput) => rpc<{ status: string; event_id: string; short_notice?: boolean }>("staff_create_calendar_event", {
      p_calendar_owner: i.calendarOwner, p_title: i.title, p_category: i.category, p_starts_at: i.startsAt, p_ends_at: i.endsAt,
      p_visibility: i.visibility, p_public_title: i.publicTitle || null, p_agenda: i.agenda || null, p_lead_id: null,
      p_attendee_email: i.attendeeEmail || null, p_attendee_name: i.attendeeName || null, p_idempotency_key: i.idempotencyKey,
    }),
    onSuccess: () => invalidateCalendar(qc),
  });
}

export function useRescheduleBooking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (i: { eventId: string; startsAt: string; endsAt: string; reason: string }) =>
      rpc<{ notices_queued: number; short_notice: boolean }>("staff_reschedule_calendar_event", {
        p_event_id: i.eventId, p_starts_at: i.startsAt, p_ends_at: i.endsAt, p_reason: i.reason,
      }),
    onSuccess: () => invalidateCalendar(qc),
  });
}

export function useCancelBooking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (i: { eventId: string; reason: string }) => rpc<{ notices_queued: number }>("staff_cancel_calendar_event", { p_event_id: i.eventId, p_reason: i.reason }),
    onSuccess: () => invalidateCalendar(qc),
  });
}

export function useRecordShortNoticeHandling() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (i: { confirmationId: string; note: string }) => rpc<void>("staff_record_short_notice_handling", { p_confirmation_id: i.confirmationId, p_note: i.note }),
    onSuccess: () => invalidateCalendar(qc),
  });
}

// ---- Check-in reminders (Coordinator / Owner) --------------------------------
export type CheckinReminder = {
  id: string; subject_kind: "team" | "organisation"; subject_name: string | null; leader_name: string | null;
  cadence: string; due_on: string; status: string; overdue: boolean; completed_by_name: string | null; completed_at: string | null; note: string | null;
};
export function useCheckinReminders(enabled: boolean) {
  return useQuery({ queryKey: ["staff-checkins"], enabled, queryFn: () => rpc<CheckinReminder[]>("staff_checkin_list", { p_status: "open" }) });
}
export function useCompleteCheckin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (i: { id: string; note: string }) => rpc<void>("staff_complete_checkin", { p_reminder_id: i.id, p_note: i.note || null }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["staff-checkins"] }); },
  });
}

// ---- Call follow-through -------------------------------------------------------
export type CallTask = { task_id: string; title: string; status: string; route_to: string; due_at: string | null; completed_by_name: string | null; completed_at: string | null; completion_note: string | null };
export function useCallTasks(callId: string, enabled: boolean) {
  return useQuery({ queryKey: ["staff-call-tasks", callId], enabled, queryFn: () => rpc<CallTask[]>("staff_call_tasks", { p_call_log_id: callId }) });
}

// ---- Owner: calendar access admin ---------------------------------------------------
export type GrantRow = {
  id: string; calendar_owner_id: string; calendar_owner_name: string; grantee_id: string; grantee_name: string;
  permission: CalendarPermission; effective_from: string; effective_to: string | null; revoked_at: string | null;
};
export function useOwnerGrantList() {
  return useQuery({ queryKey: ["owner-calendar-grants"], queryFn: () => rpc<GrantRow[]>("owner_calendar_grant_list") });
}
export function useSetCalendarGrant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (i: { calendarOwner: string; grantee: string; permission: CalendarPermission; effectiveTo: string | null }) =>
      rpc<string>("owner_set_calendar_grant", { p_calendar_owner: i.calendarOwner, p_grantee: i.grantee, p_permission: i.permission, p_effective_to: i.effectiveTo }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["owner-calendar-grants"] }); },
  });
}
export function useRevokeCalendarGrant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (i: { grantId: string; reason: string }) => rpc<void>("owner_revoke_calendar_grant", { p_grant_id: i.grantId, p_reason: i.reason }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["owner-calendar-grants"] }); },
  });
}

// Approved status wording per file (never funder names, rates or tiers). Staff see this
// instead of any funder-side stage.
export function useStatusWordings(leadIds: string[]) {
  const key = [...leadIds].sort().join(",");
  return useQuery({
    queryKey: ["staff-status-wordings", key],
    enabled: leadIds.length > 0,
    queryFn: async (): Promise<Record<string, string>> => {
      const rows = await rpc<{ lead_id: string; wording: string | null }[]>("staff_status_wordings", { p_lead_ids: leadIds.slice(0, 100) });
      return Object.fromEntries((rows ?? []).map((r) => [r.lead_id, r.wording ?? ""]));
    },
  });
}

// ---- Founder decisions (SC3) ----------------------------------------------
export type DealSummaryInput = {
  leadId: string; amountPurpose: string; turnoverTrading: string; documentsNote: string; redFlags: string;
};
export type FounderDecision = "approve_to_submit" | "send_back_with_query" | "decline" | "call_me";
export const DECLINE_CATEGORIES = [
  ["affordability", "Affordability"], ["documentation", "Documentation"], ["credit_profile", "Credit profile"],
  ["sector_policy", "Sector policy"], ["other", "Other"],
] as const;

// Coordinator (or Owner) sends a Complete file to the Founder with the Deal Summary.
export function useSendToFounder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (i: DealSummaryInput) =>
      rpc<string>("staff_send_founder_decision", {
        p_lead_id: i.leadId, p_amount_purpose: i.amountPurpose, p_turnover_trading: i.turnoverTrading,
        p_documents_note: i.documentsNote || null, p_red_flags: i.redFlags || null,
      }),
    onSuccess: () => { invalidateTasks(qc); void qc.invalidateQueries({ queryKey: ["staff-intake-queue"] }); void qc.invalidateQueries({ queryKey: ["staff-file-decision"] }); },
  });
}

export type DealSummary = {
  business_name: string; funding_type_label: string; requested_amount: number | null; amount_purpose: string;
  turnover_trading: string; documents_note: string | null; red_flags: string | null;
  agent_name: string | null; team_name: string | null; written_at: string;
};
export function useDealSummary(taskId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["staff-deal-summary", taskId],
    enabled,
    queryFn: async () => (await rpc<DealSummary[]>("owner_deal_summary", { p_task_id: taskId }))?.[0] ?? null,
  });
}

export function useDecideFounderTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (i: { taskId: string; decision: FounderDecision; note: string; declineCategory?: string }) =>
      rpc<void>("owner_decide_founder_task", {
        p_task_id: i.taskId, p_decision: i.decision, p_note: i.note || null, p_decline_category: i.declineCategory ?? null,
      }),
    onSuccess: () => { invalidateTasks(qc); void qc.invalidateQueries({ queryKey: ["staff-intake-queue"] }); void qc.invalidateQueries({ queryKey: ["staff-file-decision"] }); },
  });
}

export type FileDecision = { decision: FounderDecision; decline_category: string | null; note: string | null; decided_at: string };
export function useFileDecision(leadId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["staff-file-decision", leadId],
    enabled,
    queryFn: async () => (await rpc<FileDecision[]>("staff_file_decision", { p_lead_id: leadId }))?.[0] ?? null,
  });
}

// ---- Requests for Founder time outside opened slots (SC4) ------------------
export type TimeRequest = {
  id: string; category: string; starts_at: string; ends_at: string; reason: string; status: "pending" | "accepted" | "declined";
  owner_note: string | null; requester_name: string; created_at: string; decided_at: string | null;
};
export function useTimeRequests(enabled: boolean) {
  return useQuery({ queryKey: ["staff-time-requests"], enabled, queryFn: () => rpc<TimeRequest[]>("staff_time_requests", { p_status: null }) });
}
export function useRequestFounderTime() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (i: { calendarOwner: string; category: string; startsAt: string; endsAt: string; reason: string }) =>
      rpc<string>("staff_request_founder_time", {
        p_calendar_owner: i.calendarOwner, p_category: i.category, p_starts_at: i.startsAt, p_ends_at: i.endsAt, p_reason: i.reason, p_lead_id: null,
      }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["staff-time-requests"] }); },
  });
}
export function useDecideTimeRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (i: { requestId: string; accept: boolean; note: string }) =>
      rpc<string | null>("owner_decide_time_request", { p_request_id: i.requestId, p_accept: i.accept, p_note: i.note || null }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["staff-time-requests"] }); invalidateCalendar(qc); },
  });
}

// ---- Coordinator landing (SC5) ----------------------------------------------
export type CoordinatorLanding = {
  status_counts: Record<string, number>;
  oldest_open_files: { lead_id: string; business_name: string; workflow_status: string; waiting_days: number; missing_count: number }[];
  founder_open: number;
  founder_recent: { lead_id: string; business_name: string; decision: FounderDecision; decline_category: string | null; note: string | null; decided_at: string }[];
  answers_amber: number; answers_red: number;
  time_requests_pending: number; time_requests_answered_7d: number; my_open_tasks: number; my_overdue_tasks: number;
};
export function useCoordinatorLanding(enabled: boolean) {
  return useQuery({ queryKey: ["staff-coordinator-landing"], enabled, refetchInterval: 60_000, queryFn: () => rpc<CoordinatorLanding>("staff_coordinator_landing") });
}

// ---- Answer desk (SC7) ------------------------------------------------------
export const ANSWER_KINDS = [
  ["status_question", "Status question (4 working hours)"], ["founder_holding_reply", "Founder question: holding reply (same day)"],
  ["founder_answer", "Founder question: answer (1 working day)"], ["outcome_relay", "Relay an outcome (1 working day)"],
  ["complaint_to_ops", "Complaint for the Operations Manager (same day)"],
] as const;
export const ASKER_TYPES = [["agent", "Agent"], ["team_leader", "Team Leader"], ["partner", "Partner"], ["client", "Client"], ["founder", "Founder"], ["other", "Other"]] as const;
export type AnswerItem = {
  id: string; kind: string; asker_type: string; asker_label: string | null; topic: string; lead_id: string | null; business_name: string | null;
  asked_at: string; due_at: string; status: "open" | "answered"; answered_at: string | null; answered_late: boolean | null;
  sla_state: "green" | "amber" | "red" | "answered"; minutes_left: number | null;
};
export function useAnswerDesk(includeAnswered: boolean, enabled: boolean) {
  return useQuery({
    queryKey: ["staff-answer-desk", includeAnswered], enabled, refetchInterval: 60_000,
    queryFn: () => rpc<AnswerItem[]>("staff_answer_desk", { p_include_answered: includeAnswered }),
  });
}
export function useLogAnswerItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (i: { kind: string; askerType: string; askerLabel: string; topic: string }) =>
      rpc<string>("staff_log_answer_item", { p_kind: i.kind, p_asker_type: i.askerType, p_asker_label: i.askerLabel || null, p_topic: i.topic, p_lead_id: null, p_asked_at: null }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["staff-answer-desk"] }); void qc.invalidateQueries({ queryKey: ["staff-coordinator-landing"] }); },
  });
}
export function useResolveAnswerItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (i: { id: string; note: string }) => rpc<void>("staff_resolve_answer_item", { p_id: i.id, p_note: i.note || null }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["staff-answer-desk"] }); void qc.invalidateQueries({ queryKey: ["staff-coordinator-landing"] }); },
  });
}

// ---- Day 3 / day 7 document chasers (Batch 4) -------------------------------
export type DocumentChaser = { id: string; lead_id: string; business_name: string; day_mark: 3 | 7; due_at: string; missing_documents: string[] };
export function useDocumentChasers(enabled: boolean) {
  return useQuery({ queryKey: ["staff-document-chasers"], enabled, refetchInterval: 60_000, queryFn: () => rpc<DocumentChaser[]>("staff_document_chasers") });
}
export function useCompleteDocumentChaser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (i: { id: string; note: string }) => rpc<void>("staff_complete_document_chaser", { p_id: i.id, p_note: i.note || null }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["staff-document-chasers"] }); },
  });
}

// ---- Queue actions: status, archive, assign, suspicious documents (Batch 4) --
export type IntakeDetail = {
  lead_id: string; workflow_status: string; archived_at: string | null; archive_reason_code: string | null;
  assignee_name: string | null; missing_documents: string[]; open_review_flags: number;
  receipts: { receipt_id: string; document_type: string; received_via: string; received_at: string; flagged_suspicious: boolean }[];
  history: { at: string; event: string; actor_role: string | null; actor_name: string | null; reason: string | null; to: string | null }[];
};
export function useIntakeDetail(leadId: string, enabled: boolean) {
  return useQuery({ queryKey: ["staff-intake-detail", leadId], enabled, queryFn: () => rpc<IntakeDetail>("staff_intake_detail", { p_lead_id: leadId }) });
}
export function useAssignableStaff(enabled: boolean) {
  return useQuery({ queryKey: ["staff-assignable"], enabled, staleTime: 5 * 60_000, queryFn: () => rpc<{ profile_id: string; full_name: string; staff_role: string }[]>("staff_assignable_staff") });
}
function useQueueMutation<T>(fn: string, toArgs: (i: T) => Record<string, unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (i: T) => rpc<unknown>(fn, toArgs(i)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["staff-intake-queue"] });
      void qc.invalidateQueries({ queryKey: ["staff-intake-detail"] });
      void qc.invalidateQueries({ queryKey: ["staff-coordinator-landing"] });
      void qc.invalidateQueries({ queryKey: ["staff-document-chasers"] });
    },
  });
}
export const ARCHIVE_REASONS = [["withdrawn", "Withdrawn"], ["duplicate", "Duplicate"], ["lapsed", "Lapsed"]] as const;
export const useSetIntakeStatus = () => useQueueMutation<{ leadId: string; to: string; reason: string }>(
  "staff_set_intake_status", (i) => ({ p_lead_id: i.leadId, p_to_status: i.to, p_reason: i.reason || null }));
export const useArchiveIntake = () => useQueueMutation<{ leadId: string; code: string; reason: string }>(
  "staff_archive_intake", (i) => ({ p_lead_id: i.leadId, p_reason_code: i.code, p_reason: i.reason }));
export const useReverseArchive = () => useQueueMutation<{ leadId: string; reason: string }>(
  "owner_reverse_intake_archive", (i) => ({ p_lead_id: i.leadId, p_reason: i.reason }));
export const useAssignIntake = () => useQueueMutation<{ leadId: string; assigneeId: string | null }>(
  "staff_assign_intake", (i) => ({ p_lead_id: i.leadId, p_assignee_id: i.assigneeId }));
export const useFlagReceipt = () => useQueueMutation<{ receiptId: string; reason: string }>(
  "staff_flag_document_suspicious", (i) => ({ p_receipt_id: i.receiptId, p_reason: i.reason }));
export const useClearReceiptFlag = () => useQueueMutation<{ receiptId: string; reason: string }>(
  "owner_clear_document_flag", (i) => ({ p_receipt_id: i.receiptId, p_reason: i.reason }));

// ---- Qualifying files and KPIs (SC9) -----------------------------------------
export type QualifyingFiles = {
  month: string; rate_per_file: number; count: number; estimate_total: number; cutoff_date: string; pay_date: string; status: string;
  files: { lead_id: string; business_name: string; handler_name: string | null; reached_founder_at: string }[];
};
export function useQualifyingFiles(enabled: boolean) {
  return useQuery({ queryKey: ["staff-qualifying-files"], enabled, queryFn: () => rpc<QualifyingFiles>("staff_qualifying_files") });
}
export type CoordinatorKpi = {
  key: string; label: string; target_pct: number; direction: "min" | "max"; sample?: number; value_pct?: number | null; not_tracked?: boolean;
};
export function useCoordinatorKpis(enabled: boolean) {
  return useQuery({ queryKey: ["staff-coordinator-kpis"], enabled, queryFn: () => rpc<{ days: number; kpis: CoordinatorKpi[] }>("staff_coordinator_kpis", { p_days: 30 }) });
}
