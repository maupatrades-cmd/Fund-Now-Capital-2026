import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/useSession";
import { invalidateActivity } from "@/hooks/useActivity";
import { useProfileRole } from "@/hooks/useProfileRole";
import { collectCommissionRows, commissionAmount, UnconfirmedCommissionChange } from "@/lib/ownerCommission";

export type ManualPaymentEvidence = {
  entry_id: string; amount: string | number; currency: string; payment_reference: string;
  proof_path: string; recorded_at: string;
};
const bucket = "commission-payment-proofs";

export function useManualPaymentEvidence() {
  const uid = useSession()?.user.id;
  const role = useProfileRole();
  return useQuery({
    queryKey: ["owner-manual-payment-evidence", uid], gcTime: 0,
    enabled: !!uid && role.data === "owner",
    queryFn: async () => {
      const check = async () => {
        const { data, error } = await supabase.auth.getUser();
        if (error || data.user?.id !== uid) throw new Error("Your session changed. Reopen Payouts.");
      };
      await check();
      const evidence = await collectCommissionRows<ManualPaymentEvidence>((start, end) => supabase.from("owner_commission_payments")
        .select("entry_id,amount,currency,payment_reference,proof_path,recorded_at").order("entry_id").range(start, end));
      await check();
      return evidence;
    },
  });
}

export function useRecordManualPayment(openedUid: string | undefined) {
  const uid = useSession()?.user.id;
  const cache = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: async (input: { entryId: string; amount: string; currency: string; reference: string; file: File }) => {
      const { data, error } = await supabase.auth.getUser();
      if (!uid || uid !== openedUid || error || data.user?.id !== uid) throw new Error("Your session changed. Reopen Payouts.");
      const amount = commissionAmount(input.amount);
      if (amount === "0.00") throw new Error("A payment amount must be greater than zero.");
      if (input.reference.trim().length < 3 || input.reference.trim().length > 200) throw new Error("Enter a payment reference of 3 to 200 characters.");
      const extension = ({ "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg" } as Record<string, string>)[input.file.type];
      if (!extension || input.file.size < 1 || input.file.size > 10485760) throw new Error("Upload a PDF, PNG or JPEG proof of up to 10 MB.");
      const path = `${uid}/${input.entryId}/${crypto.randomUUID()}.${extension}`;
      const upload = await supabase.storage.from(bucket).upload(path, input.file, { upsert: false, contentType: input.file.type });
      if (upload.error) throw new Error(`Proof upload could not be confirmed. Check the payment history before trying again. ${upload.error.message}`);
      const identity = await supabase.auth.getUser();
      if (identity.error || identity.data.user?.id !== uid) throw new Error("Your session changed after upload. No payment was requested.");
      const response = await supabase.rpc("owner_record_commission_payment", {
        p_entry_id: input.entryId, p_expected_amount: amount, p_currency: input.currency,
        p_payment_reference: input.reference.trim(), p_proof_path: path,
      });
      if (response.error) throw response.error.code ? response.error : new UnconfirmedCommissionChange();
      if (!response.data) throw new UnconfirmedCommissionChange();
      return response.data;
    },
    onSettled: async () => {
      await Promise.all([
        cache.invalidateQueries({ queryKey: ["owner-manual-payment-evidence", uid] }),
        cache.invalidateQueries({ queryKey: ["owner-manual-payouts", uid] }),
        cache.invalidateQueries({ queryKey: ["owner-manual-commission", uid] }),
      ]);
      invalidateActivity(cache);
    },
  });
}

export async function downloadManualPaymentProof(evidence: ManualPaymentEvidence) {
  const result = await supabase.storage.from(bucket).download(evidence.proof_path);
  if (result.error) throw result.error;
  const url = URL.createObjectURL(result.data);
  const link = document.createElement("a");
  link.href = url;
  link.download = `payment-proof-${evidence.entry_id}.${evidence.proof_path.split(".").pop()}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
