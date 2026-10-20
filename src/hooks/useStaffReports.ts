import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

// Administrator batch 4 (owner spec §11, §17): the Director's daily briefing, the end-of-day report, the Friday
// 60-files report, escalations to the Director and the complaints log. Every read and write goes through a
// role-checked database function; the tables have no grants. The reports carry counts only: no money, no funders.

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
}

export type BriefingTask = { title: string; priority: string; due_at: string | null; route_to: string; assignee: string | null; business_name: string | null };
export type Briefing = {
  day: string;
  bookings: { starts_at: string; ends_at: string; category: string; title: string; business_name: string | null }[];
  time_requests_pending: number;
  tasks: { open: number; overdue: number; awaiting_acceptance: number; founder_decisions: number; urgent: BriefingTask[] };
  urgent: {
    escalations_open: number; escalations: { title: string; note: string; created_at: string }[];
    complaints_unacknowledged: number; complaints_open: number; callbacks_due_today: number; files_with_founder: number;
  };
};
export type EndOfDay = {
  day: string;
  files_opened: { business_name: string; channel: string; handler: string | null; opened_at: string }[];
  documents_received: { count: number; by_file: { business_name: string; received: number }[] };
  files_completed: number;
  leads_assigned: { business_name: string; assigned_to: string | null; by_role: string | null; at: string }[];
  outbound_assigned: number;
  tasks: { created: number; completed: number; outstanding: number; overdue: number; outstanding_by_person: { person: string; open: number; overdue: number }[] };
  complaints_logged: number;
  escalations_raised: number;
};
export type FilesProgress = {
  day: string; month: string; week_start: string; target: number;
  files_opened_month: number; files_opened_week: number; working_days_left: number; files_needed_per_day: number | null;
  documents_complete_month: number; documents_complete_week: number;
  // Counts of admin-fee invoices fully paid (receipt issued); older reports carried a not-tracked note.
  admin_fees_paid: { not_tracked: boolean; note?: string; month?: number; week?: number };
  files_in_progress: Record<string, number>;
  deals_in_progress: Record<string, number>;
};

export function useDirectorBriefing(day: string | null, enabled: boolean) {
  return useQuery({ queryKey: ["report-briefing", day], enabled, queryFn: () => rpc<Briefing>("staff_director_briefing", { p_day: day }) });
}
export function useEndOfDayReport(day: string | null, enabled: boolean) {
  return useQuery({ queryKey: ["report-eod", day], enabled, queryFn: () => rpc<EndOfDay>("staff_end_of_day_report", { p_day: day }) });
}
export function useFilesProgressReport(day: string | null, enabled: boolean) {
  return useQuery({ queryKey: ["report-files", day], enabled, queryFn: () => rpc<FilesProgress>("staff_files_progress_report", { p_day: day }) });
}

export type Escalation = {
  escalation_id: string; source_kind: "task" | "complaint" | "manual"; title: string; note: string; automatic: boolean;
  raised_by: string | null; business_name: string | null; created_at: string; hours_open: number;
  resolved_at: string | null; resolved_by: string | null; resolution_note: string | null;
};
export function useEscalationBoard(openOnly: boolean, enabled: boolean) {
  return useQuery({ queryKey: ["escalations", openOnly], enabled, queryFn: () => rpc<Escalation[]>("staff_escalation_board", { p_open_only: openOnly }) });
}
export function useEscalate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (i: { note: string; leadId?: string | null; taskId?: string | null }) =>
      rpc<string>("staff_escalate", { p_note: i.note, p_lead_id: i.leadId ?? null, p_task_id: i.taskId ?? null })
        .then((id) => { if (!id) throw new Error("It was not escalated"); return id; }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["escalations"] }); },
  });
}
export function useResolveEscalation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (i: { id: string; note: string }) =>
      rpc<string | null>("staff_resolve_escalation", { p_escalation_id: i.id, p_note: i.note })
        .then((at) => { if (!at) throw new Error("The escalation was not closed"); return at; }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["escalations"] }); },
  });
}

export type ComplaintKind = "client" | "agent" | "other";
export type AckMethod = "phone" | "email" | "whatsapp" | "in_person";
export type Complaint = {
  complaint_id: string; complainant_kind: ComplaintKind; complainant_name: string; business_name: string | null; details: string;
  received_at: string; logged_by: string | null; acknowledged_at: string | null; acknowledged_method: AckMethod | null;
  acknowledged_late: boolean; resolved_at: string | null; resolution_note: string | null; can_resolve: boolean;
};
export function useComplaints(openOnly: boolean) {
  return useQuery({ queryKey: ["complaints", openOnly], queryFn: () => rpc<Complaint[]>("staff_complaints_list", { p_open_only: openOnly }) });
}
export function useLogComplaint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (i: { kind: ComplaintKind; name: string; details: string; receivedAt: string | null }) =>
      rpc<string>("staff_log_complaint", { p_kind: i.kind, p_name: i.name, p_details: i.details, p_lead_id: null, p_received_at: i.receivedAt })
        .then((id) => { if (!id) throw new Error("The complaint was not logged"); return id; }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["complaints"] });
      void qc.invalidateQueries({ queryKey: ["escalations"] });
    },
  });
}
export function useComplaintStep() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (i: { id: string; step: "acknowledged" | "resolved"; note: string; method?: AckMethod }) =>
      rpc<string | null>("staff_complaint_step", { p_complaint_id: i.id, p_event: i.step, p_note: i.note, p_method: i.method ?? null })
        .then((at) => { if (!at) throw new Error("The complaint was not updated"); return at; }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["complaints"] }); },
  });
}
