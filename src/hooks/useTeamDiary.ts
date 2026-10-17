import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

// Team diaries (Administrator spec §18): the Coordinator and Reception book appointments for direct agents,
// sub-agents, Team Leaders and partners; the client is emailed on every booking, move and cancellation.
// Every read and write goes through a role-checked database function (the tables have no grants).

export type TeamMember = { profile_id: string; full_name: string | null; member_type: string };
export type TeamAppointment = {
  appointment_id: string; member_id: string; member_name: string | null; member_type: string | null;
  client_name: string; client_email: string; client_phone: string | null; reason: string;
  starts_at: string; ends_at: string; status: "scheduled" | "cancelled";
  email_status: "queued" | "processing" | "sent" | "failed" | "superseded" | null; can_change: boolean;
};

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
}

export function useTeamDiaryMembers(enabled: boolean) {
  return useQuery({ queryKey: ["team-diary-members"], enabled, queryFn: () => rpc<TeamMember[]>("team_diary_members") });
}

export function useTeamAppointments(member: string | null, from: string, to: string) {
  return useQuery({
    queryKey: ["team-appointments", member, from, to],
    queryFn: () => rpc<TeamAppointment[]>("team_appointments_list", { p_member: member, p_from: from, p_to: to }),
  });
}

export function useBookTeamAppointment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (i: {
      member: string; clientName: string; clientEmail: string; clientPhone: string; reason: string;
      startsAt: string; endsAt: string; idempotencyKey: string;
    }) =>
      rpc<{ status: string; appointment_id: string }>("team_book_appointment", {
        p_member: i.member, p_client_name: i.clientName, p_client_email: i.clientEmail,
        p_client_phone: i.clientPhone.trim() || null, p_reason: i.reason, p_starts_at: i.startsAt,
        p_ends_at: i.endsAt, p_lead_id: null, p_idempotency_key: i.idempotencyKey,
      }).then((r) => {
        if (!r?.appointment_id) throw new Error("The appointment was not saved");
        return r;
      }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["team-appointments"] }); },
  });
}

export function useMoveTeamAppointment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (i: { id: string; startsAt: string; endsAt: string; reason: string }) =>
      rpc<{ appointment_id: string }>("team_move_appointment", {
        p_id: i.id, p_starts_at: i.startsAt, p_ends_at: i.endsAt, p_reason: i.reason,
      }).then((r) => {
        if (!r?.appointment_id) throw new Error("The appointment was not moved");
        return r;
      }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["team-appointments"] }); },
  });
}

export function useCancelTeamAppointment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (i: { id: string; reason: string }) =>
      rpc<{ appointment_id: string }>("team_cancel_appointment", { p_id: i.id, p_reason: i.reason }).then((r) => {
        if (!r?.appointment_id) throw new Error("The appointment was not cancelled");
        return r;
      }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["team-appointments"] }); },
  });
}
