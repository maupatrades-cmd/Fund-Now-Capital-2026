import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Clock3, FileText, ShieldAlert } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import {
  useOwnerPayees,
  useOwnerPayeeDetail,
  useSetPayeeVerification,
  getOwnerBankingProofUrl,
  type PayeeVerificationStatus,
} from "@/hooks/useOwnerPayees";

const STATUS_META: Record<PayeeVerificationStatus, { label: string; cls: string }> = {
  incomplete: { label: "Not submitted", cls: "bg-slate-100 text-slate-700 ring-slate-200" },
  pending_verification: { label: "Pending", cls: "bg-amber-100 text-amber-800 ring-amber-200" },
  verified: { label: "Verified", cls: "bg-emerald-100 text-emerald-800 ring-emerald-200" },
  rejected: { label: "Rejected", cls: "bg-red-100 text-red-700 ring-red-200" },
};

const ACCOUNT_TYPE_LABEL: Record<string, string> = {
  cheque: "Cheque",
  savings: "Savings",
  transmission: "Transmission",
  business: "Business",
  other: "Other",
};
const VAT_STATUS_LABEL: Record<string, string> = {
  not_registered: "Not registered",
  registered: "Registered",
  pending: "Pending",
};

function StatusBadge({ status }: { status: PayeeVerificationStatus }) {
  const m = STATUS_META[status];
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${m.cls}`}>
      {m.label}
    </span>
  );
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
}

// Owner verification surface (/settings/payees). Lists partner + contractor
// payment profiles (pending first) and opens a decrypted detail for review. The
// decrypted numbers are fetched ONLY here, only for the owner, only on open.
export default function OwnerPayeesPage() {
  const { data, isLoading, isError, error, refetch } = useOwnerPayees();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold text-brand-navy">Payee banking</h1>
        <p className="text-sm text-muted-foreground">
          Review and verify partner and contractor banking details before their first payout.
          Numbers are encrypted at rest and shown only here for verification.
        </p>
      </div>

      {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}

      {isError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Couldn't load payment profiles: {(error as Error)?.message ?? "unknown error"}.{" "}
          <button type="button" onClick={() => void refetch()} className="font-medium underline">
            Retry
          </button>
        </div>
      )}

      {!isLoading && !isError && (data?.length ?? 0) === 0 && (
        <div className="rounded-xl border border-border bg-white p-8 text-center text-sm text-muted-foreground shadow-sm">
          No payment profiles yet. They appear here once a partner or contractor saves their banking
          details.
        </div>
      )}

      {!isLoading && !isError && (data?.length ?? 0) > 0 && (
        <div className="overflow-x-auto rounded-xl border border-border bg-white shadow-sm">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-medium">Payee</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Bank</th>
                <th className="px-4 py-3 font-medium">Account</th>
                <th className="px-4 py-3 font-medium">Submitted</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((row) => (
                <tr key={row.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 font-medium text-brand-navy">{row.subject_name ?? "—"}</td>
                  <td className="px-4 py-3 capitalize text-muted-foreground">{row.subject_kind}</td>
                  <td className="px-4 py-3 text-brand-navy">{row.bank_name ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {row.account_last_four ? `•••• ${row.account_last_four}` : "—"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{fmtDate(row.submitted_at)}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={row.verification_status} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => setSelectedId(row.id)}
                      className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-brand-navy hover:bg-slate-50"
                    >
                      Review
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedId && <PayeeDetailModal profileId={selectedId} onClose={() => setSelectedId(null)} />}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="text-sm text-brand-navy">{value && value.trim() !== "" ? value : "—"}</div>
    </div>
  );
}

function PayeeDetailModal({ profileId, onClose }: { profileId: string; onClose: () => void }) {
  const { data: detail, isLoading, isError, error } = useOwnerPayeeDetail(profileId);
  const verify = useSetPayeeVerification();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  const close = () => {
    if (verify.isPending) return;
    onClose();
  };

  const onApprove = async () => {
    try {
      await verify.mutateAsync({ profileId, approve: true });
      toast.success("Payment profile verified");
      onClose();
    } catch (e) {
      toast.error((e as Error).message || "Could not verify");
    }
  };

  const onReject = async () => {
    if (reason.trim() === "") return;
    try {
      await verify.mutateAsync({ profileId, approve: false, reason: reason.trim() });
      toast.success("Payment profile rejected");
      onClose();
    } catch (e) {
      toast.error((e as Error).message || "Could not reject");
    }
  };

  const viewProof = async () => {
    if (!detail?.banking_proof_storage_path) return;
    try {
      const url = await getOwnerBankingProofUrl(detail.banking_proof_storage_path);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast.error((e as Error).message || "Could not open the proof file");
    }
  };

  const pending = detail?.verification_status === "pending_verification";

  return (
    <Modal title="Payee banking details" onClose={close} maxWidth="max-w-lg">
      {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
      {isError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          Couldn't load the details: {(error as Error)?.message ?? "unknown error"}.
        </div>
      )}

      {detail && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-brand-navy">{detail.subject_name ?? "—"}</div>
              <div className="text-xs capitalize text-muted-foreground">{detail.subject_kind}</div>
            </div>
            <StatusBadge status={detail.verification_status} />
          </div>

          {detail.verification_status === "rejected" && detail.rejection_reason && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-2 text-sm text-red-700">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>Rejected — {detail.rejection_reason}</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 rounded-lg border border-border p-3">
            <div className="col-span-2">
              <DetailRow label="Account holder" value={detail.account_holder_name} />
            </div>
            <DetailRow label="Bank" value={detail.bank_name} />
            <DetailRow label="Branch code" value={detail.branch_code} />
            <DetailRow
              label="Account type"
              value={detail.account_type ? ACCOUNT_TYPE_LABEL[detail.account_type] ?? detail.account_type : null}
            />
            <DetailRow label="Account number" value={detail.account_number} />
            <DetailRow
              label="VAT status"
              value={detail.vat_status ? VAT_STATUS_LABEL[detail.vat_status] ?? detail.vat_status : null}
            />
            <DetailRow label="VAT number" value={detail.vat_number} />
            <DetailRow label="Tax number" value={detail.tax_number} />
          </div>

          <div className="flex items-center gap-2 text-sm">
            <FileText className="h-4 w-4 text-muted-foreground" />
            {detail.banking_proof_storage_path ? (
              <button type="button" onClick={() => void viewProof()} className="font-medium text-brand-teal underline">
                View proof of banking
              </button>
            ) : (
              <span className="text-muted-foreground">No proof uploaded</span>
            )}
          </div>

          {pending ? (
            rejecting ? (
              <div className="space-y-2">
                <label className="block text-xs font-medium text-brand-navy">Reason for rejection</label>
                <textarea
                  className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-brand-navy outline-none focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/20"
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Tell the payee what to fix (they'll see this)."
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setRejecting(false)}
                    disabled={verify.isPending}
                    className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-brand-navy disabled:opacity-50"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={() => void onReject()}
                    disabled={verify.isPending || reason.trim() === ""}
                    className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    {verify.isPending ? "Rejecting…" : "Confirm rejection"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setRejecting(true)}
                  disabled={verify.isPending}
                  className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-brand-navy disabled:opacity-50"
                >
                  Reject
                </button>
                <button
                  type="button"
                  onClick={() => void onApprove()}
                  disabled={verify.isPending}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-brand-teal px-4 py-2 text-sm font-semibold text-white hover:bg-brand-teal/90 disabled:opacity-60"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  {verify.isPending ? "Verifying…" : "Verify"}
                </button>
              </div>
            )
          ) : (
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-muted-foreground">
              <Clock3 className="h-4 w-4 shrink-0" />
              {detail.verification_status === "verified"
                ? "Verified. If the payee edits their details, the profile returns to pending for re-verification."
                : "Only a submitted (pending) profile can be verified or rejected. The payee must resubmit after edits."}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
