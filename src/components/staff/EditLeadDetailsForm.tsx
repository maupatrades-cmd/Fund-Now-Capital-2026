import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { errorText, Field, primaryButton, selectClass } from "@/components/staff/StaffShell";
import { useCorrectIntakeDetails, useIntakeDetail, useIntakeLookups, type IntakeDetail } from "@/hooks/useStaffDesk";

const link = "text-xs font-semibold underline disabled:opacity-50";
const changed = (now: string, was: string | null | undefined) => (now.trim() !== (was ?? "").trim() ? now.trim() : null);

// Correct a capture mistake on a submission (owner, 19 Nov 2026): the person who captured it, the Sales Coordinator, the
// Office Administrator and the Director. Only changed fields are sent; the server refuses once the lead is a client and
// audits every change with what it was before. Who the sale is for stays with the Director.
function Form({ d, onDone }: { d: IntakeDetail; onDone: () => void }) {
  const lookups = useIntakeLookups();
  const save = useCorrectIntakeDetails();
  const [biz, setBiz] = useState(d.business_name ?? "");
  const [contact, setContact] = useState(d.contact_name ?? "");
  const [cell, setCell] = useState(d.contact_cell ?? "");
  const [email, setEmail] = useState(d.contact_email ?? "");
  const [cipc, setCipc] = useState(d.cipc_number ?? "");
  const [amount, setAmount] = useState(d.requested_amount != null ? String(d.requested_amount) : "");
  const purposeWas = Array.isArray(d.funding_purpose) ? d.funding_purpose.join(", ") : "";
  const [purpose, setPurpose] = useState(purposeWas);
  const [ftype, setFtype] = useState(d.funding_type ?? "");
  const [reason, setReason] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const amountWas = d.requested_amount != null ? String(d.requested_amount) : "";
    save.mutate({
      leadId: d.lead_id,
      businessName: changed(biz, d.business_name), contactName: changed(contact, d.contact_name),
      contactCell: changed(cell, d.contact_cell), contactEmail: changed(email, d.contact_email), cipc: changed(cipc, d.cipc_number),
      amount: amount.trim() !== amountWas && amount.trim() !== "" ? Number(amount) : null,
      purpose: changed(purpose, purposeWas), fundingType: ftype && ftype !== d.funding_type ? ftype : null,
      reason: reason.trim(),
    }, {
      onSuccess: () => { toast.success("Lead details corrected"); onDone(); },
      onError: (err) => toast.error(errorText(err)),
    });
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Business name"><Input value={biz} onChange={(e) => setBiz(e.target.value)} maxLength={160} /></Field>
        <Field label="Registration number (CIPC)"><Input value={cipc} onChange={(e) => setCipc(e.target.value)} maxLength={40} /></Field>
        <Field label="Contact person"><Input value={contact} onChange={(e) => setContact(e.target.value)} maxLength={120} /></Field>
        <Field label="Contact cell"><Input inputMode="tel" value={cell} onChange={(e) => setCell(e.target.value)} maxLength={30} /></Field>
        <Field label="Contact email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={160} /></Field>
        <Field label="Funding type">
          <select className={selectClass} value={ftype} onChange={(e) => setFtype(e.target.value)}>
            {(lookups.data?.funding_types ?? []).map((f) => <option key={f.code} value={f.code}>{f.label}</option>)}
          </select>
        </Field>
        <Field label="Amount requested (R)"><Input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="Purpose"><Input value={purpose} onChange={(e) => setPurpose(e.target.value)} maxLength={300} /></Field>
      </div>
      <Field label="What was wrong?">
        <Input required minLength={5} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Business name spelt wrong" />
      </Field>
      <p className="text-xs text-muted-foreground">To change who the sale is for, ask the Director.</p>
      <button type="submit" className={primaryButton} disabled={save.isPending || reason.trim().length < 5}>Save corrections</button>
    </form>
  );
}

export function EditLeadDetailsForm({ leadId }: { leadId: string }) {
  const [open, setOpen] = useState(false);
  const detail = useIntakeDetail(leadId, open);
  if (!open) return <button type="button" className={`${link} text-brand-teal`} onClick={() => setOpen(true)}>Edit details</button>;
  return (
    <div className="mt-2 space-y-3 rounded-lg border border-border p-3 text-sm">
      <button type="button" className={`${link} text-muted-foreground`} onClick={() => setOpen(false)}>Close</button>
      {detail.error ? <p role="alert" className="text-xs text-red-600">{errorText(detail.error)}</p> : null}
      {detail.isPending ? <p className="text-xs text-muted-foreground">Loading…</p> : null}
      {detail.data ? <Form key={detail.dataUpdatedAt} d={detail.data} onDone={() => setOpen(false)} /> : null}
    </div>
  );
}
