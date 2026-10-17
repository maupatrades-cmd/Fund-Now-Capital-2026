import { useState, type FormEvent } from "react";
import { commissionAmount, commissionPercentage, type CommissionKind, type CommissionOrganisation, type CommissionPerson, type ManualCommissionEntry } from "@/lib/ownerCommission";
import type { CommissionCommand } from "@/hooks/useOwnerCommission";

const inputClass = "mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm";

export function OwnerCommissionEntryForm({ dealId, currency, entry, people, organisations, leaderIds, busy, onSave, onCancel }: {
  dealId: string; currency: string; entry: ManualCommissionEntry | null;
  people: CommissionPerson[]; organisations: CommissionOrganisation[]; leaderIds: Set<string>;
  busy: boolean; onSave: (command: CommissionCommand) => Promise<boolean>; onCancel: () => void;
}) {
  const [kind, setKind] = useState<CommissionKind>(entry?.beneficiary_kind ?? "agent");
  const [recipient, setRecipient] = useState(entry?.beneficiary_profile_id ?? entry?.beneficiary_organisation_id ?? "");
  const [error, setError] = useState<string | null>(null);
  const options = kind === "organisation"
    ? organisations.filter((item) => item.is_active).map((item) => ({ id: item.id, label: item.name }))
    : people.filter((item) => item.is_active && (kind === "team_leader" ? leaderIds.has(item.id) : ["partner", "lead_referrer"].includes(item.role)))
      .map((item) => ({ id: item.id, label: item.full_name || item.email || "Unnamed person" }));

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setError(null);
    try {
      const fields = new FormData(event.currentTarget);
      const value = (name: string) => String(fields.get(name) ?? "").trim();
      if (entry && value("reason").length < 10) throw new Error("Explain this change in at least 10 characters.");
      if (kind !== "external_payee" && !options.some((option) => option.id === recipient)) throw new Error("Select an eligible beneficiary.");
      const saved = await onSave({ action: "save", entry: {
        id: entry?.id ?? null, deal_id: dealId, beneficiary_kind: kind,
        beneficiary_profile_id: ["agent", "team_leader"].includes(kind) ? recipient : null,
        beneficiary_organisation_id: kind === "organisation" ? recipient : null,
        beneficiary_name: kind === "external_payee" ? value("name") : null,
        currency, amount: commissionAmount(value("amount")), basis: value("basis") || null,
        percentage: commissionPercentage(value("percentage")), reason: value("reason") || null,
      } });
      if (saved) onCancel();
    } catch (caught) { setError((caught as Error).message); }
  };

  return <form onSubmit={submit} className="space-y-4 rounded-lg border border-brand-teal/30 bg-brand-teal/5 p-4">
    <h3 className="font-semibold text-brand-navy">{entry ? "Edit draft allocation" : "New manual allocation"}</h3>
    <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
      <label className="text-sm font-medium">Beneficiary type
        <select className={inputClass} value={kind} onChange={(event) => { setKind(event.target.value as CommissionKind); setRecipient(""); }}>
          <option value="agent">Agent / referral partner</option><option value="team_leader">Team Leader</option>
          <option value="organisation">Organisation</option><option value="external_payee">Other payee</option>
        </select>
      </label>
      {kind === "external_payee" ? <label className="text-sm font-medium">Payee name
        <input name="name" required maxLength={200} defaultValue={entry?.beneficiary_name ?? ""} className={inputClass} />
      </label> : <label className="text-sm font-medium">Beneficiary
        <select required value={recipient} onChange={(event) => setRecipient(event.target.value)} className={inputClass}>
          <option value="">Select a beneficiary</option>{options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
      </label>}
      <label className="text-sm font-medium">Amount ({currency})
        <input name="amount" inputMode="decimal" required defaultValue={entry?.amount ?? ""} placeholder="6000.00" className={inputClass} />
      </label>
      <label className="text-sm font-medium">Percentage (optional)
        <input name="percentage" inputMode="decimal" defaultValue={entry?.percentage ?? ""} className={inputClass} />
        <span className="mt-1 block text-xs font-normal text-muted-foreground">Records your basis; the amount above is what you allocate.</span>
      </label>
      <label className="text-sm font-medium sm:col-span-2">Basis (optional)
        <input name="basis" maxLength={300} defaultValue={entry?.basis ?? ""} placeholder="Agreement or allocation basis" className={inputClass} />
      </label>
      <label className="text-sm font-medium sm:col-span-2">{entry ? "Reason for changing this draft" : "Note (optional)"}
        <textarea name="reason" required={!!entry} minLength={entry ? 10 : undefined} maxLength={2000} className={inputClass} />
      </label>
      <div className="flex gap-2 sm:col-span-2">
        <button type="submit" className="rounded-lg bg-brand-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Saving…" : "Save draft"}</button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-border bg-white px-4 py-2 text-sm">Cancel</button>
      </div>
    </fieldset>
    {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
  </form>;
}
