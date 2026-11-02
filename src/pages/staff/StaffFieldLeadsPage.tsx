import { useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Field, SAFE_TEXT_NOTE, card, errorText, primaryButton, selectClass } from "@/components/staff/StaffShell";
import { useSession } from "@/lib/useSession";
import { isFieldRole, isStaffManager, useIntakeLookups, useStaffRole, type StaffRole } from "@/hooks/useStaffDesk";
import {
  FIELD_LEAD_STATUS_LABEL, LEAD_FEE_STATUS_LABEL, rand, useCaptureFieldLead, useConvertFieldLead, useDecideLeadFee,
  useFieldLeadAssignees, useFieldLeads, useLeadFees, useMoveFieldLead, type FieldLead, type FieldLeadStatus, type LeadFee,
} from "@/hooks/useFieldLeads";

const fmt = (iso: string) => new Date(iso).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg", dateStyle: "medium", timeStyle: "short" });
const ROLE_LABEL: Record<string, string> = {
  field_consultant: "Field consultant", field_supervisor: "Field Supervisor", coordinator: "Sales Coordinator", administrator: "Administrator",
};
const blank = { businessName: "", contactName: "", contactCell: "", contactEmail: "", cipc: "", area: "", note: "" };

// The buttons mirror what the database allows (staff_move_field_lead); the database is what enforces it.
function nextSteps(l: FieldLead, role: StaffRole | null | undefined, uid: string | undefined): FieldLeadStatus[] {
  const mgr = isStaffManager(role);
  const mine = l.assigned_to === uid || role === "field_supervisor" || role === "owner";
  const steps: FieldLeadStatus[] = [];
  if (mgr && ["captured", "new_leads", "assigned", "contacted"].includes(l.status)) steps.push("assigned");
  if (mgr && l.status === "captured") steps.push("new_leads");
  if (mine && l.status === "assigned") steps.push("contacted");
  if (mine && l.status === "contacted") steps.push("ready_for_sale");
  if ((mgr || mine) && !["converted", "dropped"].includes(l.status)) steps.push("dropped");
  return steps;
}
const STEP_LABEL: Partial<Record<FieldLeadStatus, string>> = {
  assigned: "Give to", new_leads: "Nobody owns it: New Leads", contacted: "Client contacted", ready_for_sale: "Ready for sale", dropped: "Drop",
};

function CaptureForm() {
  const capture = useCaptureFieldLead();
  const [form, setForm] = useState(blank);
  // One key per form fill: a double tap or a retry on a poor signal returns the same lead instead of a duplicate.
  const [key, setKey] = useState(() => crypto.randomUUID());
  const set = (k: keyof typeof blank, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    capture.mutate({ ...Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v.trim()])) as typeof blank, idempotencyKey: key }, {
      onSuccess: (r) => {
        if (r.status === "already_registered") {
          toast.error("This business is already registered with FNC. It was not captured again.");
          return;
        }
        toast.success(r.possible_duplicate ? "Captured. A similar lead exists; the Sales Coordinator will check it." : "Lead captured");
        setForm(blank);
        setKey(crypto.randomUUID());
      },
      onError: (err) => toast.error(errorText(err)),
    });
  };
  return (
    <form onSubmit={submit} className={`${card} grid gap-4 md:grid-cols-2`}>
      <h2 className="text-base font-bold text-brand-navy md:col-span-2">Capture a lead</h2>
      <Field label="Business name"><Input required maxLength={160} value={form.businessName} onChange={(e) => set("businessName", e.target.value)} /></Field>
      <Field label="Contact person"><Input required maxLength={120} value={form.contactName} onChange={(e) => set("contactName", e.target.value)} /></Field>
      <Field label="Cell number"><Input inputMode="tel" maxLength={30} value={form.contactCell} onChange={(e) => set("contactCell", e.target.value)} /></Field>
      <Field label="Email (if no cell)"><Input type="email" maxLength={160} value={form.contactEmail} onChange={(e) => set("contactEmail", e.target.value)} /></Field>
      <Field label="Registration number (CIPC), if they have one"><Input maxLength={40} value={form.cipc} onChange={(e) => set("cipc", e.target.value)} placeholder="2020/123456/07" /></Field>
      <Field label="Area"><Input maxLength={120} value={form.area} onChange={(e) => set("area", e.target.value)} placeholder="e.g. Soweto, Vilakazi Street" /></Field>
      <div className="md:col-span-2">
        <Field label="Note (optional)" hint={SAFE_TEXT_NOTE}><Input maxLength={500} value={form.note} onChange={(e) => set("note", e.target.value)} /></Field>
      </div>
      <div className="md:col-span-2"><button type="submit" className={`${primaryButton} w-full sm:w-auto`} disabled={capture.isPending}>Capture lead</button></div>
    </form>
  );
}

function LeadRow({ l, role, uid }: { l: FieldLead; role: StaffRole | null | undefined; uid: string | undefined }) {
  const steps = nextSteps(l, role, uid);
  const mgr = isStaffManager(role);
  const move = useMoveFieldLead();
  const convert = useConvertFieldLead();
  const assignees = useFieldLeadAssignees(steps.includes("assigned"));
  const lookups = useIntakeLookups(mgr && l.status === "ready_for_sale");
  const [note, setNote] = useState("");
  const [person, setPerson] = useState("");
  const [fundingType, setFundingType] = useState("");
  const [amount, setAmount] = useState("");
  const go = (to: FieldLeadStatus) => {
    if (to === "assigned" && !person) { toast.error("Choose who the lead is for."); return; }
    if (to === "dropped" && note.trim().length < 5) { toast.error("Give the reason in the note."); return; }
    move.mutate({ leadId: l.lead_id, to, note: note.trim(), assignedTo: to === "assigned" ? person : null }, {
      onSuccess: () => { toast.success(FIELD_LEAD_STATUS_LABEL[to]); setNote(""); setPerson(""); },
      onError: (e) => toast.error(errorText(e)),
    });
  };
  const open = () => {
    if (!fundingType) { toast.error("Choose the funding type."); return; }
    convert.mutate({ leadId: l.lead_id, fundingType, amount: amount ? Number(amount) : null, note: note.trim() }, {
      onSuccess: () => { toast.success("Client file opened. It is in the Document tracker."); setNote(""); },
      onError: (e) => toast.error(errorText(e)),
    });
  };
  return (
    <li className="space-y-2 py-3 text-sm">
      <p className="font-semibold text-brand-navy">
        {l.business_name}
        <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-normal">{FIELD_LEAD_STATUS_LABEL[l.status]}</span>
        {l.assigned_name ? <span className="ml-2 text-xs font-normal text-muted-foreground">· with {l.assigned_name}</span> : null}
      </p>
      <p className="text-xs text-muted-foreground">
        {l.contact_name}{l.contact_cell ? ` · ${l.contact_cell}` : ""}{l.contact_email ? ` · ${l.contact_email}` : ""}{l.area ? ` · ${l.area}` : ""}
        {" · captured by "}{l.captured_by_name ?? "?"} ({ROLE_LABEL[l.captured_role] ?? l.captured_role})
      </p>
      {l.drop_reason ? <p className="text-xs text-red-700">Dropped: {l.drop_reason}</p> : null}
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">History</summary>
        <ol className="mt-1 space-y-0.5 border-l-2 border-slate-200 pl-3">
          {l.history.map((h, i) => (
            <li key={i}>{fmt(h.at)} · {h.who ?? "?"} ({ROLE_LABEL[h.role] ?? h.role}): {FIELD_LEAD_STATUS_LABEL[h.to]}{h.note ? ` — ${h.note}` : ""}</li>
          ))}
        </ol>
      </details>
      {steps.length || (mgr && l.status === "ready_for_sale") ? (
        <div className="flex flex-wrap items-center gap-2">
          <Input className="max-w-xs" maxLength={500} aria-label="Note" placeholder={steps.includes("dropped") ? "Note (a reason is required to drop)" : "Note (optional)"} value={note} onChange={(e) => setNote(e.target.value)} />
          {steps.includes("assigned") ? (
            <select className={`${selectClass} max-w-xs`} aria-label="Give the lead to" value={person} onChange={(e) => setPerson(e.target.value)}>
              <option value="">Give to...</option>
              {(assignees.data ?? []).map((m) => <option key={m.profile_id} value={m.profile_id}>{m.full_name} ({ROLE_LABEL[m.staff_role] ?? m.staff_role})</option>)}
            </select>
          ) : null}
          {steps.map((s) => (
            <button key={s} type="button" disabled={move.isPending} onClick={() => go(s)}
              className={`text-xs font-semibold underline ${s === "dropped" ? "text-red-700" : "text-brand-teal"}`}>{STEP_LABEL[s]}</button>
          ))}
        </div>
      ) : null}
      {mgr && l.status === "ready_for_sale" ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 p-2">
          <select className={`${selectClass} max-w-xs`} aria-label="Funding type" value={fundingType} onChange={(e) => setFundingType(e.target.value)}>
            <option value="">Funding type...</option>
            {(lookups.data?.funding_types ?? []).map((f) => <option key={f.code} value={f.code}>{f.label}</option>)}
          </select>
          <Input className="max-w-[10rem]" type="number" min={0} step="0.01" aria-label="Amount requested (R)" placeholder="Amount (R)" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <button type="button" className="text-xs font-semibold text-brand-teal underline" disabled={convert.isPending} onClick={open}>Open the client file</button>
        </div>
      ) : null}
    </li>
  );
}

function LeadFeesPanel({ role }: { role: StaffRole | null | undefined }) {
  // The Sales Coordinator confirms pending fees; the Administrator approves confirmed ones; the Director may do either.
  const fees = useLeadFees(null, true);
  const decide = useDecideLeadFee();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const act = (f: LeadFee, decision: "confirm" | "approve" | "reject") => {
    const note = (notes[f.id] ?? "").trim();
    if (decision === "reject" && note.length < 5) { toast.error("Give the reason in the note."); return; }
    decide.mutate({ feeId: f.id, decision, note }, {
      onSuccess: (s) => { toast.success(`Lead fee ${s}`); setNotes((n) => ({ ...n, [f.id]: "" })); },
      onError: (e) => toast.error(errorText(e)),
    });
  };
  const canConfirm = role === "coordinator" || role === "owner";
  const canApprove = role === "administrator" || role === "owner";
  const open = (fees.data ?? []).filter((f) => f.status === "pending" || f.status === "confirmed");
  return (
    <section className={card}>
      <h2 className="mb-1 text-base font-bold text-brand-navy">Lead fees</h2>
      <p className="mb-3 text-xs text-muted-foreground">R150 to the field consultant and R100 to the Field Supervisor when a lead is ready for sale. The Sales Coordinator confirms, the Administrator approves; approved fees are paid with the payroll one month later.</p>
      {fees.error ? <p role="alert" className="text-sm text-red-600">{errorText(fees.error)}</p> : null}
      <ul className="divide-y divide-border">
        {open.map((f) => {
          const mayAct = (f.status === "pending" && (canConfirm || canApprove)) || (f.status === "confirmed" && canApprove);
          return (
            <li key={f.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
              <span className="font-semibold text-brand-navy">{rand(f.amount)}</span>
              <span>{f.beneficiary_name} · {f.business_name}</span>
              <span className="text-xs text-muted-foreground">{LEAD_FEE_STATUS_LABEL[f.status]}</span>
              {mayAct ? (
                <>
                  <Input className="max-w-[14rem]" maxLength={500} aria-label="Note" placeholder="Note (required to reject)" value={notes[f.id] ?? ""} onChange={(e) => setNotes((n) => ({ ...n, [f.id]: e.target.value }))} />
                  {f.status === "pending" && canConfirm ? <button type="button" className="text-xs font-semibold text-brand-teal underline" disabled={decide.isPending} onClick={() => act(f, "confirm")}>Confirm</button> : null}
                  {f.status === "confirmed" && canApprove ? <button type="button" className="text-xs font-semibold text-brand-teal underline" disabled={decide.isPending} onClick={() => act(f, "approve")}>Approve</button> : null}
                  <button type="button" className="text-xs font-semibold text-red-700 underline" disabled={decide.isPending} onClick={() => act(f, "reject")}>Reject</button>
                </>
              ) : null}
            </li>
          );
        })}
        {fees.data && open.length === 0 ? <li className="py-2 text-sm text-muted-foreground">No lead fees waiting.</li> : null}
      </ul>
    </section>
  );
}

export default function StaffFieldLeadsPage() {
  const { data: role } = useStaffRole();
  const session = useSession();
  const uid = session?.user.id;
  const [openOnly, setOpenOnly] = useState(true);
  const allowed = isFieldRole(role) || isStaffManager(role);
  const leads = useFieldLeads(openOnly, allowed);
  if (role && !allowed) return <p className="text-sm text-muted-foreground">Field leads are for the field team and the Sales Coordinator.</p>;
  return (
    <>
      <div>
        <h1 className="text-2xl font-bold text-brand-navy">Field leads</h1>
        <p className="text-sm text-muted-foreground">
          Captured → Assigned (or New Leads) → Contacted → Ready for sale → Client file. The Sales Coordinator gives each lead to its owner and opens the client file.
        </p>
      </div>
      {isFieldRole(role) ? <CaptureForm /> : null}
      <section className={card}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-bold text-brand-navy">{role === "field_consultant" ? "My leads" : "Field leads"}</h2>
          <button type="button" className="text-sm font-semibold text-brand-teal underline" onClick={() => setOpenOnly(!openOnly)}>
            Show {openOnly ? "all" : "only open"}
          </button>
        </div>
        {leads.error ? <p role="alert" className="text-sm text-red-600">{errorText(leads.error)}</p> : null}
        <ul className="divide-y divide-border">
          {(leads.data ?? []).map((l) => <LeadRow key={l.lead_id} l={l} role={role} uid={uid} />)}
          {leads.data && leads.data.length === 0 ? <li className="py-3 text-sm text-muted-foreground">No leads here yet.</li> : null}
        </ul>
      </section>
      {isStaffManager(role) ? <LeadFeesPanel role={role} /> : null}
    </>
  );
}
