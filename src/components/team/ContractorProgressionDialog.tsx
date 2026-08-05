import { useEffect, useState } from "react";
import { Loader2, TrendingUp, Award, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import {
  useContractorProgression,
  usePromoteContractor,
} from "@/hooks/useContractorProgression";
import {
  LEVEL_ORDER,
  LEVEL_LABEL,
  REIMBURSEMENT_ZAR,
  type ProgressionLevel,
} from "@/lib/progression";
import { formatZAR, formatRelative } from "@/lib/format";

// Owner-only Team Management dialog: view a contractor's full progression
// (INCLUDING FNC gross — owner view) and change their level with a required
// reason (owner_promote_contractor). Self-contained modal so the TeamPage edit
// stays a single additive menu item.
export default function ContractorProgressionDialog({
  contractorId,
  contractorName,
  onClose,
}: {
  contractorId: string;
  contractorName: string;
  onClose: () => void;
}) {
  const { data, isLoading, isError } = useContractorProgression(contractorId);
  const promote = usePromoteContractor();
  const [newLevel, setNewLevel] = useState<ProgressionLevel | "">("");
  const [reason, setReason] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Default the selector to the current level once loaded.
  useEffect(() => {
    if (data && newLevel === "") setNewLevel(data.current_level);
  }, [data, newLevel]);

  const gross = data?.metrics.fnc_gross_generated;
  const unchanged = !data || newLevel === "" || newLevel === data.current_level;

  const onPromote = async () => {
    if (!data || newLevel === "" || newLevel === data.current_level) return;
    try {
      await promote.mutateAsync({
        contractorId,
        newLevel: newLevel as ProgressionLevel,
        reason: reason.trim(),
      });
      toast.success(`${contractorName} is now at ${LEVEL_LABEL[newLevel as ProgressionLevel]}`);
      setReason("");
    } catch (e) {
      toast.error((e as Error).message || "Could not change the level.");
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-xl border border-border bg-white p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Contractor progression"
      >
        <div className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-brand-teal" />
          <h3 className="text-base font-semibold text-brand-navy">Progression — {contractorName}</h3>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading progression…
          </div>
        ) : isError || !data ? (
          <p className="py-6 text-sm text-red-600">Couldn't load this contractor's progression.</p>
        ) : (
          <>
            {/* Current level + metrics (owner sees FNC gross) */}
            <div className="rounded-lg border border-border bg-slate-50 p-4">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-teal/10 px-3 py-1 text-sm font-semibold text-brand-teal">
                  <Award className="h-4 w-4" /> {LEVEL_LABEL[data.current_level]}
                </span>
                <span className="text-sm text-brand-navy">
                  <span className="font-semibold">{formatZAR(REIMBURSEMENT_ZAR[data.current_level])}</span>
                  <span className="text-muted-foreground"> / month</span>
                </span>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <Stat label="Leads" value={String(data.metrics.leads_submitted)} />
                <Stat label="Deals funded" value={String(data.metrics.deals_funded)} />
                <Stat
                  label="FNC gross"
                  value={gross === undefined ? "—" : formatZAR(gross)}
                />
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                FNC gross is owner-only — never shown on contractor surfaces (S7C).
              </p>
            </div>

            {/* Promotion history */}
            <ProgressionHistory data={data} />

            {/* Level change */}
            <div className="space-y-3 rounded-lg border border-border p-4">
              <p className="text-sm font-semibold text-brand-navy">Change level</p>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor="cp-level">
                  New level
                </label>
                <select
                  id="cp-level"
                  className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-brand-navy outline-none focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/20"
                  value={newLevel}
                  onChange={(e) => setNewLevel(e.target.value as ProgressionLevel)}
                >
                  {LEVEL_ORDER.map((lvl) => (
                    <option key={lvl} value={lvl}>
                      {LEVEL_LABEL[lvl]} — {formatZAR(REIMBURSEMENT_ZAR[lvl])}/mo
                      {lvl === data.current_level ? " (current)" : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor="cp-reason">
                  Reason (recorded in the audit log)
                </label>
                <textarea
                  id="cp-reason"
                  rows={2}
                  className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-brand-navy outline-none focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/20"
                  placeholder="e.g. Consistent quality leads and first funded deal."
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </div>
              <p className="flex items-start gap-2 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-800">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                Changing the level updates the contractor's monthly reimbursement reference and is
                recorded against them in the audit log.
              </p>
            </div>
          </>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-brand-navy hover:bg-slate-50"
          >
            Close
          </button>
          <button
            type="button"
            onClick={onPromote}
            disabled={unchanged || reason.trim().length === 0 || promote.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-teal px-4 py-2 text-sm font-semibold text-white hover:bg-brand-teal/90 disabled:opacity-60"
          >
            {promote.isPending ? "Saving…" : "Update level"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-white px-2 py-2">
      <p className="text-sm font-bold text-brand-navy">{value}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

function ProgressionHistory({
  data,
}: {
  data: NonNullable<ReturnType<typeof useContractorProgression>["data"]>;
}) {
  const events = [
    { key: "Base", at: data.activated_at, label: "Activated at Base" },
    { key: "1", at: data.promoted_at_l1, label: "Promoted to Level 1" },
    { key: "2", at: data.promoted_at_l2, label: "Promoted to Level 2" },
    { key: "3", at: data.promoted_at_l3, label: "Promoted to Level 3" },
  ].filter((e) => e.at);

  if (events.length === 0) return null;

  return (
    <div className="rounded-lg border border-border p-4">
      <p className="text-sm font-semibold text-brand-navy">History</p>
      <ul className="mt-2 space-y-1.5">
        {events.map((e) => (
          <li key={e.key} className="flex items-center justify-between text-sm">
            <span className="text-brand-navy">{e.label}</span>
            <span className="text-xs text-muted-foreground">{formatRelative(e.at)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
