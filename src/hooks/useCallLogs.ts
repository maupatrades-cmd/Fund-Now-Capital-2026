import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { invalidateActivity } from "@/hooks/useActivity";

export type CallMedium = "call" | "whatsapp" | "meeting" | "email" | "message";

export const CALL_MEDIA: { value: CallMedium; label: string }[] = [
  { value: "call", label: "Call" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "meeting", label: "Meeting" },
  { value: "email", label: "Email" },
  { value: "message", label: "Message" },
];

export type CallLog = {
  id: string;
  client_id: string;
  call_date: string;
  call_time: string | null;
  medium: CallMedium;
  duration_minutes: number | null;
  discussed_topics: string | null;
  client_promises: string | null;
  thapelo_promises: string | null;
  follow_up_needed: boolean;
  follow_up_date: string | null;
  next_action: string | null;
  created_at: string;
};

export type CallLogInput = {
  clientId: string;
  call_date: string;
  call_time: string | null;
  medium: CallMedium;
  duration_minutes: number | null;
  discussed_topics: string | null;
  client_promises: string | null;
  thapelo_promises: string | null;
  follow_up_needed: boolean;
  follow_up_date: string | null;
  next_action: string | null;
};

const CALL_LOG_COLUMNS =
  "id, client_id, call_date, call_time, medium, duration_minutes, discussed_topics, " +
  "client_promises, thapelo_promises, follow_up_needed, follow_up_date, next_action, created_at";

export function useCallLogs(clientId: string | undefined) {
  return useQuery({
    queryKey: ["call-logs", clientId],
    enabled: !!clientId,
    queryFn: async (): Promise<CallLog[]> => {
      const { data, error } = await supabase
        .from("call_logs")
        .select(CALL_LOG_COLUMNS)
        .eq("client_id", clientId!)
        .order("call_date", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as CallLog[];
    },
  });
}

export function useAddCallLog() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CallLogInput) => {
      const { clientId, ...rest } = input;
      // created_by defaults to auth.uid() server-side. RETURNING id + row-count
      // check surfaces a silent RLS failure loudly (CLAUDE.md standing rule).
      const { data, error } = await supabase
        .from("call_logs")
        .insert({ client_id: clientId, ...rest })
        .select("id");
      if (error) throw error;
      if (!data || data.length !== 1) throw new Error("Call log was not saved (no row written).");
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["call-logs", vars.clientId] });
      invalidateActivity(qc);
    },
  });
}
