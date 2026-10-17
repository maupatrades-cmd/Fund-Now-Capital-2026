import { useRef, useState, type FormEvent } from "react";
import { useSession } from "@/lib/useSession";
import { useOwnerCommissionNotices, useIssueCommissionNotice } from "@/hooks/useOwnerCommissionNotices";
import { commissionAmount, effectiveCommission, type CommissionAdjustment, type CommissionOrganisation, type CommissionPerson, type ManualCommissionEntry } from "@/lib/ownerCommission";

export function OwnerCommissionNotices({ dealId, entries, adjustments, people, organisations, disabled }: {
  dealId: string; entries: ManualCommissionEntry[]; adjustments: CommissionAdjustment[];
  people: CommissionPerson[]; organisations: CommissionOrganisation[]; disabled: boolean;
}) {
  const openedUid = useRef(useSession()?.user.id).current;
  const query = useOwnerCommissionNotices(dealId);
  const issue = useIssueCommissionNotice(dealId, openedUid);
  const inFlight = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [mustReview, setMustReview] = useState(false);
  const [issued, setIssued] = useState<string | null>(null);
  const candidates = entries.filter((entry) => entry.status === "approved" && entry.currency === "ZAR" && entry.beneficiary_kind !== "external_payee");
  const name = (entry: ManualCommissionEntry) => people.find((person) => person.id === entry.beneficiary_profile_id)?.full_name
    || organisations.find((organisation) => organisation.id === entry.beneficiary_organisation_id)?.name || "Beneficiary";
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (inFlight.current || disabled || mustReview || !query.isSuccess || query.isFetching) return;
    const entry = candidates.find((item) => item.id === new FormData(event.currentTarget).get("entry"));
    if (!entry) return;
    const amount = effectiveCommission(entry, adjustments);
    if (!window.confirm(`Issue a commission notice for ${name(entry)}: ZAR ${amount}? The Coordinator and Administrator can read this approved amount. This does not send a message, create an invoice or record payment.`)) return;
    inFlight.current = true;
    setError(null);
    try { setIssued(await issue.mutateAsync({ entryId: entry.id, amount })); }
    catch (caught) { setError((caught as Error).message); setMustReview(true); }
    finally { inFlight.current = false; }
  };
  return <section className="space-y-3 rounded-lg border border-border p-4" aria-labelledby="commission-notice-title">
    <h3 id="commission-notice-title" className="font-semibold text-brand-navy">Approved commission notices</h3>
    <p className="text-sm text-muted-foreground">Share a fixed Rand-only commission amount with the Coordinator and Administrator. The notice includes the client name, deal reference and beneficiary; it excludes FNC fees, splits and funder details.</p>
    {query.isPending ? <p className="text-sm">Loading notices…</p> : null}
    {query.isError ? <p role="alert" className="text-sm text-red-700">Notice issuance is unavailable until notices can be loaded: {query.error.message}</p> : null}
    {error ? <p role="alert" className="text-sm text-red-700">{error} Check the notice history before trying again.</p> : null}
    {issued ? <p role="status" className="text-sm text-green-800">Notice issued. Reference: {issued}</p> : null}
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
      <label className="text-sm">Approved allocation<select name="entry" required className="ml-2 rounded border p-2" disabled={disabled || issue.isPending || mustReview || !query.isSuccess || query.isFetching} defaultValue="">
        <option value="" disabled>Select beneficiary</option>
        {candidates.map((entry) => <option key={entry.id} value={entry.id}>{name(entry)} · ZAR {effectiveCommission(entry, adjustments)}</option>)}
      </select></label>
      <button type="submit" className="rounded bg-brand-navy px-3 py-2 text-sm text-white disabled:opacity-50" disabled={disabled || issue.isPending || mustReview || !query.isSuccess || query.isFetching || candidates.length === 0}>Issue approved notice</button>
      <button type="button" className="text-sm underline disabled:opacity-50" disabled={query.isFetching || issue.isPending} onClick={() => { setMustReview(false); setError(null); void query.refetch(); }}>Refresh notice history</button>
    </form>
    {query.isSuccess ? <ul className="space-y-2 text-sm">{query.data.length === 0 ? <li>No notices issued for this deal.</li> : query.data.map((notice) => <li key={notice.commission_notice_id} className="rounded bg-slate-50 p-3">
      <p>{notice.beneficiary_name} · ZAR {commissionAmount(notice.commission_amount)} · {notice.is_current ? "Current approved allocation" : "Historical — review before using"}</p>
      <p className="break-all text-xs text-muted-foreground">Reference: {notice.commission_notice_id} · {notice.client_name} · {notice.deal_reference}</p>
    </li>)}</ul> : null}
    <p className="text-xs text-muted-foreground">Issuing does not send a notice to the agent. Staff routing uses the shared notice reference. Later allocation changes preserve the original notice and require review.</p>
  </section>;
}
