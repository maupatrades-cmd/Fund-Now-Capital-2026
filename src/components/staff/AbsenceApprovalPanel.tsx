import { useState } from "react";
import { toast } from "sonner";
import { Field, card, errorText, primaryButton, textareaClass } from "@/components/staff/StaffShell";
import { isStaffManager, useAbsenceApprovals, useApproveInAbsence, useStaffRole } from "@/hooks/useStaffDesk";

const fmt = (iso: string) => new Date(iso).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg", dateStyle: "medium", timeStyle: "short" });

// Owner spec 17 Oct, section 3: when the Director is away, the Administrator approves the documents on a
// Complete file. The database records who, when and why, and tells the Director. It does not verify the
// file and does not touch rewards or commission.
export function AbsenceApprovalPanel({ leadId, workflowStatus }: { leadId: string; workflowStatus: string | undefined }) {
  const { data: role } = useStaffRole();
  const canSee = isStaffManager(role);
  const approvals = useAbsenceApprovals(leadId, canSee);
  const approve = useApproveInAbsence(leadId);
  const [note, setNote] = useState("");
  if (!canSee) return null;
  const done = (approvals.data ?? []).length > 0;
  const ready = workflowStatus === "complete" || workflowStatus === "with_founder";

  return (
    <section className={`${card} space-y-3`}>
      <h2 className="text-base font-bold text-brand-navy">Documents approved while the Director is away</h2>
      {approvals.error ? <p role="alert" className="text-sm text-red-600">{errorText(approvals.error)}</p> : null}
      {(approvals.data ?? []).map((a) => (
        <p key={a.id} className="rounded-lg bg-green-50 p-3 text-sm text-green-900">
          Approved by {a.approved_by_name} on {fmt(a.created_at)}. Reason: {a.away_note}
        </p>
      ))}
      {!done && role === "administrator" ? (
        ready ? (
          <form className="space-y-3" onSubmit={(e) => {
            e.preventDefault();
            approve.mutate(note, {
              onSuccess: () => { toast.success("Approval recorded. The Director has been told."); setNote(""); },
              onError: (err) => toast.error(errorText(err)),
            });
          }}>
            <p className="text-xs text-muted-foreground">
              Use this only when the Director is not available. It records your approval and tells the Director. The Director still verifies the file.
            </p>
            <Field label="Why is the Director away? (at least 10 characters)">
              <textarea maxLength={500} className={textareaClass} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <button type="submit" className={primaryButton} disabled={approve.isPending || note.trim().length < 10}>Approve documents</button>
          </form>
        ) : (
          <p className="text-sm text-muted-foreground">The file must be Complete (every required document received) before the documents can be approved.</p>
        )
      ) : null}
      {!done && role !== "administrator" ? <p className="text-sm text-muted-foreground">No approval recorded.</p> : null}
    </section>
  );
}
