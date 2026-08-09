import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/useSession";
import type { PortalKind } from "@/components/portal/PortalShell";

// Build 3.2 — data layer for the partner/contractor payment-details surface.
// Every read/write goes through the Build 3.1 SECURITY DEFINER RPCs (the table
// has no direct grant). Sensitive numbers are NEVER fetched here: get_my_* masks
// to last-4 + has_* booleans, matching the "masked + re-enter to change" policy.

const PROOF_BUCKET = "payee-proofs";
export const PAYEE_MAX_PROOF_BYTES = 10 * 1024 * 1024; // 10MB

export type PayeeVerificationStatus =
  | "incomplete"
  | "pending_verification"
  | "verified"
  | "rejected";
export type PayeeAccountType = "cheque" | "savings" | "transmission" | "business" | "other";
export type PayeeVatStatus = "not_registered" | "registered" | "pending";

// Shape returned by get_my_payee_payment_profile (masked — no plaintext secrets).
export type PayeeProfile = {
  id: string;
  verification_status: PayeeVerificationStatus;
  account_holder_name: string | null;
  bank_name: string | null;
  branch_code: string | null;
  account_type: PayeeAccountType | null;
  account_last_four: string | null;
  has_account_number: boolean;
  has_tax_number: boolean;
  vat_status: PayeeVatStatus;
  has_vat_number: boolean;
  has_banking_proof: boolean;
  banking_proof_storage_path: string | null;
  rejection_reason: string | null;
  submitted_at: string | null;
  verified_at: string | null;
  profile_version: number;
  updated_at: string;
};

// The caller's own payment profile (or null if not started). Cache keyed by user
// id so a same-tab re-login as a different user never reuses cached rows; RLS +
// the DEFINER RPC are the authoritative scope regardless.
export function usePayeeProfile(portal: PortalKind) {
  const uid = useSession()?.user?.id ?? null;
  const query = useQuery({
    queryKey: ["payee-profile", portal, uid],
    enabled: uid !== null,
    queryFn: async (): Promise<PayeeProfile | null> => {
      const { data, error } = await supabase.rpc("get_my_payee_payment_profile");
      if (error) throw error;
      const rows = (data ?? []) as PayeeProfile[];
      return rows[0] ?? null;
    },
  });
  return { ...query, isLoading: query.isLoading || uid === null };
}

function safeName(name: string): string {
  return name.replace(/[^\w.-]+/g, "_");
}

// Upload a banking-proof file into the caller's OWN folder in the private
// payee-proofs bucket. The path shape `payee/{uid}/{uuid}/{name}` matches both
// the storage RLS (segment 2 = uploader) and the save RPC's path check.
export async function uploadBankingProof(uid: string, file: File): Promise<string> {
  const path = `payee/${uid}/${crypto.randomUUID()}/${safeName(file.name)}`;
  const { error } = await supabase.storage
    .from(PROOF_BUCKET)
    .upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (error) throw error;
  return path;
}

// Short-lived signed URL so the subject can view the proof they uploaded (their
// own folder only — RLS enforces it).
export async function getBankingProofUrl(path: string, expiresIn = 3600): Promise<string> {
  const { data, error } = await supabase.storage.from(PROOF_BUCKET).createSignedUrl(path, expiresIn);
  if (error) throw error;
  return data.signedUrl;
}

export type SavePayeeInput = {
  account_holder_name: string | null;
  bank_name: string | null;
  branch_code: string | null;
  account_type: PayeeAccountType | null;
  // Secrets are sent ONLY when the subject is changing them; null = keep stored.
  account_number: string | null;
  tax_number: string | null;
  vat_status: PayeeVatStatus | null;
  vat_number: string | null;
  banking_proof_storage_path: string | null;
};

export function useSavePayeeProfile(portal: PortalKind) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SavePayeeInput): Promise<string> => {
      const { data, error } = await supabase.rpc("save_payee_payment_profile", {
        p_account_holder_name: input.account_holder_name,
        p_bank_name: input.bank_name,
        p_branch_code: input.branch_code,
        p_account_type: input.account_type,
        p_account_number: input.account_number,
        p_tax_number: input.tax_number,
        p_vat_status: input.vat_status,
        p_vat_number: input.vat_number,
        p_banking_proof_storage_path: input.banking_proof_storage_path,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["payee-profile", portal] });
    },
  });
}

export function useSubmitPayeeProfile(portal: PortalKind) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<string> => {
      const { data, error } = await supabase.rpc("submit_payee_payment_profile");
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["payee-profile", portal] });
    },
  });
}
