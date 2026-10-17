import { useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { errorText, selectClass } from "@/components/staff/StaffShell";
import {
  ARCHIVE_REASONS, useArchiveIntake, useAssignableStaff, useAssignIntake, useClearReceiptFlag, useFlagReceipt,
  useIntakeDetail, useReverseArchive, useSetIntakeStatus, useStaffRole,
} from "@/hooks/useStaffDesk";

const fmt = (iso: string) => new Date(iso).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg", dateStyle: "medium", timeStyle: "short" });
const small = "h-9 rounded-md border border-input bg-background px-3 text-sm";
const link = "text-xs font-semibold underline disabled:opacity-50";

// Per-file actions on the queue. The database decides what each role may do; this only shapes the requests.
// A move to With Founder goes through "Send to Founder" so the Deal Summary is never skipped.
export default function QueueActions({ leadId }: { leadId: string }) {
  const [open, setOpen] = useState(false);
  const { data: role } = useStaffRole();
  const detail = useIntakeDetail(leadId, open);
  const staff = useAssignableStaff(open);
  const setStatus = useSetIntakeStatus();
  const archive = useArchiveIntake();
  const reverse = useReverseArchive();
  const assign = useAssignIntake();
  const flag = useFlagReceipt();
  const clear = useClearReceiptFlag();
  const [to, setTo] = useState("documents_incomplete");
  const [statusReason, setStatusReason] = useState("");
  const [code, setCode] = useState("withdrawn");
  const [archiveReason, setArchiveReason] = useState("");
  const [flagReason, setFlagReason] = useState<Record<string, string>>({});
  const d = detail.data;
  const run = <T,>(m: { mutate: (i: T, o: { onSuccess: () => void; onError: (e: unknown) => void }) => void }, input: T, ok: string, after?: () => void) =>
    m.mutate(input, { onSuccess: () => { toast.success(ok); after?.(); }, onError: (e) => toast.error(errorText(e)) });

  if (!open) return <button type="button" className={`${link} text-brand-teal`} onClick={() => setOpen(true)}>Manage file</button>;
  return (
    <div className="mt-2 space-y-4 rounded-lg border border-border p-3 text-sm">
      <button type="button" className={`${link} text-muted-foreground`} onClick={() => setOpen(false)}>Close</button>
      {detail.error ? <p role="alert" className="text-xs text-red-600">{errorText(detail.error)}</p> : null}
      {d ? (
        <>
          <p className="text-xs text-muted-foreground">Handled by {d.assignee_name ?? "nobody yet"}{d.open_review_flags ? ` · ${d.open_review_flags} Owner review flag${d.open_review_flags === 1 ? "" : "s"}` : ""}</p>

          {!d.archived_at ? (
            <>
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-xs font-semibold">Handled by
                  <select className={`${selectClass} mt-1 max-w-xs`} defaultValue="" aria-label="Operational assignee"
                    onChange={(e) => run(assign, { leadId, assigneeId: e.target.value || null }, "Assignee updated")}>
                    <option value="">Nobody</option>
                    {(staff.data ?? []).map((s) => <option key={s.profile_id} value={s.profile_id}>{s.full_name} ({s.staff_role})</option>)}
                  </select>
                </label>
                <span className="text-xs text-muted-foreground">This does not change who introduced the file.</span>
              </div>

              <div className="flex flex-wrap items-end gap-2">
                <label className="text-xs font-semibold">Move to
                  <select className={`${selectClass} mt-1`} value={to} onChange={(e) => setTo(e.target.value)}>
                    <option value="new">New</option><option value="documents_incomplete">Documents incomplete</option><option value="complete">Complete</option>
                  </select>
                </label>
                <Input className={`${small} max-w-xs`} placeholder="Reason (needed to move back, 10+ characters)" aria-label="Reason" maxLength={300} value={statusReason} onChange={(e) => setStatusReason(e.target.value)} />
                <button type="button" className={`${link} text-brand-teal`} disabled={setStatus.isPending}
                  onClick={() => run(setStatus, { leadId, to, reason: statusReason }, "Status updated", () => setStatusReason(""))}>Move</button>
              </div>

              <div className="flex flex-wrap items-end gap-2">
                <label className="text-xs font-semibold">Archive as
                  <select className={`${selectClass} mt-1`} value={code} onChange={(e) => setCode(e.target.value)}>
                    {ARCHIVE_REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </label>
                <Input className={`${small} max-w-xs`} placeholder="Reason (10+ characters)" aria-label="Archive reason" maxLength={300} value={archiveReason} onChange={(e) => setArchiveReason(e.target.value)} />
                <button type="button" className={`${link} text-red-700`} disabled={archive.isPending || archiveReason.trim().length < 10}
                  onClick={() => run(archive, { leadId, code, reason: archiveReason }, "Archived", () => setArchiveReason(""))}>Archive</button>
              </div>
            </>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs">Archived ({d.archive_reason_code}).</span>
              {role === "owner" ? (
                <button type="button" className={`${link} text-brand-teal`} disabled={reverse.isPending}
                  onClick={() => { const r = window.prompt("Why are you reversing the archive? (10+ characters)") ?? ""; if (r.trim().length >= 10) run(reverse, { leadId, reason: r }, "Archive reversed"); }}>Reverse archive</button>
              ) : <span className="text-xs text-muted-foreground">Only the Founder can reverse an archive.</span>}
            </div>
          )}

          <div>
            <p className="mb-1 text-xs font-semibold">Documents received</p>
            <ul className="divide-y divide-border">
              {d.receipts.map((r) => (
                <li key={r.receipt_id} className="flex flex-wrap items-center gap-2 py-1.5 text-xs">
                  <span>{r.document_type.replaceAll("_", " ")} · {r.received_via.replaceAll("_", " ")} · {fmt(r.received_at)}</span>
                  {r.flagged_suspicious ? <span className="rounded bg-red-100 px-1.5 py-0.5 text-red-800">flagged suspicious</span> : null}
                  {r.flagged_suspicious && role === "owner" ? (
                    <button type="button" className={`${link} text-brand-teal`} disabled={clear.isPending}
                      onClick={() => { const why = window.prompt("Why is this document fine? (10+ characters)") ?? ""; if (why.trim().length >= 10) run(clear, { receiptId: r.receipt_id, reason: why }, "Flag cleared"); }}>Clear flag</button>
                  ) : null}
                  {!r.flagged_suspicious ? (
                    <>
                      <Input className={`${small} max-w-[14rem]`} placeholder="Why it looks wrong (10+ characters)" aria-label="Flag reason" maxLength={300}
                        value={flagReason[r.receipt_id] ?? ""} onChange={(e) => setFlagReason({ ...flagReason, [r.receipt_id]: e.target.value })} />
                      <button type="button" className={`${link} text-red-700`} disabled={flag.isPending || (flagReason[r.receipt_id] ?? "").trim().length < 10}
                        onClick={() => run(flag, { receiptId: r.receipt_id, reason: flagReason[r.receipt_id] ?? "" }, "Flagged for the Founder", () => setFlagReason({ ...flagReason, [r.receipt_id]: "" }))}>Flag suspicious</button>
                    </>
                  ) : null}
                </li>
              ))}
              {d.receipts.length === 0 ? <li className="py-1.5 text-xs text-muted-foreground">Nothing received yet.</li> : null}
            </ul>
          </div>

          <details>
            <summary className="cursor-pointer text-xs font-semibold">History</summary>
            <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
              {d.history.map((h, i) => <li key={i}>{fmt(h.at)} · {h.event.replaceAll("_", " ")}{h.to ? ` → ${h.to.replaceAll("_", " ")}` : ""}{h.actor_name ? ` · ${h.actor_name}` : ""}{h.reason ? ` · ${h.reason}` : ""}</li>)}
            </ul>
          </details>
        </>
      ) : null}
    </div>
  );
}
