import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import {
  CONSENT_NOTICE_VERSION,
  extensionForMime,
  sha256HexOfBytes,
  SIGNATURE_ACCEPTED_TYPES,
  SIGNATURE_BUCKET,
  SIGNATURE_MAX_BYTES,
  signatureObjectPath,
  type ConsentKind,
  type SignatureMethod,
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

  /*
   * Signing, for all three methods.
   *
   * For `drawn` / `uploaded` the image is uploaded FIRST and only then attached:
   * if the upload fails we stop with nothing recorded, which is recoverable.
   * The reverse order could consume the single-use signing token while leaving
   * the artifact missing — an executed signature pointing at nothing.
   *
   * The hash is computed over the exact bytes uploaded, client-side, so
   * `signature_artifacts.artifact_sha256` fingerprints what actually landed in
   * the bucket rather than what we intended to send.
   */
  const sign = useMutation({
    mutationFn: async (input: {
      method: SignatureMethod;
      adoptedText: string;
      agreementId: string;
      /** Required for `drawn` / `uploaded`; ignored for `typed`. */
      image?: Blob | null;
    }) => {
      const uaHash = await userAgentHash();
      let storagePath: string | null = null;
      let artifactSha: string | null = null;

      if (input.method !== "typed") {
        if (!input.image) throw new Error("Draw or upload a signature first.");
        if (input.image.size > SIGNATURE_MAX_BYTES) {
          throw new Error("That signature image is too large (2MB maximum).");
        }

        const { data: userData } = await supabase.auth.getUser();
        const uid = userData?.user?.id;
        if (!uid) throw new Error("You must be signed in to sign.");

        /*
         * Never RELABEL an unexpected type as PNG. The `accept` attribute on a
         * file input is a hint, not a gate — a signer can pick a PDF or an SVG.
         * Coercing its content-type to image/png would walk it straight past the
         * bucket's allowed_mime_types guard (which checks the DECLARED type) and
         * store non-image bytes as signature evidence.
         *
         * A drawn signature is exempt from the check because we produce it
         * ourselves from the canvas — it is always a real PNG.
         */
        let mime: string;
        if (input.method === "drawn") {
          mime = "image/png";
        } else {
          if (!SIGNATURE_ACCEPTED_TYPES.includes(input.image.type)) {
            throw new Error("Your signature image must be a PNG or JPEG file.");
          }
          mime = input.image.type;
        }

        const bytes = await input.image.arrayBuffer();
        artifactSha = await sha256HexOfBytes(bytes);
        // The fingerprint is the whole point of storing an artifact — it proves
        // which bytes were signed. Recording a signature without one silently
        // degrades the evidence, so fail loudly instead.
        if (!artifactSha) {
          throw new Error(
            "Could not fingerprint the signature image on this device. Try again, or use the Type option.",
          );
        }
        storagePath = signatureObjectPath(uid, input.agreementId, extensionForMime(mime));

        const { error: uploadErr } = await supabase.storage
          .from(SIGNATURE_BUCKET)
          .upload(storagePath, input.image, { contentType: mime, upsert: false });
        if (uploadErr) throw uploadErr;
      }

      const { data, error } = await supabase.rpc("submit_agreement_signature", {
        p_token: token,
        p_method: input.method,
        p_artifact_sha256: artifactSha,
        p_storage_path: storagePath,
        // The adopted name is recorded for EVERY method, not just typed: it is
        // how the signer spelled their own name at signing time, and a drawn
        // squiggle alone is poor evidence of who drew it.
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
