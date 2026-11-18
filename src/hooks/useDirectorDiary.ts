import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { CalendarVisibility, EventCategory } from "@/lib/ownerCalendar";

// "Manage my diary" (owner, 18 Nov 2026): a staff member the Director trusts fills in her diary for her. Every read and
// write goes through SECURITY DEFINER RPCs that check the live 'manage_diary' grant. A Personal event comes back only
// as a busy block (no title, type or notes) and can never be changed here.

export type DiaryCalendar = { calendar_owner_id: string; calendar_owner_name: string };
export type DirectorDiaryEvent = {
  id: string; starts_at: string; ends_at: string; status: "scheduled" | "completed";
  is_personal: boolean; is_booking: boolean;
  category: EventCategory | null; title: string; visibility: CalendarVisibility; public_title: string | null; notes: string | null;
  client_id: string | null; lead_id: string | null; deal_id: string | null;
  client_name: string | null; lead_name: string | null; deal_reference: string | null;
  created_by_name: string | null; can_change: boolean;
};
export type DiaryLinkOption = { kind: "client" | "lead" | "deal"; id: string; label: string; client_id: string | null };

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
}

// The Director's calendars the caller may fill in (empty for everyone without a live grant).
export function useDiaryCalendars() {
  return useQuery({
    queryKey: ["director-diary-calendars"],
    queryFn: () => rpc<DiaryCalendar[]>("staff_diary_calendars"),
    staleTime: 60_000,
  });
}

export function useDirectorDiaryEvents(owner: string | null, start: Date, end: Date) {
  return useQuery({
    queryKey: ["director-diary", owner, start.toISOString(), end.toISOString()],
    enabled: !!owner,
    queryFn: () => rpc<DirectorDiaryEvent[]>("staff_diary_events", { p_calendar_owner: owner, p_from: start.toISOString(), p_to: end.toISOString() }),
  });
}

export function useDiaryLinkOptions(owner: string | null) {
  return useQuery({
    queryKey: ["director-diary-links", owner],
    enabled: !!owner,
    queryFn: () => rpc<DiaryLinkOption[]>("staff_diary_link_options", { p_calendar_owner: owner }),
    staleTime: 5 * 60_000,
  });
}

export type DiaryEventInput = {
  title: string; category: EventCategory; startsAt: string; endsAt: string; visibility: CalendarVisibility;
  publicTitle: string; notes: string; clientId: string; leadId: string; dealId: string;
};
const args = (i: DiaryEventInput) => ({
  p_title: i.title.trim(), p_category: i.category, p_starts_at: i.startsAt, p_ends_at: i.endsAt, p_visibility: i.visibility,
  p_public_title: i.visibility === "public" ? i.publicTitle.trim() : null, p_notes: i.notes.trim() || null,
  p_client_id: i.clientId || null, p_lead_id: i.leadId || null, p_deal_id: i.dealId || null,
});

export function useSaveDiaryEvent(owner: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ eventId, input }: { eventId?: string; input: DiaryEventInput }) => {
      // Both RPCs return the event id and raise when nothing changed, so a silent no-op cannot pass as success.
      const id = eventId
        ? await rpc<string>("staff_diary_update_event", { p_event_id: eventId, ...args(input) })
        : await rpc<string>("staff_diary_create_event", { p_calendar_owner: owner, ...args(input) });
      if (!id) throw new Error("The diary was not changed. Please try again.");
      return id;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["director-diary"] }),
  });
}

export function useCancelDiaryEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ eventId, reason }: { eventId: string; reason: string }) => {
      const id = await rpc<string>("staff_diary_cancel_event", { p_event_id: eventId, p_reason: reason.trim() });
      if (!id) throw new Error("The event was not cancelled. Please try again.");
      return id;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["director-diary"] }),
  });
}
