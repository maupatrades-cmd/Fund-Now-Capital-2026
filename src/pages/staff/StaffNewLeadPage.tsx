import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Field, card, errorText, primaryButton, selectClass, textareaClass } from "@/components/staff/StaffShell";
import { useIntakeLookups, useRegisterIntake, type RegisterIntakeResult } from "@/hooks/useStaffDesk";

type Channel = "direct_agent" | "team" | "referral_partner";

const blank = {
  businessName: "", contactName: "", contactCell: "", contactEmail: "", cipc: "", fundingType: "", amount: "", purpose: "",
  channel: "direct_agent" as Channel, organisationId: "", teamId: "", agentId: "", claimedAgent: "",
};

export default function StaffNewLeadPage() {
  const lookups = useIntakeLookups();
  const register = useRegisterIntake();
  const [form, setForm] = useState(blank);
  // One key per form fill: a double-click or retry returns the same file instead of a duplicate.
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [result, setResult] = useState<RegisterIntakeResult | null>(null);
  const set = <K extends keyof typeof blank>(k: K, v: (typeof blank)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const L = lookups.data;

  const agentOptions = useMemo(() => {
    if (!L) return [];
    if (form.channel === "direct_agent") return L.direct_agents;
    if (form.channel === "team") return L.members.filter((m) => m.team_id === form.teamId);
    return L.partner_agents.filter((a) => a.organisation_id === form.organisationId);
  }, [L, form.channel, form.teamId, form.organisationId]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await register.mutateAsync({
        businessName: form.businessName.trim(), contactName: form.contactName.trim(), contactCell: form.contactCell.trim(),
        contactEmail: form.contactEmail.trim(), cipc: form.cipc.trim(), fundingType: form.fundingType,
        amount: form.amount ? Number(form.amount) : null, purpose: form.purpose.trim(), channel: form.channel,
        organisationId: form.channel === "referral_partner" ? form.organisationId || null : null,
        teamId: form.channel === "team" ? form.teamId || null : null,
        agentId: form.agentId || null, claimedAgent: form.claimedAgent.trim(), idempotencyKey: key,
      });
      setResult(res);
      if (res.status === "created") { toast.success("Submission registered"); setForm(blank); setKey(crypto.randomUUID()); }
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  return (
    <>
      <div>
        <h1 className="text-2xl font-bold text-brand-navy">New lead</h1>
        <p className="text-sm text-muted-foreground">Register an enquiry. The Owner confirms who introduced it; what you select here is recorded as a claim.</p>
      </div>

      {result && result.status === "registration_conflict_flagged" ? (
        <div role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          This registration number already exists in the system. No second file was created and the Owner has been flagged to review it. Please do not tell the caller the file is registered.
        </div>
      ) : null}
      {result && result.status === "existing" ? (
        <div role="status" className="rounded-xl border border-border bg-white p-4 text-sm">
          This submission was already registered. <Link className="font-semibold text-brand-teal underline" to="/staff/documents">Open the Document tracker</Link>.
        </div>
      ) : null}
      {result && result.status === "created" ? (
        <div role="status" className="rounded-xl border border-green-300 bg-green-50 p-4 text-sm text-green-900">
          Registered. {Array.isArray(result.flags) && result.flags.length ? "A possible duplicate was found and the Owner will review it. " : ""}
          <Link className="font-semibold underline" to="/staff/documents">Go to the Document tracker</Link>.
        </div>
      ) : null}

      <form onSubmit={submit} className={`${card} grid gap-4 md:grid-cols-2`}>
        <Field label="Business name"><Input required maxLength={160} value={form.businessName} onChange={(e) => set("businessName", e.target.value)} /></Field>
        <Field label="Registration number (CIPC)"><Input maxLength={40} value={form.cipc} onChange={(e) => set("cipc", e.target.value)} placeholder="2020/123456/07" /></Field>
        <Field label="Contact person"><Input required maxLength={120} value={form.contactName} onChange={(e) => set("contactName", e.target.value)} /></Field>
        <Field label="Contact cell"><Input inputMode="tel" maxLength={30} value={form.contactCell} onChange={(e) => set("contactCell", e.target.value)} /></Field>
        <Field label="Contact email"><Input type="email" maxLength={160} value={form.contactEmail} onChange={(e) => set("contactEmail", e.target.value)} /></Field>
        <Field label="Funding type">
          <select required className={selectClass} value={form.fundingType} onChange={(e) => set("fundingType", e.target.value)}>
            <option value="">Choose...</option>
            {(L?.funding_types ?? []).map((f) => <option key={f.code} value={f.code}>{f.label}</option>)}
          </select>
        </Field>
        <Field label="Amount requested (R)"><Input type="number" min={0} step="0.01" value={form.amount} onChange={(e) => set("amount", e.target.value)} /></Field>
        <Field label="Purpose"><Input maxLength={300} value={form.purpose} onChange={(e) => set("purpose", e.target.value)} /></Field>

        <div className="md:col-span-2 border-t border-border pt-4"><h2 className="text-base font-bold text-brand-navy">Who introduced this?</h2></div>
        <Field label="Channel">
          <select className={selectClass} value={form.channel} onChange={(e) => setForm((f) => ({ ...f, channel: e.target.value as Channel, organisationId: "", teamId: "", agentId: "" }))}>
            <option value="direct_agent">Direct agent (independent)</option>
            <option value="team">Team (through a Team Leader)</option>
            <option value="referral_partner">Referral partner organisation</option>
          </select>
        </Field>
        {form.channel === "team" ? (
          <Field label="Team">
            <select required className={selectClass} value={form.teamId} onChange={(e) => setForm((f) => ({ ...f, teamId: e.target.value, agentId: "" }))}>
              <option value="">Choose...</option>
              {(L?.teams ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
        ) : null}
        {form.channel === "referral_partner" ? (
          <Field label="Organisation">
            <select required className={selectClass} value={form.organisationId} onChange={(e) => setForm((f) => ({ ...f, organisationId: e.target.value, agentId: "" }))}>
              <option value="">Choose...</option>
              {(L?.organisations ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </Field>
        ) : null}
        <Field label="Agent" hint={form.channel === "referral_partner" ? "Leave blank if the organisation introduced it directly." : undefined}>
          <select required={form.channel !== "referral_partner"} className={selectClass} value={form.agentId} onChange={(e) => set("agentId", e.target.value)}>
            <option value="">Choose...</option>
            {agentOptions.map((a) => <option key={a.profile_id} value={a.profile_id}>{a.name}</option>)}
          </select>
        </Field>
        <div className="md:col-span-2">
          <Field label="What the caller said about who referred them (optional)">
            <textarea maxLength={300} className={textareaClass} value={form.claimedAgent} onChange={(e) => set("claimedAgent", e.target.value)} />
          </Field>
        </div>
        <div className="md:col-span-2">
          <button type="submit" disabled={register.isPending || lookups.isLoading} className={primaryButton}>
            {register.isPending ? "Registering..." : "Register submission"}
          </button>
        </div>
      </form>
    </>
  );
}
