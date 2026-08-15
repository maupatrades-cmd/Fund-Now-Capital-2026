import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/useSession";
import type {
  AgreementDetail,
  AgreementListRow,
  AgreementPartyInput,
  SendResult,
  SignableProfile,
} from "@/lib/agreements";

/*
 * Build 8.2 — owner-side agreement dispatch data layer.
 *
 * Reads the e-sign tables directly (owner RLS narrows every SELECT) and mutates
 * ONLY through the SECURITY DEFINER RPCs — table DML is revoked from every API
 * role, so there is no raw-write path to accidentally take.
 */

const AGREEMENTS_KEY = ["agreements"] as const;

export function useAgreements() {
  const uid = useSession()?.user?.id ?? null;
  const query = useQuery({
    queryKey: [...AGREEMENTS_KEY, "list", uid],
    enabled: uid !== null,
    queryFn: async (): Promise<AgreementListRow[]> => {
      const { data, error } = await supabase
        .from("agreement_instances")
        .select(
          "id, reference, document_type, title_snapshot, state, sent_at, executed_at, expires_at, created_at",
        )
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as AgreementListRow[];
    },
  });
  return { ...query, isLoading: query.isLoading || uid === null };
}

export function useAgreement(agreementId: string | undefined) {
  const uid = useSession()?.user?.id ?? null;
  const query = useQuery({
    queryKey: [...AGREEMENTS_KEY, "detail", agreementId, uid],
    enabled: uid !== null && !!agreementId,
    queryFn: async (): Promise<AgreementDetail> => {
      const [instanceRes, partiesRes, eventsRes, consentsRes, requestsRes] =
        await Promise.all([
          supabase
            .from("agreement_instances")
            .select("*")
            .eq("id", agreementId!)
            .maybeSingle(),
          supabase
            .from("agreement_party_snapshots")
            .select("*")
            .eq("agreement_id", agreementId!)
            .order("party_order", { ascending: true }),
          supabase
            .from("signature_events")
            .select("*")
            .eq("agreement_id", agreementId!)
            .order("occurred_at", { ascending: false }),
          supabase
            .from("consent_records")
            .select("*")
            .eq("agreement_id", agreementId!),
          // Delivery/expiry state per signer. Deliberately never selects
          // token_hash — the UI has no use for it and it should not sit in a
          // client cache.
          supabase
            .from("signature_requests")
            .select(
              "id, party_snapshot_id, issued_at, expires_at, revoked_at, last_opened_at, consumed_at, delivery_status",
            )
            .eq("agreement_id", agreementId!),
        ]);

      if (instanceRes.error) throw instanceRes.error;
      if (!instanceRes.data) throw new Error("Agreement not found.");
      if (partiesRes.error) throw partiesRes.error;
      if (eventsRes.error) throw eventsRes.error;
      if (consentsRes.error) throw consentsRes.error;
      if (requestsRes.error) throw requestsRes.error;

      return {
        instance: instanceRes.data,
        parties: partiesRes.data ?? [],
        events: eventsRes.data ?? [],
        consents: consentsRes.data ?? [],
        requests: requestsRes.data ?? [],
      } as AgreementDetail;
    },
  });
  return { ...query, isLoading: query.isLoading || uid === null };
}

/** Active platform users who can be named as a role signer. */
export function useSignableProfiles() {
  const uid = useSession()?.user?.id ?? null;
  const query = useQuery({
    queryKey: [...AGREEMENTS_KEY, "signable-profiles", uid],
    enabled: uid !== null,
    queryFn: async (): Promise<SignableProfile[]> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email, role")
        .in("role", ["partner", "contractor", "lead_referrer"])
        .eq("is_active", true)
        .order("full_name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as SignableProfile[];
    },
  });
  return { ...query, isLoading: query.isLoading || uid === null };
}

export type CreateAndSendInput = {
  templateVersionId: string;
  subjectProfileId: string | null;
  parties: AgreementPartyInput[];
  variables: Record<string, string>;
  expiryDays: number;
  /*
   * Content-derived key. `create_agreement_instance` is idempotent on it, so a
   * retry of the SAME form resumes the same draft instead of stranding an orphan
   * on every attempt — while an EDITED form yields a different key and starts a
   * fresh draft, so a corrected name can never be skipped as "already added".
   */
  idempotencyKey: string;
};

/*
 * Dispatch is four ordered RPC calls, not one. There is no server-side
 * "create and send" wrapper, and adding one would duplicate the state machine
 * that already lives in the individual RPCs — so the orchestration lives here,
 * where a partial failure leaves a resumable DRAFT (visible in the list) rather
 * than a half-sent agreement. Sending is the only irreversible step, and it is
 * last.
 */
export function useCreateAndSendAgreement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateAndSendInput): Promise<SendResult> => {
      const { data: instance, error: createErr } = await supabase.rpc(
        "create_agreement_instance",
        {
          p_template_version_id: input.templateVersionId,
          p_subject_profile_id: input.subjectProfileId,
          p_idempotency_key: input.idempotencyKey,
        },
      );
      if (createErr) throw createErr;
      const agreementId = (instance as { id?: string } | null)?.id;
      if (!agreementId) throw new Error("The agreement was not created.");

      /*
       * `party_order` is UNIQUE per agreement, so re-adding a party that a
       * previous attempt already inserted would raise a unique violation and
       * strand the draft forever — the resumability this orchestration promises
       * only works if we skip what is already there.
       *
       * Safe to key on order alone because the caller's idempotency key is
       * derived from the form's contents (see NewAgreementPage): an EDITED form
       * produces a different key and therefore a different draft, so a resumed
       * draft always describes the same parties we are about to add. Without
       * that, skipping here would silently bind someone under a stale name.
       */
      const { data: existingParties, error: existingErr } = await supabase
        .from("agreement_party_snapshots")
        .select("party_order")
        .eq("agreement_id", agreementId);
      if (existingErr) throw existingErr;
      const alreadyAdded = new Set(
        (existingParties ?? []).map((r) => r.party_order as number),
      );

      for (let i = 0; i < input.parties.length; i += 1) {
        if (alreadyAdded.has(i + 1)) continue; // inserted by a prior attempt
        const p = input.parties[i];
        const { error: partyErr } = await supabase.rpc("add_agreement_party", {
          p_agreement_id: agreementId,
          p_party_role: p.party_role,
          p_legal_name: p.legal_name,
          p_party_order: i + 1,
          p_represented_party: p.represented_party || null,
          p_capacity: p.capacity || null,
          p_email: p.email || null,
          p_profile_id: p.profile_id || null,
          p_is_fnc: p.is_fnc,
        });
        if (partyErr) throw partyErr;
      }

      if (Object.keys(input.variables).length > 0) {
        const { error: varErr } = await supabase.rpc("set_agreement_variables", {
          p_agreement_id: agreementId,
          p_variables: input.variables,
        });
        if (varErr) throw varErr;
      }

      const { data: sent, error: sendErr } = await supabase.rpc("send_agreement", {
        p_agreement_id: agreementId,
        p_expiry_days: input.expiryDays,
      });
      if (sendErr) throw sendErr;

      return { agreementId, ...(sent as object) } as SendResult;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: AGREEMENTS_KEY });
    },
  });
}

export function useWithdrawAgreement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { agreementId: string; reason: string }) => {
      const { data, error } = await supabase.rpc("withdraw_agreement", {
        p_agreement_id: input.agreementId,
        p_reason: input.reason,
      });
      if (error) throw error;
      return data as { state?: string } | null;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: AGREEMENTS_KEY });
    },
  });
}
