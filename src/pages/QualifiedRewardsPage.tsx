import { useMemo, useState } from "react";
import { CalendarClock, CircleCheck, LockKeyhole, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { formatZAR } from "@/lib/format";
import { useProfileRole } from "@/hooks/useProfileRole";
import {
  useMarkQualifiedRewardBatchPaid,
  useQualifiedRewardPayroll,
  useRecordQualifiedRewardAction,
  useScheduleQualifiedRewardBatch,
  type QualifiedRewardRow,
} from "@/hooks/useQualifiedRewardPayroll";

export default function QualifiedRewardsPage() {
  const role = useProfileRole();
  const query = useQualifiedRewardPayroll();
  const isOwner = role.data === "owner";
  const rows = query.data ?? [];

  return (
    <div className="max-w-7xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-brand-navy">R100 qualification rewards</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          One reward per attributed lead after the complete approved pack is actually submitted to a funder. Cutoff is the 22nd; payment is scheduled for the 25th or 30th.
        </p>
      </header>
      {query.isLoading ? <p className="text-sm text-muted-foreground">Loading reward payroll…</p> : null}
      {query.isError ? <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">Couldn&apos;t load reward payroll: {(query.error as Error).message}</div> : null}
      {!query.isLoading && !query.isError ? <RewardTotals rows={rows} /> : null}
      {isOwner && !query.isLoading && !query.isError ? <OwnerControls rows={rows} /> : null}
      {!query.isLoading && !query.isError ? <RewardTable rows={rows} isOwner={isOwner} /> : null}
      <p className="text-xs text-muted-foreground">You can see only your own rewards unless you are the Owner. Client details, other payees and commission amounts are not exposed.</p>
    </div>
  );
}

function RewardTotals({ rows }: { rows: QualifiedRewardRow[] }) {
  const locked = rows.filter((row) => row.current_status === "locked");
  const pending = rows.filter((row) => ["scheduled", "held", "released", "carried_forward"].includes(row.current_status));
  const paid = rows.filter((row) => row.current_status === "paid");
  return <div className="grid gap-3 sm:grid-cols-3"><Total icon={LockKeyhole} label="Earned and locked" count={locked.length} /><Total icon={CalendarClock} label="Pending payout" count={pending.length} /><Total icon={CircleCheck} label="Paid" count={paid.length} /></div>;
}

function Total({ icon: Icon, label, count }: { icon: typeof LockKeyhole; label: string; count: number }) {
  return <div className="rounded-xl border border-border bg-white p-4 shadow-sm"><Icon className="h-5 w-5 text-brand-teal" /><p className="mt-3 text-xs font-medium text-muted-foreground">{label}</p><p className="mt-1 text-xl font-bold text-brand-navy">{formatZAR(count * 100, { cents: true })}</p><p className="text-xs text-muted-foreground">{count} reward{count === 1 ? "" : "s"}</p></div>;
}

function OwnerControls({ rows }: { rows: QualifiedRewardRow[] }) {
  const now = new Date();
  const [cycle, setCycle] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`);
  const [payday, setPayday] = useState<25 | 30>(25);
  const [reference, setReference] = useState("");
  const [proofPath, setProofPath] = useState("");
  const [batchId, setBatchId] = useState("");
  const schedule = useScheduleQualifiedRewardBatch();
  const pay = useMarkQualifiedRewardBatchPaid();
  const batches = useMemo(() => Array.from(new Map(rows.filter((row) => row.batch_id).map((row) => [row.batch_id!, row])).values()), [rows]);

  const scheduleBatch = async () => {
    try { await schedule.mutateAsync({ cycleMonth: cycle, payday }); toast.success("R100 payout batch scheduled"); }
    catch (error) { toast.error((error as Error).message); }
  };
  const markPaid = async () => {
    if (!batchId || !reference.trim() || !proofPath.trim()) return toast.error("Choose a batch and add both payment reference and proof path");
    try { await pay.mutateAsync({ batchId, reference, proofPath }); toast.success("Payment evidence recorded"); setReference(""); setProofPath(""); }
    catch (error) { toast.error((error as Error).message); }
  };

  return <section className="rounded-xl border border-brand-teal/30 bg-brand-teal/5 p-5"><h2 className="font-semibold text-brand-navy">Owner payout batch</h2><p className="mt-1 text-xs text-muted-foreground">Schedule eligible locked rewards, then record cleared payment with its EFT reference and proof-of-payment storage path.</p><div className="mt-4 grid gap-3 md:grid-cols-4"><input aria-label="Payout cycle" type="month" value={cycle.slice(0, 7)} onChange={(event) => setCycle(`${event.target.value}-01`)} className="rounded-lg border border-border bg-white px-3 py-2 text-sm" /><select aria-label="Payout day" value={payday} onChange={(event) => setPayday(Number(event.target.value) as 25 | 30)} className="rounded-lg border border-border bg-white px-3 py-2 text-sm"><option value={25}>25th</option><option value={30}>30th</option></select><button type="button" onClick={scheduleBatch} disabled={schedule.isPending} className="rounded-lg bg-brand-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{schedule.isPending ? "Scheduling…" : "Schedule batch"}</button></div><div className="mt-5 grid gap-3 md:grid-cols-4"><select aria-label="Reward batch" value={batchId} onChange={(event) => setBatchId(event.target.value)} className="rounded-lg border border-border bg-white px-3 py-2 text-sm"><option value="">Select batch</option>{batches.map((row) => <option key={row.batch_id!} value={row.batch_id!}>{row.payout_date ?? "Unscheduled"} · {row.batch_id!.slice(0, 8)}</option>)}</select><input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="EFT / payment reference" className="rounded-lg border border-border bg-white px-3 py-2 text-sm" /><input value={proofPath} onChange={(event) => setProofPath(event.target.value)} placeholder="Proof storage path" className="rounded-lg border border-border bg-white px-3 py-2 text-sm" /><button type="button" onClick={markPaid} disabled={pay.isPending} className="rounded-lg bg-brand-teal px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{pay.isPending ? "Recording…" : "Record batch paid"}</button></div></section>;
}

function RewardTable({ rows, isOwner }: { rows: QualifiedRewardRow[]; isOwner: boolean }) {
  const action = useRecordQualifiedRewardAction();
  const runAction = async (row: QualifiedRewardRow, eventType: "held" | "released" | "carried_forward" | "reversed") => {
    const reason = eventType === "released" ? "Owner released payout hold" : window.prompt(`Reason for ${eventType.replace("_", " ")}:`)?.trim();
    if (!reason) return;
    try { await action.mutateAsync({ rewardLockId: row.reward_lock_id, eventType, reason }); toast.success("Reward action recorded"); }
    catch (error) { toast.error((error as Error).message); }
  };
  if (rows.length === 0) return <div className="rounded-xl border border-border bg-white p-10 text-center"><ShieldAlert className="mx-auto h-8 w-8 text-muted-foreground" /><p className="mt-3 text-sm font-medium text-brand-navy">No R100 rewards have locked yet</p><p className="mt-1 text-xs text-muted-foreground">A reward appears only after complete approved documents are dispatched to a funder.</p></div>;
  return <div className="overflow-x-auto rounded-xl border border-border bg-white"><table className="w-full min-w-[900px] text-sm"><thead><tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground"><th className="px-4 py-3">Beneficiary</th><th className="px-4 py-3">Role</th><th className="px-4 py-3">Locked</th><th className="px-4 py-3">Cutoff</th><th className="px-4 py-3">Payout</th><th className="px-4 py-3">Status</th>{isOwner ? <th className="px-4 py-3">Owner action</th> : null}</tr></thead><tbody>{rows.map((row) => <tr key={row.reward_lock_id} className="border-b border-border/60"><td className="px-4 py-3 font-medium text-brand-navy">{row.beneficiary_name || "Reward beneficiary"}<p className="text-xs font-normal text-muted-foreground">{formatZAR(Number(row.amount), { cents: true })}</p></td><td className="px-4 py-3 capitalize">{row.beneficiary_role.replace("_", " ")}</td><td className="px-4 py-3">{new Date(row.locked_at).toLocaleDateString("en-ZA")}</td><td className="px-4 py-3">{row.cutoff_date}</td><td className="px-4 py-3">{row.payout_date ?? "Owner to select"}</td><td className="px-4 py-3"><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold capitalize">{row.current_status.replace("_", " ")}</span></td>{isOwner ? <td className="px-4 py-3"><div className="flex flex-wrap gap-2">{row.current_status === "held" ? <ActionButton label="Release" onClick={() => runAction(row, "released")} /> : <ActionButton label="Hold" onClick={() => runAction(row, "held")} />}<ActionButton label="Carry" onClick={() => runAction(row, "carried_forward")} /><ActionButton label="Reverse" danger onClick={() => runAction(row, "reversed")} /></div></td> : null}</tr>)}</tbody></table></div>;
}

function ActionButton({ label, onClick, danger = false }: { label: string; onClick: () => void; danger?: boolean }) {
  return <button type="button" onClick={onClick} className={`rounded border px-2 py-1 text-xs font-medium ${danger ? "border-red-200 text-red-700" : "border-border text-brand-navy"}`}>{label}</button>;
}
