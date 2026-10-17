import { useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { useOwnerCommission, useOwnerCommissionCommand, type CommissionCommand } from "@/hooks/useOwnerCommission";
import { canApproveCommission, commissionAmount, effectiveCommission, UnconfirmedCommissionChange, type ManualCommissionEntry } from "@/lib/ownerCommission";
import { formatZAR } from "@/lib/format";
import { OwnerCommissionEntryForm } from "@/components/deals/OwnerCommissionEntryForm";
import { OwnerCommissionNotices } from "@/components/deals/OwnerCommissionNotices";

const button = "rounded-lg border border-border bg-white px-3 py-2 text-sm font-medium text-brand-navy disabled:opacity-50";
const input = "rounded-lg border border-border bg-white px-3 py-2 text-sm";
type ReviewAction = { action: "void" | "adjust" | "flag"; entryId: string } | { action: "resolve"; flagId: string };
const labels = { void: "Void draft", adjust: "Add adjustment", flag: "Flag for review", resolve: "Resolve flag" };
function money(amount: string | number | null, currency: string | null) {
  if (amount == null) return "Not set";
  return currency === "ZAR" || !currency ? formatZAR(amount, { cents: true })
    : new Intl.NumberFormat("en-ZA", { style: "currency", currency }).format(Number(amount));
}

export function OwnerCommissionPanel({ dealId }: { dealId: string }) {
  const [open, setOpen] = useState(false);
  const query = useOwnerCommission(dealId, open);
  const command = useOwnerCommissionCommand(dealId);
  const [editor, setEditor] = useState<ManualCommissionEntry | "new" | null>(null);
  const [review, setReview] = useState<ReviewAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const data = query.data;
  const busy = command.isPending || query.isFetching;
  const run = async (value: CommissionCommand): Promise<boolean> => {
    // React state alone can lag a second click. Adjustments are append-only;
    // do not allow two requests before the pending state has rendered.
    if (inFlight.current) return false;
    inFlight.current = true;
    setError(null);
    try { await command.mutateAsync(value); toast.success(value.action === "approve" ? "Commission allocations approved" : "Commission change saved"); return true; }
    catch (caught) {
      if (caught instanceof UnconfirmedCommissionChange) { setEditor(null); setReview(null); }
      setError((caught as Error).message || "Could not save this commission change."); return false;
    }
    finally { inFlight.current = false; }
  };
  const saveTotal = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    try { await run({ action: "total", amount: commissionAmount(String(new FormData(event.currentTarget).get("total") ?? "")) }); }
    catch (caught) { setError((caught as Error).message); }
  };
  const approve = async () => {
    if (busy || !data || !canApproveCommission(data.reconciliation, data.entries)) return;
    if (window.confirm(`Approve the draft allocations for this deal? Allocations total ${money(data.reconciliation.entered_effective_sum, data.reconciliation.currency)}. Approval does not record a payment.`)) await run({ action: "approve" });
  };

  return <section className="rounded-xl border border-border bg-white p-5 shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="font-semibold text-brand-navy">Owner manual commission</h2>
        <p className="mt-1 text-sm text-muted-foreground">Enter your own allocations alongside the automatic calculation above. You approve the final amounts.</p></div>
      <button type="button" className={button} aria-expanded={open} aria-controls="owner-manual-commission" onClick={() => setOpen(!open)}>{open ? "Hide manual allocations" : "Enter commission manually"}</button>
    </div>
    {open ? <div id="owner-manual-commission" className="mt-5 space-y-5">
      {query.isPending ? <p className="text-sm text-muted-foreground">Loading private commission allocations…</p> : null}
      {query.isError ? <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">Could not load commission: {(query.error as Error).message}<button type="button" className="ml-2 underline" onClick={() => void query.refetch()}>Retry</button></div> : null}
      {error ? <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {data && !query.isError ? <>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Amount label="Total to allocate" value={money(data.reconciliation.stated_total, data.reconciliation.currency)} />
          <Amount label="Allocated, including adjustments" value={money(data.reconciliation.entered_effective_sum, data.reconciliation.currency)} />
          <Amount label="Difference" value={money(data.reconciliation.difference, data.reconciliation.currency)} />
          <Amount label="Open review flags" value={String(data.reconciliation.open_flags)} />
        </div>
        <form onSubmit={saveTotal} className="flex flex-wrap items-end gap-3">
          <label className="text-sm font-medium">Total to allocate (ZAR)
            <input key={String(data.reconciliation.stated_total)} name="total" required inputMode="decimal" defaultValue={data.reconciliation.stated_total ?? ""} disabled={busy || data.entries.some((entry) => ["approved", "paid"].includes(entry.status)) || (!!data.reconciliation.currency && data.reconciliation.currency !== "ZAR")} className={`${input} mt-1 block`} />
          </label>
          <button type="submit" className={button} disabled={busy || data.entries.some((entry) => ["approved", "paid"].includes(entry.status)) || (!!data.reconciliation.currency && data.reconciliation.currency !== "ZAR")}>Save total</button>
          <button type="button" className={button} disabled={busy} onClick={() => { setEditor("new"); setReview(null); }}>Add allocation</button>
          <button type="button" className="rounded-lg bg-brand-teal px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={busy || !canApproveCommission(data.reconciliation, data.entries)} onClick={() => void approve()}>Approve draft allocations</button>
          <button type="button" className={button} disabled={busy} onClick={() => void query.refetch()}>Refresh</button>
        </form>
        <p className="text-xs text-muted-foreground">Allocations must match your stated total, and all review flags must be resolved before approval. Approved amounts use recorded adjustments for corrections. Approval does not issue an invoice or record a payment.</p>
        {editor !== null ? <OwnerCommissionEntryForm key={editor === "new" ? "new" : editor.id} dealId={dealId} currency={editor === "new" ? data.reconciliation.currency ?? "ZAR" : editor.currency} entry={editor === "new" ? null : editor} people={data.people} organisations={data.organisations} leaderIds={data.leaderIds} busy={busy} onSave={run} onCancel={() => setEditor(null)} /> : null}
        {review ? <ReviewForm key={`${review.action}-${"entryId" in review ? review.entryId : review.flagId}`} review={review} busy={busy} onSave={async (value) => { if (await run(value)) setReview(null); }} onCancel={() => setReview(null)} /> : null}
        {data.entries.length === 0 ? <p className="rounded-lg bg-slate-50 p-5 text-center text-sm text-muted-foreground">No manual allocations yet. Enter your total, then add each beneficiary.</p> :
          <div className="overflow-x-auto"><table className="w-full min-w-[650px] text-left text-sm"><thead><tr className="border-b text-xs uppercase text-muted-foreground"><th className="p-3">Beneficiary</th><th className="p-3">Effective amount</th><th className="p-3">Status</th><th className="p-3">Owner actions</th></tr></thead><tbody>
            {data.entries.map((entry) => {
              const name = entry.beneficiary_name || data.people.find((person) => person.id === entry.beneficiary_profile_id)?.full_name || data.people.find((person) => person.id === entry.beneficiary_profile_id)?.email || data.organisations.find((organisation) => organisation.id === entry.beneficiary_organisation_id)?.name || "Beneficiary unavailable";
              return <tr key={entry.id} className="border-b border-border/60"><td className="p-3"><span className="font-medium">{name}</span><p className="text-xs text-muted-foreground">{entry.beneficiary_kind.replaceAll("_", " ")}{entry.basis ? ` · ${entry.basis}` : ""}</p></td><td className="p-3">{money(effectiveCommission(entry, data.adjustments), entry.currency)}<p className="text-xs text-muted-foreground">Original: {money(entry.amount, entry.currency)}</p></td><td className="p-3 capitalize">{entry.status}</td><td className="p-3"><div className="flex flex-wrap gap-2">
                {entry.status === "draft" ? <><button type="button" disabled={busy} className={button} onClick={() => { setEditor(entry); setReview(null); }}>Edit</button><button type="button" disabled={busy} className={button} onClick={() => { setReview({ action: "void", entryId: entry.id }); setEditor(null); }}>Void</button></> : null}
                {["approved", "paid"].includes(entry.status) ? <button type="button" disabled={busy} className={button} onClick={() => { setReview({ action: "adjust", entryId: entry.id }); setEditor(null); }}>Adjust</button> : null}
                {entry.status !== "void" ? <button type="button" disabled={busy} className={button} onClick={() => { setReview({ action: "flag", entryId: entry.id }); setEditor(null); }}>Flag</button> : null}
              </div></td></tr>;
            })}
          </tbody></table></div>}
        <OwnerCommissionNotices dealId={dealId} entries={data.entries} adjustments={data.adjustments} people={data.people} organisations={data.organisations} disabled={busy || !data.reconciliation.reconciled || data.reconciliation.open_flags > 0 || data.entries.some((entry) => entry.status === "draft")} />
        {data.flags.length > 0 ? <div className="space-y-2"><h3 className="font-semibold text-brand-navy">Review flags</h3>{data.flags.map((flag) => <div key={flag.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 p-3 text-sm"><div><p>{flag.note}</p><p className="text-xs text-muted-foreground">{flag.status === "open" ? "Open" : `Resolved: ${flag.resolution}`}</p></div>{flag.status === "open" ? <button type="button" disabled={busy} className={button} onClick={() => { setReview({ action: "resolve", flagId: flag.id }); setEditor(null); }}>Resolve</button> : null}</div>)}</div> : null}
        {data.adjustments.length > 0 ? <details className="rounded-lg border border-border p-3 text-sm"><summary className="cursor-pointer font-medium">Adjustment history ({data.adjustments.length})</summary><ul className="mt-3 space-y-2">{data.adjustments.map((item) => <li key={item.id}>{item.delta} · {item.reason} · {new Date(item.created_at).toLocaleString("en-ZA")}</li>)}</ul></details> : null}
      </> : null}
    </div> : null}
  </section>;
}

function Amount({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-lg font-semibold text-brand-navy">{value}</p></div>;
}

function ReviewForm({ review, busy, onSave, onCancel }: { review: ReviewAction; busy: boolean; onSave: (value: CommissionCommand) => Promise<void>; onCancel: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    try {
      setError(null);
      const fields = new FormData(event.currentTarget);
      const reason = String(fields.get("reason") ?? "").trim();
      if (reason.length < 10) throw new Error("Give a reason of at least 10 characters.");
      if (review.action === "adjust") {
        const delta = commissionAmount(String(fields.get("delta") ?? ""), true);
        if (delta === "0.00") throw new Error("An adjustment must change the amount.");
        await onSave({ ...review, reason, delta });
      } else await onSave({ ...review, reason });
    } catch (caught) { setError((caught as Error).message); }
  };
  return <form onSubmit={submit} className="space-y-3 rounded-lg border border-border bg-slate-50 p-4"><h3 className="font-semibold">{labels[review.action]}</h3><fieldset disabled={busy} className="space-y-3">
    {review.action === "adjust" ? <label className="block text-sm">Amount to add or subtract<input name="delta" required inputMode="decimal" placeholder="-50.00" className={`${input} mt-1 block w-full`} /></label> : null}
    <label className="block text-sm">{review.action === "resolve" ? "Resolution" : "Reason"}<textarea name="reason" required minLength={10} maxLength={2000} className={`${input} mt-1 block w-full`} /></label>
    <div className="flex gap-2"><button type="submit" className={button}>{busy ? "Saving…" : labels[review.action]}</button><button type="button" onClick={onCancel} className={button}>Cancel</button></div>
  </fieldset>{error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}</form>;
}
