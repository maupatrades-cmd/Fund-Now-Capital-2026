import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { CallButton, CallHistory } from "@/components/calls/CallButton";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { card, errorText, Field, primaryButton, selectClass } from "@/components/staff/StaffShell";
import { useStaffRole } from "@/hooks/useStaffDesk";
import { ScannedFormsTab } from "@/components/forms/ScannedFormsTab";
import {
  useAgentFile, useAgentTypeState, useCorrectAgent, useOrganisationOptions, useRevealAgentSensitive, useSaveAgentBank,
  useSaveAgentDetails, type AgentFile, type AgentSensitive, type AgentType, type BankAccountType, type VatStatus,
} from "@/hooks/useAgentFile";

// Agent file (owner, 17 Nov 2026): the Office Administrator, HR and the Director capture an agent's details and bank
// details on the agent's behalf. Numbers are typed here but always read back masked; only HR and the Director can
// reveal them (POPIA). Scanned documents come from the scanned-forms feature (its tab is mounted below); an uploaded
// Bank Confirmation Letter becomes the agent's proof of banking.
const ROLE_LABEL: Record<AgentFile["role"], string> = { partner: "Partner / Team Leader", contractor: "Direct agent", lead_referrer: "Sub-agent" };
const STATUS_LABEL: Record<NonNullable<AgentFile["bank"]>["verification_status"], string> = {
  incomplete: "Incomplete", pending_verification: "Waiting for the Director to verify", verified: "Verified", rejected: "Rejected",
};
const ACCOUNT_TYPES: BankAccountType[] = ["cheque", "savings", "transmission", "business", "other"];

function DetailsForm({ f }: { f: AgentFile }) {
  const save = useSaveAgentDetails(f.profile_id);
  const [name, setName] = useState(f.full_name ?? "");
  const [phone, setPhone] = useState(f.phone_number ?? "");
  const [address, setAddress] = useState(f.physical_address ?? "");
  const [contract, setContract] = useState(f.contract_type ?? "");
  const [idNumber, setIdNumber] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    // Only changed fields go to the server; an empty ID box keeps the stored number.
    save.mutate({
      fullName: name.trim() !== (f.full_name ?? "") ? name.trim() : null,
      phone: phone.trim() !== (f.phone_number ?? "") ? phone.trim() : null,
      address: address.trim() !== (f.physical_address ?? "") ? address.trim() : null,
      contractType: contract && contract !== f.contract_type ? contract : null,
      idNumber: idNumber.trim() || null,
    }, {
      onSuccess: () => { toast.success("Details saved"); setIdNumber(""); },
      onError: (err) => toast.error(errorText(err)),
    });
  };

  return (
    <form onSubmit={submit} className={`${card} space-y-4`}>
      <h2 className="text-lg font-bold text-brand-navy">Details</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Email (sign-in)" hint="Ask the Director to change the email."><Input value={f.email ?? ""} disabled /></Field>
        <Field label="Cell number"><Input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
        <Field label="Contract type">
          <select className={selectClass} value={contract} onChange={(e) => setContract(e.target.value)}>
            <option value="">Not set</option>
            <option value="SAA-01">SAA-01 · Sub-agent (Bright Destiny)</option>
            <option value="DRA-01">DRA-01 · Direct agent</option>
          </select>
        </Field>
        <Field label="Physical address"><Input value={address} onChange={(e) => setAddress(e.target.value)} /></Field>
        <Field label="SA ID number" hint={f.has_id_number ? "An ID number is on file. Type a new one only to replace it." : "13 digits. Stored encrypted; shown to HR and the Director only."}>
          <Input inputMode="numeric" autoComplete="off" value={idNumber} onChange={(e) => setIdNumber(e.target.value)} placeholder={f.has_id_number ? "On file" : ""} />
        </Field>
      </div>
      <button type="submit" className={primaryButton} disabled={save.isPending}>Save details</button>
    </form>
  );
}

const TYPE_LABEL: Record<AgentType, string> = { direct: "Direct agent", sub: "Sub-agent", team_leader: "Team Leader" };

// Correct a capture mistake in the agent's type (owner, 19 Nov 2026): the Office Administrator and the Director only.
// The agent file, onboarding checklist and scanned forms all follow automatically (they key on the person).
function AgentTypeCard({ f }: { f: AgentFile }) {
  const state = useAgentTypeState(f.profile_id, true);
  const orgs = useOrganisationOptions(true);
  const correct = useCorrectAgent(f.profile_id);
  const [type, setType] = useState<AgentType | "">("");
  const [org, setOrg] = useState("");
  const [reason, setReason] = useState("");
  const s = state.data;
  if (state.error) return <section className={card}><p role="alert" className="text-sm text-red-600">{errorText(state.error)}</p></section>;
  if (!s) return null;
  const chosen = (type || s.type) as AgentType;
  const chosenOrg = org || s.organisation_id || "";
  const submit = (e: FormEvent) => {
    e.preventDefault();
    correct.mutate({ type: chosen, organisationId: chosen === "direct" ? null : chosenOrg || null, reason: reason.trim() }, {
      onSuccess: () => { toast.success(`Corrected to ${TYPE_LABEL[chosen]}`); setType(""); setOrg(""); setReason(""); },
      onError: (err) => toast.error(errorText(err)),
    });
  };
  return (
    <form onSubmit={submit} className={`${card} space-y-4`}>
      <h2 className="text-lg font-bold text-brand-navy">Agent type</h2>
      <p className="text-sm text-muted-foreground">
        Now: <strong>{TYPE_LABEL[s.type]}</strong>{s.organisation_name ? ` · ${s.organisation_name}` : ""}.
        If this agent was added as the wrong type, correct it here. The Director is told.
      </p>
      {s.type_locked ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">{s.type_locked_reason}</p>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Correct type">
              <select className={selectClass} value={chosen} onChange={(e) => setType(e.target.value as AgentType)}>
                <option value="direct">Direct agent (no Team Leader)</option>
                <option value="sub">Sub-agent (under a Team Leader)</option>
                <option value="team_leader">Team Leader</option>
              </select>
            </Field>
            {chosen !== "direct" ? (
              <Field label="Organisation">
                <select className={selectClass} value={chosenOrg} onChange={(e) => setOrg(e.target.value)} required>
                  <option value="">Choose…</option>
                  {(orgs.data ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </Field>
            ) : null}
          </div>
          <Field label="What was wrong?">
            <Input required minLength={5} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Added as Direct agent by mistake" />
          </Field>
          <button type="submit" className={primaryButton}
            disabled={correct.isPending || reason.trim().length < 5 || (chosen === s.type && (chosen === "direct" || chosenOrg === s.organisation_id))}>
            Save correction
          </button>
        </>
      )}
    </form>
  );
}

function BankForm({ f }: { f: AgentFile }) {
  const save = useSaveAgentBank(f.profile_id);
  const b = f.bank;
  const [holder, setHolder] = useState(b?.account_holder_name ?? "");
  const [bank, setBank] = useState(b?.bank_name ?? "");
  const [branch, setBranch] = useState(b?.branch_code ?? "");
  const [accountType, setAccountType] = useState<BankAccountType | "">(b?.account_type ?? "");
  const [account, setAccount] = useState("");
  const [tax, setTax] = useState("");
  const [vatStatus, setVatStatus] = useState<VatStatus>(b?.vat_status ?? "not_registered");
  const [vat, setVat] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate({
      holder: holder.trim() || null, bank: bank.trim() || null, branch: branch.trim() || null,
      accountType: accountType || null, accountNumber: account.trim() || null, taxNumber: tax.trim() || null,
      vatStatus, vatNumber: vatStatus === "registered" ? vat.trim() || null : null,
    }, {
      onSuccess: () => { toast.success("Bank details saved"); setAccount(""); setTax(""); setVat(""); },
      onError: (err) => toast.error(errorText(err)),
    });
  };

  if (!f.partner_linked) {
    return (
      <section className={card}>
        <h2 className="text-lg font-bold text-brand-navy">Bank details</h2>
        <p className="mt-2 text-sm text-muted-foreground">This partner is not linked to a brokerage yet. The Director links them on the Team page; then bank details can be captured here.</p>
      </section>
    );
  }

  return (
    <form onSubmit={submit} className={`${card} space-y-4`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-bold text-brand-navy">Bank details</h2>
        {b ? <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-brand-navy">{STATUS_LABEL[b.verification_status]}</span> : null}
      </div>
      {b ? (
        <p className="text-sm text-muted-foreground">
          On file: {b.bank_name ?? "bank not set"}{b.account_last_four ? ` · account ending ${b.account_last_four}` : ""}
          {b.has_tax_number ? " · tax number on file" : ""}{b.has_banking_proof ? " · proof of banking on file" : " · proof of banking still needed"}
          {b.captured_by_name ? ` · captured by ${b.captured_by_name}` : ""}
          {b.rejection_reason ? ` · rejected: ${b.rejection_reason}` : ""}
        </p>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Account holder"><Input value={holder} onChange={(e) => setHolder(e.target.value)} /></Field>
        <Field label="Bank"><Input value={bank} onChange={(e) => setBank(e.target.value)} /></Field>
        <Field label="Branch code"><Input inputMode="numeric" value={branch} onChange={(e) => setBranch(e.target.value)} /></Field>
        <Field label="Account type">
          <select className={selectClass} value={accountType} onChange={(e) => setAccountType(e.target.value as BankAccountType | "")}>
            <option value="">Choose</option>
            {ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}
          </select>
        </Field>
        <Field label="Account number" hint={b?.account_last_four ? "Leave empty to keep the account on file." : undefined}>
          <Input inputMode="numeric" autoComplete="off" value={account} onChange={(e) => setAccount(e.target.value)} />
        </Field>
        <Field label="SARS tax number" hint={b?.has_tax_number ? "Leave empty to keep the number on file." : "Optional."}>
          <Input inputMode="numeric" autoComplete="off" value={tax} onChange={(e) => setTax(e.target.value)} />
        </Field>
        <Field label="VAT">
          <select className={selectClass} value={vatStatus} onChange={(e) => setVatStatus(e.target.value as VatStatus)}>
            <option value="not_registered">Not registered</option>
            <option value="pending">Registration pending</option>
            <option value="registered">Registered</option>
          </select>
        </Field>
        {vatStatus === "registered" ? (
          <Field label="VAT number" hint={b?.has_vat_number ? "Leave empty to keep the number on file." : undefined}>
            <Input inputMode="numeric" autoComplete="off" value={vat} onChange={(e) => setVat(e.target.value)} />
          </Field>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        Saving replaces the details on file and sends them to the Director to verify once the proof of banking is attached. Numbers are stored
        encrypted and shown here only as the last four digits.
      </p>
      <button type="submit" className={primaryButton} disabled={save.isPending}>Save bank details</button>
    </form>
  );
}

function FullNumbers({ profileId }: { profileId: string }) {
  const reveal = useRevealAgentSensitive(profileId);
  const [shown, setShown] = useState<AgentSensitive | null>(null);
  return (
    <section className={`${card} space-y-3`}>
      <h2 className="text-lg font-bold text-brand-navy">Full numbers</h2>
      <p className="text-sm text-muted-foreground">HR and the Director only. Each look is recorded in the audit log.</p>
      {shown ? (
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div><dt className="font-semibold text-brand-navy">SA ID number</dt><dd>{shown.id_number ?? "Not on file"}</dd></div>
          <div><dt className="font-semibold text-brand-navy">Account number</dt><dd>{shown.account_number ?? "Not on file"}</dd></div>
          <div><dt className="font-semibold text-brand-navy">Tax number</dt><dd>{shown.tax_number ?? "Not on file"}</dd></div>
          <div><dt className="font-semibold text-brand-navy">VAT number</dt><dd>{shown.vat_number ?? "Not on file"}</dd></div>
        </dl>
      ) : null}
      <button type="button" className="text-sm font-semibold text-brand-teal underline disabled:opacity-50" disabled={reveal.isPending}
        onClick={() => (shown ? setShown(null) : reveal.mutate(undefined, { onSuccess: setShown, onError: (e) => toast.error(errorText(e)) }))}>
        {shown ? "Hide numbers" : "Show full numbers"}
      </button>
    </section>
  );
}

export default function StaffAgentFilePage() {
  const { profileId } = useParams();
  const { data: role } = useStaffRole();
  const allowed = role === "owner" || role === "hr" || role === "administrator";
  const q = useAgentFile(allowed ? profileId : undefined);
  if (!allowed) return <p className="text-sm text-muted-foreground">Agent files are for the Director, HR and the Office Administrator.</p>;
  if (q.isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (q.error || !q.data) return <p role="alert" className="text-sm text-red-600">{errorText(q.error)}</p>;
  const f = q.data;
  return (
    <div className="space-y-5">
      <div>
        <Link to="/staff/onboarding" className="text-sm font-semibold text-brand-teal hover:underline">← Agent onboarding</Link>
        <h1 className="mt-1 text-2xl font-bold text-brand-navy">{f.full_name ?? "Unnamed agent"}</h1>
        <p className="text-sm text-muted-foreground">
          {ROLE_LABEL[f.role]}{f.agent_code ? ` · Agent Code ${f.agent_code}` : " · no Agent Code yet"}{f.is_active ? "" : " · deactivated"}
        </p>
        <div className="mt-2">
          <CallButton hasNumber={Boolean(f.phone_number)} target={{ kind: "profile", id: profileId ?? "", name: f.full_name ?? "this agent" }} />
        </div>
      </div>
      {role === "owner" && profileId ? <CallHistory target={{ kind: "profile", id: profileId, name: f.full_name ?? "this agent" }} /> : null}
      {/* key: reset the forms when a save brings back new values */}
      <DetailsForm key={`d-${f.details_updated_at ?? ""}`} f={f} />
      {role === "owner" || role === "administrator" ? <AgentTypeCard f={f} /> : null}
      <BankForm key={`b-${f.bank?.updated_at ?? ""}`} f={f} />
      {f.can_view_sensitive ? <FullNumbers profileId={f.profile_id} /> : null}
      <section className={card}>
        <ScannedFormsTab subject={{ kind: "person", id: f.profile_id, name: f.full_name ?? undefined }} />
      </section>
    </div>
  );
}
