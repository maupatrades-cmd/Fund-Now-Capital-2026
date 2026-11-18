import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

// Field diary (owner, 17 Nov 2026): the Field Supervisor and field consultants book meetings and see their day and
// week. A consultant sees their own diary; the Field Supervisor also sees and books on consultants' diaries; the
// Director and the Administrator see every field diary. The database enforces all of it (field_meeting_* RPCs,
// migration 20261118121000); these hooks only call it.

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
}

export type FieldDiaryPerson = { profile_id: string; full_name: string | null; role: string; is_me: boolean };
export type FieldMeetingStatus = "scheduled" | "done" | "cancelled";
export type FieldMeeting = {
  id: string; owner_profile_id: string; owner_name: string | null; title: string; meeting_kind: "client" | "internal";
  starts_at: string; ends_at: string; location: string | null; lead_id: string | null; business_name: string | null;
  attendee_note: string | null; status: FieldMeetingStatus; cancel_reason: string | null; created_by_name: string | null;
  created_role: string; created_at: string;
};
export const FIELD_MEETING_STATUS_LABEL: Record<FieldMeetingStatus, string> = { scheduled: "Booked", done: "Done", cancelled: "Cancelled" };

const invalidate = (qc: ReturnType<typeof useQueryClient>) => void qc.invalidateQueries({ queryKey: ["field-meetings"] });

export function useFieldDiaryPeople(enabled = true) {
  return useQuery({ queryKey: ["field-diary-people"], enabled, staleTime: 60_000, queryFn: () => rpc<FieldDiaryPerson[]>("field_diary_people") });
}

// `person` null = the signed-in person's own diary. Dates are SAST calendar days (YYYY-MM-DD), inclusive.
export function useFieldMeetings(person: string | null, from: string, to: string, includeCancelled = false, enabled = true) {
  return useQuery({
    queryKey: ["field-meetings", person, from, to, includeCancelled], enabled,
    queryFn: () => rpc<FieldMeeting[]>("field_meetings_list", { p_person: person, p_from: from, p_to: to, p_include_cancelled: includeCancelled }),
  });
}

export type BookMeetingInput = {
  person: string | null; title: string; startsAt: string; endsAt: string; kind: "client" | "internal";
  location: string; leadId: string | null; note: string;
};
export function useBookFieldMeeting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (i: BookMeetingInput) => rpc<string>("field_meeting_book", {
      p_person: i.person, p_title: i.title, p_starts_at: i.startsAt, p_ends_at: i.endsAt, p_meeting_kind: i.kind,
      p_location: i.location || null, p_lead_id: i.leadId, p_note: i.note || null,
    }),
    onSuccess: () => invalidate(qc),
  });
}

export function useSetFieldMeetingStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (i: { id: string; status: "done" | "cancelled"; reason?: string }) =>
      rpc<string>("field_meeting_set_status", { p_meeting_id: i.id, p_status: i.status, p_reason: i.reason ?? null }),
    onSuccess: () => invalidate(qc),
  });
}

// SAST calendar helpers: the business runs on Johannesburg time whatever the phone's own zone is.
export const sastDay = (d: Date = new Date()) => d.toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });
export const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00+02:00`);
  d.setUTCDate(d.getUTCDate() + n);
  return sastDay(d);
};
// Monday of the SAST week that contains `day`.
export const weekStart = (day: string) => {
  const dow = new Date(`${day}T12:00:00+02:00`).getUTCDay(); // 0 = Sunday
  return addDays(day, dow === 0 ? -6 : 1 - dow);
};
// A SAST date + "HH:MM" from the form into an ISO timestamp the database reads unambiguously.
export const sastIso = (day: string, time: string) => `${day}T${time}:00+02:00`;
export const sastTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-ZA", { timeZone: "Africa/Johannesburg", hour: "2-digit", minute: "2-digit", hour12: false });
export const sastDayLabel = (day: string) =>
  new Date(`${day}T12:00:00+02:00`).toLocaleDateString("en-ZA", { timeZone: "Africa/Johannesburg", weekday: "long", day: "numeric", month: "long" });
