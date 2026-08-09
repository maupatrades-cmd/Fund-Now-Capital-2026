import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Clock3, ShieldAlert, FileText, Paperclip } from "lucide-react";
import { useSession } from "@/lib/useSession";
import { formatFileSize } from "@/lib/documents";
import type { PortalKind } from "@/components/portal/PortalShell";
import {
  usePayeeProfile,
  useSavePayeeProfile,
  useSubmitPayeeProfile,
  uploadBankingProof,
  getBankingProofUrl,
  PAYEE_MAX_PROOF_BYTES,
  type PayeeAccountType,
  type PayeeVatStatus,
  type PayeeVerificationStatus,
} from "@/hooks/usePayeeProfile";

const inputCls =
  "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-brand-navy outline-none focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/20";
const labelCls = "mb-1 block text-xs font-medium text-brand-navy";

const ACCOUNT_TYPES: { value: PayeeAccountType; label: string }[] = [
  { value: "cheque", label: "Cheque" },
  { value: "savings", label: "Savings" },
  { value: "transmission", label: "Transmission" },
  { value: "business", label: "Business" },
  { value: "other", label: "Other" },
];

const VAT_STATUSES: { value: PayeeVatStatus; label: string }[] = [
  { value: "not_registered", label: "Not registered" },
  { value: "registered", label: "Registered" },
  { value: "pending", label: "Pending" },
];

const STATUS_META: Record<
  PayeeVerificationStatus,
  { label: string; cls: string; icon: typeof CheckCircle2 }
> = {
  incomplete: {
    label: "Not submitted",
    cls: "border-slate-200 bg-slate-50 text-slate-700",
    icon: FileText,
  },
  pending_verification: {
    label: "Pending verification",
    cls: "border-amber-200 bg-amber-50 text-amber-800",
    icon: Clock3,
  },
  verified: {
    label: "Verified",
    cls: "border-emerald-200 bg-emerald-50 text-emerald-800",
    icon: CheckCircle2,
  },
  rejected: {
    label: "Rejected",
    cls: "border-red-200 bg-red-50 text-red-700",
    icon: ShieldAlert,
  },
};

/*
 * Partner/contractor self-service payment details (Build 3.2). Reads the masked
 * profile (last-4 + has_* only) and writes through the Build 3.1 RPCs, which
 * encrypt the numbers server-side. Secret fields are never pre-filled: an
 * on-file value is shown as "•••• 1234 on file" and a blank field keeps it —
 * the "masked + re-enter to change" policy. No commission or funder data lives
 * on this screen (POPIA / S7C).
 */
export default function PaymentSettingsView({ portal }: { portal: PortalKind }) {
  const uid = useSession()?.user?.id ?? null;
  const { data: profile, isLoading, isError, error, refetch } = usePayeeProfile(portal);
  const save = useSavePayeeProfile(portal);
  const submit = useSubmitPayeeProfile(portal);

  // Non-secret fields are controlled + pre-filled from the profile.
  const [holderName, setHolderName] = useState("");
  const [bankName, setBankName] = useState("");
  const [branchCode, setBranchCode] = useState("");
  const [accountType, setAccountType] = useState<PayeeAccountType | "">("");
  const [vatStatus, setVatStatus] = useState<PayeeVatStatus>("not_registered");
  // Secret fields start blank; a blank field keeps the stored ciphertext.
  const [accountNumber, setAccountNumber] = useState("");
  const [taxNumber, setTaxNumber] = useState("");
  const [vatNumber, setVatNumber] = useState("");
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofError, setProofError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync the form to the loaded/refreshed profile (keyed on the row version so a
  // save/verify refetch re-seeds the non-secret fields; secrets stay blank).
  const syncKey = profile ? `${profile.id}:${profile.profile_version}` : "none";
  useEffect(() => {
    setHolderName(profile?.account_holder_name ?? "");
    setBankName(profile?.bank_name ?? "");
    setBranchCode(profile?.branch_code ?? "");
    setAccountType(profile?.account_type ?? "");
    setVatStatus(profile?.vat_status ?? "not_registered");
    setAccountNumber("");
    setTaxNumber("");
    setVatNumber("");
    setProofFile(null);
    setProofError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncKey]);

  const busy = save.isPending || submit.isPending;

  const chooseProof = (list: FileList | null) => {
    const file = list?.[0];
    if (!file) return;
    if (file.size > PAYEE_MAX_PROOF_BYTES) {
      setProofError(`"${file.name}" is larger than 10MB.`);
      return;
    }
    setProofError(null);
    setProofFile(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const viewProof = async () => {
    if (!profile?.banking_proof_storage_path) return;
    try {
      const url = await getBankingProofUrl(profile.banking_proof_storage_path);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast.error((e as Error).message || "Could not open the proof file");
    }
  };

  // Persist the form. Uploads a new proof first (if chosen), then sends the
  // non-secret fields plus only the secrets the subject actually re-entered.
  const doSave = async (): Promise<boolean> => {
    if (branchCode.trim() !== "" && !/^[0-9]{6}$/.test(branchCode.trim())) {
      toast.error("Branch code must be exactly 6 digits.");
      return false;
    }
    if (vatStatus === "registered" && !profile?.has_vat_number && vatNumber.trim() === "") {
      toast.error("A VAT number is required when VAT status is Registered.");
      return false;
    }
    try {
      let proofPath: string | null = null;
      if (proofFile) {
        if (!uid) {
          toast.error("Your session is still loading — try again in a moment.");
          return false;
        }
        proofPath = await uploadBankingProof(uid, proofFile);
      }
      await save.mutateAsync({
        account_holder_name: holderName.trim() || null,
        bank_name: bankName.trim() || null,
        branch_code: branchCode.trim() || null,
        account_type: accountType || null,
        account_number: accountNumber.trim() || null,
        tax_number: taxNumber.trim() || null,
        vat_status: vatStatus,
        vat_number: vatStatus === "registered" ? vatNumber.trim() || null : null,
        banking_proof_storage_path: proofPath,
      });
      return true;
    } catch (e) {
      toast.error((e as Error).message || "Could not save your payment details");
      return false;
    }
  };

  const onSaveDraft = async () => {
    if (await doSave()) toast.success("Payment details saved");
  };

  const onSubmit = async () => {
    if (!(await doSave())) return;
    try {
      await submit.mutateAsync();
      toast.success("Submitted for verification");
    } catch (e) {
      toast.error((e as Error).message || "Could not submit for verification");
    }
  };

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">Loading…</div>;
  }
  if (isError) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Couldn't load your payment details: {(error as Error)?.message ?? "unknown error"}.{" "}
        <button type="button" onClick={() => void refetch()} className="font-medium underline">
          Retry
        </button>
      </div>
    );
  }

  const status = profile?.verification_status ?? "incomplete";
  const meta = STATUS_META[status];
  const StatusIcon = meta.icon;
  const pending = status === "pending_verification";

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold text-brand-navy">Payment details</h1>
        <p className="text-sm text-muted-foreground">
          Your banking details for {portal === "partner" ? "commission" : "commission and reimbursement"}{" "}
          payouts. These are encrypted and reviewed by Fund Now Capital before your first payment.
        </p>
      </div>

      {/* Status banner */}
      <div className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${meta.cls}`}>
        <StatusIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <div>
          <div className="font-semibold">{meta.label}</div>
          {status === "rejected" && profile?.rejection_reason && (
            <div className="mt-0.5">Reason: {profile.rejection_reason}. Please update and resubmit.</div>
          )}
          {pending && <div className="mt-0.5">We'll let you know once it's reviewed.</div>}
          {status === "verified" && (
            <div className="mt-0.5">You're set up to be paid. Editing will require re-verification.</div>
          )}
        </div>
      </div>

      <div className="grid gap-4 rounded-xl border border-border bg-white p-4 shadow-sm sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={labelCls}>Account holder name</label>
          <input
            className={inputCls}
            value={holderName}
            onChange={(e) => setHolderName(e.target.value)}
            disabled={busy}
            placeholder="As it appears on the bank account"
          />
        </div>

        <div>
          <label className={labelCls}>Bank</label>
          <input
            className={inputCls}
            value={bankName}
            onChange={(e) => setBankName(e.target.value)}
            disabled={busy}
            placeholder="e.g. First National Bank"
          />
        </div>
        <div>
          <label className={labelCls}>Branch code</label>
          <input
            className={inputCls}
            value={branchCode}
            onChange={(e) => setBranchCode(e.target.value)}
            disabled={busy}
            inputMode="numeric"
            placeholder="6 digits"
          />
        </div>

        <div>
          <label className={labelCls}>Account type</label>
          <select
            className={inputCls}
            value={accountType}
            onChange={(e) => setAccountType(e.target.value as PayeeAccountType | "")}
            disabled={busy}
          >
            <option value="">Select…</option>
            {ACCOUNT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>Account number</label>
          <input
            className={inputCls}
            value={accountNumber}
            onChange={(e) => setAccountNumber(e.target.value)}
            disabled={busy}
            autoComplete="off"
            inputMode="numeric"
            placeholder={
              profile?.has_account_number
                ? `•••• ${profile.account_last_four ?? ""} on file — leave blank to keep`
                : "Account number"
            }
          />
        </div>

        <div>
          <label className={labelCls}>VAT status</label>
          <select
            className={inputCls}
            value={vatStatus}
            onChange={(e) => setVatStatus(e.target.value as PayeeVatStatus)}
            disabled={busy}
          >
            {VAT_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        {vatStatus === "registered" && (
          <div>
            <label className={labelCls}>VAT number</label>
            <input
              className={inputCls}
              value={vatNumber}
              onChange={(e) => setVatNumber(e.target.value)}
              disabled={busy}
              autoComplete="off"
              placeholder={profile?.has_vat_number ? "On file — leave blank to keep" : "VAT number"}
            />
          </div>
        )}

        <div className="sm:col-span-2">
          <label className={labelCls}>Tax number (optional)</label>
          <input
            className={inputCls}
            value={taxNumber}
            onChange={(e) => setTaxNumber(e.target.value)}
            disabled={busy}
            autoComplete="off"
            placeholder={profile?.has_tax_number ? "On file — leave blank to keep" : "SARS tax number"}
          />
        </div>

        {/* Banking proof */}
        <div className="sm:col-span-2">
          <label className={labelCls}>Proof of banking</label>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border bg-slate-50 px-3 py-2 text-sm font-medium text-brand-navy hover:border-brand-teal hover:bg-brand-teal/5 disabled:opacity-50"
            >
              <Paperclip className="h-4 w-4 text-brand-teal" />
              {proofFile ? "Change file" : "Choose file"}
            </button>
            {proofFile ? (
              <span className="text-xs text-muted-foreground">
                {proofFile.name} ({formatFileSize(proofFile.size)})
              </span>
            ) : profile?.has_banking_proof ? (
              <button type="button" onClick={() => void viewProof()} className="text-xs font-medium text-brand-teal underline">
                View current proof
              </button>
            ) : (
              <span className="text-xs text-muted-foreground">Bank confirmation letter or stamped statement. Up to 10MB.</span>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={(e) => chooseProof(e.target.files)}
          />
          {proofError && <p className="mt-1 text-xs text-red-600">{proofError}</p>}
        </div>
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={() => void onSaveDraft()}
          disabled={busy}
          className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-brand-navy disabled:opacity-50"
        >
          {save.isPending && !submit.isPending ? "Saving…" : "Save draft"}
        </button>
        <button
          type="button"
          onClick={() => void onSubmit()}
          disabled={busy || pending}
          title={pending ? "Already submitted — awaiting review" : undefined}
          className="rounded-lg bg-brand-teal px-4 py-2 text-sm font-semibold text-white hover:bg-brand-teal/90 disabled:opacity-60"
        >
          {submit.isPending ? "Submitting…" : "Save & submit for verification"}
        </button>
      </div>
    </div>
  );
}
