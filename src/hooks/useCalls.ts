import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

// Calls inside the CRM (owner, 23 Nov 2026). The browser never holds a full phone number: prepare_call resolves it
// server-side and returns a call-target id plus a masked number; the Twilio TwiML function dials it.

export type CallTargetKind = "profile" | "client" | "lead";
export type CallTarget = { kind: CallTargetKind; id: string; name: string };

export type PreparedCall = { call_target_id: string; display_name: string; masked_number: string };

export type CrmCall = {
  id: string; target_kind: CallTargetKind; target_id: string; target_name: string; to_masked: string; status: string;
  started_at: string; answered_at: string | null; ended_at: string | null; duration_seconds: number | null;
  note: string | null;
};

export async function prepareCall(target: CallTarget): Promise<PreparedCall> {
  const args = {
    p_profile_id: target.kind === "profile" ? target.id : null,
    p_client_id: target.kind === "client" ? target.id : null,
    p_lead_id: target.kind === "lead" ? target.id : null,
  };
  const { data, error } = await supabase.rpc("prepare_call", args);
  if (error) throw new Error(error.message);
  return data as PreparedCall;
}

// The token function answers 503 until every Twilio secret is set; surface that as a plain message.
export async function fetchVoiceToken(): Promise<string> {
  const { data, error } = await supabase.functions.invoke("twilio-voice-token", { body: {} });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    let message = "Could not start the call. Try again.";
    if (ctx && typeof ctx.json === "function") {
      try {
        const body = (await ctx.json()) as { error?: string; code?: string };
        if (body?.code === "not_configured") message = "Calling is not set up yet. Ask IT to finish the Twilio setup.";
        else if (body?.error) message = body.error;
      } catch { /* keep the generic message */ }
    }
    throw new Error(message);
  }
  const token = (data as { token?: string } | null)?.token;
  if (!token) throw new Error("Could not start the call. Try again.");
  return token;
}

export function useCallHistory(kind: CallTargetKind, id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ["crm-calls", kind, id],
    enabled: enabled && Boolean(id),
    queryFn: async (): Promise<CrmCall[]> => {
      const { data, error } = await supabase.rpc("list_calls", { p_target_kind: kind, p_target_id: id, p_limit: 20 });
      if (error) throw error;
      return (data ?? []) as CrmCall[];
    },
  });
}

export function useSetCallNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ callTargetId, note }: { callTargetId: string; note: string }) => {
      const { data, error } = await supabase.rpc("set_call_note", { p_call_target_id: callTargetId, p_note: note });
      if (error) throw error;
      if (!data) throw new Error("The note was not saved.");
      return data as string;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["crm-calls"] }),
  });
}

export function formatCallDuration(seconds: number | null | undefined): string {
  const s = Math.max(0, seconds ?? 0);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m} min ${s % 60} s` : `${s} s`;
}
