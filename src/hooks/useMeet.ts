import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { DEFAULT_ICE_SERVERS } from "@/lib/meet/signal";

// In-CRM calls and meetings (owner, 24 Nov 2026). Every write goes through a SECURITY DEFINER RPC that checks who may
// contact whom (meet_can_contact); the tables are read-only to the browser.

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
}

export type MeetPerson = { profile_id: string; name: string; role: string; kind: "owner" | "staff" | "agent" };
export type MeetCallRow = {
  id: string; outgoing: boolean; other_id: string; other_name: string; video: boolean;
  status: "ringing" | "answered" | "missed" | "declined" | "ended"; started_at: string; duration_seconds: number | null;
};
export type MeetParticipant = { profile_id: string; name: string; is_host: boolean; in_room: boolean };
export type MeetMeetingRow = {
  id: string; title: string; host_id: string; host_name: string; is_host: boolean; starts_at: string;
  duration_minutes: number; status: "scheduled" | "live" | "ended" | "cancelled"; instant: boolean;
  participants: MeetParticipant[] | null;
};

export const meetKeys = { mine: ["meet", "mine"] as const, people: (q: string) => ["meet", "people", q] as const };

export function useMeetPeople(query: string) {
  return useQuery({
    queryKey: meetKeys.people(query),
    queryFn: () => rpc<MeetPerson[]>("meet_people", { p_query: query.trim() || null }),
    staleTime: 60_000,
  });
}

export function useMeetMine() {
  return useQuery({
    queryKey: meetKeys.mine,
    queryFn: () => rpc<{ calls: MeetCallRow[]; meetings: MeetMeetingRow[] }>("meet_list_my"),
    refetchInterval: 30_000,
  });
}

export const startCall = (callee: string, video: boolean) => rpc<string>("meet_start_call", { p_callee: callee, p_video: video });
export const answerCall = (call: string, accept: boolean) => rpc<string>("meet_answer_call", { p_call: call, p_accept: accept });
export const endCall = (call: string) => rpc<string>("meet_end_call", { p_call: call });
export const joinMeeting = (meeting: string) =>
  rpc<{ meeting_id: string; title: string; host_id: string; is_host: boolean }>("meet_join_meeting", { p_meeting: meeting });
export const leaveMeeting = (meeting: string) => rpc<null>("meet_leave_meeting", { p_meeting: meeting });
export const endMeeting = (meeting: string) => rpc<string>("meet_end_meeting", { p_meeting: meeting });

export function useCreateMeeting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (i: { title: string; startsAt: string | null; durationMinutes: number; invitees: string[]; instant: boolean }) =>
      rpc<string>("meet_create_meeting", {
        p_title: i.title, p_starts_at: i.startsAt, p_duration_minutes: i.durationMinutes, p_invitees: i.invitees,
        p_instant: i.instant,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: meetKeys.mine }),
  });
}

export function useEndMeeting() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: endMeeting, onSuccess: () => qc.invalidateQueries({ queryKey: meetKeys.mine }) });
}

// STUN always; a TURN relay too when the meet-ice-servers function has its secrets. Cached for the session.
let iceCache: Promise<RTCIceServer[]> | null = null;
export function getIceServers(): Promise<RTCIceServer[]> {
  if (!iceCache) {
    iceCache = supabase.functions
      .invoke("meet-ice-servers")
      .then(({ data, error }) => {
        const servers = (data as { iceServers?: RTCIceServer[] } | null)?.iceServers;
        return !error && Array.isArray(servers) && servers.length > 0 ? servers : DEFAULT_ICE_SERVERS;
      })
      .catch(() => DEFAULT_ICE_SERVERS);
  }
  return iceCache;
}
