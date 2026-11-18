import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

// Owner daily log (20261118140000). Owner-only private journal: every read and write goes through SECURITY DEFINER
// RPCs that refuse anyone who is not the Director. Dates are SAST calendar days as 'YYYY-MM-DD' strings.

export type DailyLogEntry = {
  log_date: string;
  what_happened: string | null;
  what_i_did: string | null;
  notes_for_tomorrow: string | null;
  saved_at: string | null;
};

export type DailyLogActivity = {
  occurred_at: string;
  event_type: string;
  entity_type: string;
  description: string | null;
};

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
}

// Today in South Africa, as 'YYYY-MM-DD'.
export function sastToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });
}

// Calendar arithmetic on 'YYYY-MM-DD' strings in UTC, so no time zone can shift the day.
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function formatLongDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-ZA", {
    weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  });
}

export function formatSastTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Johannesburg" });
}

export const dailyLogKeys = {
  day: (day: string) => ["daily-log", "day", day] as const,
  list: (from: string, to: string) => ["daily-log", "list", from, to] as const,
  activity: (day: string) => ["daily-log", "activity", day] as const,
};

export async function fetchDailyLog(day: string): Promise<DailyLogEntry> {
  const rows = await rpc<DailyLogEntry[]>("owner_daily_log_get", { p_date: day });
  return rows[0] ?? { log_date: day, what_happened: null, what_i_did: null, notes_for_tomorrow: null, saved_at: null };
}

export async function fetchDailyLogActivity(day: string): Promise<DailyLogActivity[]> {
  return (await rpc<DailyLogActivity[] | null>("owner_daily_log_activity", { p_date: day })) ?? [];
}

export function useDailyLog(day: string) {
  return useQuery({ queryKey: dailyLogKeys.day(day), queryFn: () => fetchDailyLog(day) });
}

export function useDailyLogActivity(day: string) {
  return useQuery({ queryKey: dailyLogKeys.activity(day), queryFn: () => fetchDailyLogActivity(day) });
}

export function useDailyLogList(from: string, to: string) {
  return useQuery({
    queryKey: dailyLogKeys.list(from, to),
    queryFn: async () => (await rpc<DailyLogEntry[] | null>("owner_daily_log_list", { p_from: from, p_to: to })) ?? [],
  });
}

export type DailyLogDraft = { whatHappened: string; whatIDid: string; notes: string };

export function useSaveDailyLog() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ day, draft }: { day: string; draft: DailyLogDraft }) => {
      const savedAt = await rpc<string | null>("owner_daily_log_save", {
        p_date: day, p_what_happened: draft.whatHappened, p_what_i_did: draft.whatIDid, p_notes: draft.notes,
      });
      // The RPC returns the saved row's timestamp; nothing back means nothing was written.
      if (!savedAt) throw new Error("The daily log was not saved. Try again.");
      return { day, savedAt };
    },
    onSuccess: ({ day }) => {
      qc.invalidateQueries({ queryKey: ["daily-log", "list"] });
      qc.invalidateQueries({ queryKey: dailyLogKeys.day(day) });
    },
  });
}
