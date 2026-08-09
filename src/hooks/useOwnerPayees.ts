import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

// Build 3.3 — owner-side payee verification data layer. Reads/writes go through
// the Build 3.1 owner RPCs (owner-gated in-body). The detail RPC is the ONLY
// path that decrypts the banking/tax numbers, and only for the owner during
// verification; the list RPC stays masked.

export type PayeeVerificationStatus =
  | "incomplete"
  | "pending_verification"
  | "verified"
  | "rejected";

export type OwnerPayeeSummary = {
  id: string;
  subject_kind: "partner" | "contractor";
  subject_name: string | null;
  verification_status: PayeeVerificationStatus;
  bank_name: string | null;
  account_last_four: string | null;
  submitted_at: string | null;
  verified_at: string | null;
  updated_at: string;
};

export type OwnerPayeeDetail = {
  id: string;
  subject_kind: "partner" | "contractor";
  subject_name: string | null;
  verification_status: PayeeVerificationStatus;
  account_holder_name: string | null;
  bank_name: string | null;
  branch_code: string | null;
  account_type: string | null;
  account_number: string | null;
  account_last_four: string | null;
  tax_number: string | null;
  vat_status: string | null;
  vat_number: string | null;
  banking_proof_storage_path: string | null;
  rejection_reason: string | null;
  submitted_at: string | null;
  verified_at: string | null;
  verified_by: string | null;
  updated_at: string;
};

const PROOF_BUCKET = "payee-proofs";

// Masked summary list, pending-first (ordering is server-side).
export function useOwnerPayees() {
  return useQuery({
    queryKey: ["owner-payees"],
    queryFn: async (): Promise<OwnerPayeeSummary[]> => {
      const { data, error } = await supabase.rpc("list_payee_payment_profiles_owner");
      if (error) throw error;
      return (data ?? []) as OwnerPayeeSummary[];
    },
  });
}

// Decrypted detail for one profile (owner-only, verification screen).
// gcTime/staleTime: 0 so the decrypted banking/tax numbers are dropped from the
// React Query cache the moment the modal closes (no observers) — they never
// linger in memory past the review.
export function useOwnerPayeeDetail(profileId: string | null) {
  return useQuery({
    queryKey: ["owner-payee-detail", profileId],
    enabled: !!profileId,
    gcTime: 0,
    staleTime: 0,
    queryFn: async (): Promise<OwnerPayeeDetail | null> => {
      const { data, error } = await supabase.rpc("get_payee_payment_profile_owner", {
        p_profile_id: profileId,
      });
      if (error) throw error;
      const rows = (data ?? []) as OwnerPayeeDetail[];
      return rows[0] ?? null;
    },
  });
}

export function useSetPayeeVerification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      profileId: string;
      approve: boolean;
      reason?: string | null;
    }): Promise<string> => {
      const { data, error } = await supabase.rpc("set_payee_payment_verification", {
        p_profile_id: input.profileId,
        p_approve: input.approve,
        p_reason: input.reason ?? null,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: ["owner-payees"] });
      void qc.invalidateQueries({ queryKey: ["owner-payee-detail", variables.profileId] });
    },
  });
}

export async function getOwnerBankingProofUrl(path: string, expiresIn = 3600): Promise<string> {
  const { data, error } = await supabase.storage.from(PROOF_BUCKET).createSignedUrl(path, expiresIn);
  if (error) throw error;
  return data.signedUrl;
}
