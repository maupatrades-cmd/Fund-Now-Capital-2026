import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import {
  CONSENT_NOTICE_VERSION,
  type ConsentKind,
  type SigningPackage,
  userAgentHash,
} from "@/lib/agreements";

/*
 * Build 8.1 — signing state for one magic-link token.
 *
 * Flow, mirroring the live backend:
 *   1. `open_signature_request`      — records the `viewed` evidence event once
 *                                      (sent -> viewed) and refreshes last_opened_at.
 *   2. `get_agreement_signing_package` — read-only content + consent state.
 *   3. `record_agreement_consent` x4 — append-only, idempotent per kind.
 *   4. `submit_agreement_signature`  — refuses until all four are accepted.
 *
 * Step 1 is a mutation-shaped call that must happen exactly once per mount, so
 * it is fired from the query function BEFORE the read, not from an effect —
 * that keeps the "opened" evidence and the content fetch in one ordered pass and
 * avoids a double-open under React StrictMode's double-invoked effects.
 */

export function useAgreementSigning(token: string) {
  const qc = useQueryClient();
  const queryKey = ["agreement-signing", token];

  const query = useQuery({
    queryKey,
    enabled: !!token,
    // A signing surface is a compliance gate: never serve stale state. If the
    // owner withdrew the agreement while the tab sat open, a refetch must see it.
    staleTime: 0,
    retry: false,
    queryFn: async (): Promise<SigningPackage> => {
      // Best-effort: a failure here (e.g. already terminal) must not stop the
      // signer from READING why. The package read below raises the real error.
      const { error: openErr } = await supabase.rpc("open_signature_request", {
        p_token: token,
      });
      if (openErr && import.meta.env.DEV) {
        console.warn("open_signature_request failed", openErr.message);
      }

      const { data, error } = await supabase.rpc(
        "get_agreement_signing_package",
        { p_token: token },
      );
      if (error) throw error;
      if (!data) throw new Error("Signing package not found for this link.");
      return data as SigningPackage;
    },
  });

  const recordConsent = useMutation({
    mutationFn: async (input: { kind: ConsentKind; accepted: boolean }) => {
      const uaHash = await userAgentHash();
      const { data, error } = await supabase.rpc("record_agreement_consent", {
        p_token: token,
        p_consent_kind: input.kind,
        p_notice_version: CONSENT_NOTICE_VERSION,
        p_accepted: input.accepted,
        // p_ip_hash intentionally omitted — see lib/agreements.ts.
        p_user_agent_hash: uaHash,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey });
    },
  });

  const sign = useMutation({
    mutationFn: async (input: { adoptedText: string }) => {
      const uaHash = await userAgentHash();
      const { data, error } = await supabase.rpc("submit_agreement_signature", {
        p_token: token,
        // Build 8.1 is typed-adoption only. `drawn` / `uploaded` need a
        // signer-scoped policy on the (currently owner-only)
        // legal-signature-artifacts bucket — that is Build 8.2, not a silent
        // fallback here.
        p_method: "typed",
        p_adopted_text: input.adoptedText,
        p_user_agent_hash: uaHash,
      });
      if (error) throw error;
      return data as { state?: string } | null;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey });
    },
  });

  const decline = useMutation({
    mutationFn: async (input: { reason: string }) => {
      const { data, error } = await supabase.rpc("decline_signature_request", {
        p_token: token,
        p_reason: input.reason,
      });
      if (error) throw error;
      return data as { state?: string } | null;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey });
    },
  });

  return {
    pkg: query.data ?? null,
    isLoading: query.isPending,
    error: query.error as Error | null,
    refetch: query.refetch,
    recordConsent,
    sign,
    decline,
  };
}
