import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Field, SAFE_TEXT_NOTE, card, errorText, primaryButton, selectClass } from "@/components/staff/StaffShell";
import { canDecideTimeRequests, useIntakeQueue, useStaffRole } from "@/hooks/useStaffDesk";
import {
  INVOICE_STATUS, rands, useAdminFeeDays, useAdminFeeInvoices, useAdminFeePayments, useAdminFeeSettings, useExcludePayment,
  useIssueInvoice, useMatchPayment, useReconcileDay, useRecordPayment, useSaveAdminFeeSettings, useUnmatchPayment,
  useVoidInvoice, type AdminFeeInvoice, type AdminFeePayment, type AdminFeeSettings,
} from "@/hooks/useAdminFees";

// Admin fees (owner spec §10, §12), for the Administrator and the Director: issue admin-fee invoices on a client
// file, capture Yoco (card) and EFT payments from the statements, match them to invoices (a receipt is issued once an
// invoice is fully paid), and reconcile each day. The invoice details (company and bank) are entered by the Director.
const sastToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });
const plusDays = (n: number) => { const d = new Date(`${sastToday()}T12:00:00`); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const day = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString("en-ZA", { dateStyle: "medium" });
const pill = (s: string) => s === "paid" || s === "matched" ? "bg-green-100 text-green-800" : s === "void" || s === "set_aside" ? "bg-slate-100 text-slate-600"
  : s === "part_paid" ? "bg-teal-50 text-brand-navy" : "bg-amber-100 text-amber-900";
type Tab = "invoices" | "payments" | "days" | "details";
const TABS: [Tab, string][] = [["invoices", "Invoices"], ["payments", "Payments"], ["days", "Daily reconciliation"], ["details", "Invoice details"]];

function IssueInvoice() {
  const files = useIntakeQueue(null, false);
  const issue = useIssueInvoice();
  const empty = { leadId: "", billedTo: "", billedEmail: "", description: "Admin fee", amount: "", dueOn: plusDays(7) };
  const [f, setF] = useState(empty);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const amountOk = /^\d{1,6}(\.\d{1,2})?$/.test(f.amount) && Number(f.amount) > 0;
  return (
    <form className={`${card} space-y-3`} onSubmit={(e) => {
      e.preventDefault();
      issue.mutate({ ...f, key }, {
        onSuccess: () => { toast.success("Invoice issued"); setF(empty); setKey(crypto.randomUUID()); },
        onError: (x) => toast.error(errorText(x)),
      });
    }}>
      <h2 className="text-base font-bold text-brand-navy">Issue an admin-fee invoice</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Client file">
          <select className={selectClass} value={f.leadId} onChange={(e) => {
            const row = (files.data ?? []).find((r) => r.lead_id === e.target.value);
            setF({ ...f, leadId: e.target.value, billedTo: row?.business_name ?? f.billedTo, billedEmail: row?.contact_email ?? f.billedEmail });
          }}>
            <option value="">Choose…</option>
            {(files.data ?? []).map((r) => <option key={r.lead_id} value={r.lead_id}>{r.business_name}</option>)}
          </select>
        </Field>
        <Field label="Amount (R)" hint="The admin fee for this file. No VAT is added.">
          <Input inputMode="decimal" placeholder="1500.00" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.trim() })} />
        </Field>
        <Field label="Invoice to"><Input maxLength={160} value={f.billedTo} onChange={(e) => setF({ ...f, billedTo: e.target.value })} /></Field>
        <Field label="Client email (optional)"><Input type="email" maxLength={254} value={f.billedEmail} onChange={(e) => setF({ ...f, billedEmail: e.target.value })} /></Field>
        <Field label="Description" hint={SAFE_TEXT_NOTE}><Input maxLength={300} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <Field label="Due on"><Input type="date" min={sastToday()} value={f.dueOn} onChange={(e) => setF({ ...f, dueOn: e.target.value })} /></Field>
      </div>
      <button type="submit" className={primaryButton} disabled={!f.leadId || !amountOk || f.billedTo.trim().length < 2 || f.description.trim().length < 3 || issue.isPending}>
        Issue invoice
      </button>
    </form>
  );
}

function InvoiceRow({ i }: { i: AdminFeeInvoice }) {
  const voidIt = useVoidInvoice();
  const [reason, setReason] = useState("");
  const [voiding, setVoiding] = useState(false);
  return (
    <li className="space-y-1 py-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-brand-navy">{i.invoice_number} · {i.business_name}</p>
          <p className="text-muted-foreground">{i.description} · {rands(i.amount)} · due {day(i.due_on)}{i.overdue ? " (overdue)" : ""}</p>
          {i.status === "part_paid" ? <p className="text-xs">Paid {rands(i.paid)} · balance {rands(i.balance)}</p> : null}
          {i.receipt_number ? <p className="text-xs text-green-700">Receipt {i.receipt_number}</p> : null}
          {i.void_reason ? <p className="text-xs text-muted-foreground">Void: {i.void_reason}</p> : null}
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${pill(i.status)}`}>{INVOICE_STATUS[i.status]}</span>
      </div>
      <div className="flex flex-wrap gap-3 text-xs">
        <Link className="font-semibold text-brand-teal underline" to={`/staff/admin-fees/${i.invoice_id}`}>{i.receipt_number ? "Invoice and receipt" : "Open invoice"}</Link>
        {i.status === "unpaid" ? <button type="button" className="text-red-700 underline" onClick={() => setVoiding(!voiding)}>Void</button> : null}
      </div>
      {voiding ? (
        <div className="flex flex-wrap gap-2">
          <Input className="max-w-sm" maxLength={500} aria-label="Reason for voiding" placeholder="Reason for voiding" value={reason} onChange={(e) => setReason(e.target.value)} />
          <button type="button" className={primaryButton} disabled={reason.trim().length < 5 || voidIt.isPending}
            onClick={() => voidIt.mutate({ invoiceId: i.invoice_id, reason }, { onSuccess: () => { toast.success("Invoice voided"); setVoiding(false); }, onError: (x) => toast.error(errorText(x)) })}>
            Void invoice
          </button>
        </div>
      ) : null}
    </li>
  );
}

function InvoicesTab() {
  const [openOnly, setOpenOnly] = useState(false);
  const list = useAdminFeeInvoices(openOnly);
  return (
    <div className="space-y-5">
      <IssueInvoice />
      <section className={`${card} space-y-3`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-bold text-brand-navy">Invoices</h2>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} />Unpaid only</label>
        </div>
        {list.error ? <p role="alert" className="text-sm text-red-600">{errorText(list.error)}</p> : null}
        <ul className="divide-y divide-border">
          {(list.data ?? []).map((i) => <InvoiceRow key={i.invoice_id} i={i} />)}
          {list.data && list.data.length === 0 ? <li className="py-3 text-sm text-muted-foreground">No invoices.</li> : null}
        </ul>
      </section>
    </div>
  );
}

function RecordPayment() {
  const rec = useRecordPayment();
  const empty = { method: "yoco" as "yoco" | "eft", amount: "", receivedOn: sastToday(), reference: "", payer: "" };
  const [f, setF] = useState(empty);
  const amountOk = /^\d{1,6}(\.\d{1,2})?$/.test(f.amount) && Number(f.amount) > 0;
  return (
    <form className={`${card} space-y-3`} onSubmit={(e) => {
      e.preventDefault();
      rec.mutate(f, { onSuccess: () => { toast.success("Payment captured"); setF({ ...empty, method: f.method, receivedOn: f.receivedOn }); }, onError: (x) => toast.error(errorText(x)) });
    }}>
      <div>
        <h2 className="text-base font-bold text-brand-navy">Capture a payment</h2>
        <p className="text-sm text-muted-foreground">From the Yoco report or the bank statement. Each reference can be captured once.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Paid by">
          <select className={selectClass} value={f.method} onChange={(e) => setF({ ...f, method: e.target.value as "yoco" | "eft" })}>
            <option value="yoco">Yoco (card)</option>
            <option value="eft">EFT</option>
          </select>
        </Field>
        <Field label="Amount (R)"><Input inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.trim() })} /></Field>
        <Field label="Date received"><Input type="date" max={sastToday()} value={f.receivedOn} onChange={(e) => setF({ ...f, receivedOn: e.target.value })} /></Field>
        <Field label={f.method === "yoco" ? "Yoco transaction ID" : "EFT reference"}><Input maxLength={100} value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
        <Field label="Payer (optional)"><Input maxLength={160} value={f.payer} onChange={(e) => setF({ ...f, payer: e.target.value })} /></Field>
      </div>
      <button type="submit" className={primaryButton} disabled={!amountOk || f.reference.trim().length < 3 || rec.isPending}>Capture payment</button>
    </form>
  );
}

function PaymentRow({ p, open }: { p: AdminFeePayment; open: AdminFeeInvoice[] }) {
  const match = useMatchPayment();
  const unmatch = useUnmatchPayment();
  const exclude = useExcludePayment();
  const [pick, setPick] = useState(p.suggested_invoice_id ?? "");
  const [reason, setReason] = useState("");
  const done = (msg: string) => ({ onSuccess: () => { toast.success(msg); setReason(""); }, onError: (x: unknown) => toast.error(errorText(x)) });
  return (
    <li className="space-y-2 py-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-brand-navy">{rands(p.amount)} · {p.method === "yoco" ? "Yoco" : "EFT"} · {day(p.received_on)}</p>
          <p className="text-muted-foreground">Ref {p.reference}{p.payer ? ` · ${p.payer}` : ""}</p>
          {p.invoice_number ? <p className="text-xs">Paid against {p.invoice_number} · {p.business_name}</p> : null}
          {p.exclude_reason ? <p className="text-xs text-muted-foreground">Set aside: {p.exclude_reason}</p> : null}
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${pill(p.status)}`}>
          {p.status === "matched" ? "Matched" : p.status === "set_aside" ? "Set aside" : "Not matched"}
        </span>
      </div>
      {p.status === "unmatched" ? (
        <div className="flex flex-wrap items-center gap-2">
          <select className={`${selectClass} max-w-xs`} aria-label="Invoice" value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">Choose the invoice…</option>
            {open.map((i) => <option key={i.invoice_id} value={i.invoice_id}>{i.invoice_number} · {i.business_name} · balance {rands(i.balance)}{i.invoice_id === p.suggested_invoice_id ? " (suggested)" : ""}</option>)}
          </select>
          <button type="button" className={primaryButton} disabled={!pick || match.isPending}
            onClick={() => match.mutate({ paymentId: p.payment_id, invoiceId: pick }, {
              onSuccess: (s) => toast.success(s === "paid" ? "Matched. The invoice is paid and a receipt was issued." : "Matched. The invoice is part paid."),
              onError: (x) => toast.error(errorText(x)),
            })}>Match</button>
          <Input className="max-w-xs" maxLength={500} aria-label="Reason" placeholder="Or: why this is not an admin fee" value={reason} onChange={(e) => setReason(e.target.value)} />
          <button type="button" className="rounded-lg border border-border px-4 py-2 text-sm font-semibold disabled:opacity-50" disabled={reason.trim().length < 5 || exclude.isPending}
            onClick={() => exclude.mutate({ paymentId: p.payment_id, reason }, done("Set aside"))}>Set aside</button>
        </div>
      ) : null}
      {p.status === "matched" && !p.day_reconciled ? (
        <div className="flex flex-wrap items-center gap-2">
          <Input className="max-w-xs" maxLength={500} aria-label="Reason" placeholder="Reason to undo the match" value={reason} onChange={(e) => setReason(e.target.value)} />
          <button type="button" className="text-xs text-red-700 underline disabled:opacity-50" disabled={reason.trim().length < 5 || unmatch.isPending}
            onClick={() => unmatch.mutate({ paymentId: p.payment_id, reason }, done("Match undone"))}>Undo match</button>
        </div>
      ) : null}
    </li>
  );
}

function PaymentsTab() {
  const [openOnly, setOpenOnly] = useState(true);
  const list = useAdminFeePayments(openOnly);
  const open = useAdminFeeInvoices(true);
  return (
    <div className="space-y-5">
      <RecordPayment />
      <section className={`${card} space-y-3`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-bold text-brand-navy">Payments</h2>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} />Not matched only</label>
        </div>
        {list.error ? <p role="alert" className="text-sm text-red-600">{errorText(list.error)}</p> : null}
        <ul className="divide-y divide-border">
          {(list.data ?? []).map((p) => <PaymentRow key={p.payment_id} p={p} open={open.data ?? []} />)}
          {list.data && list.data.length === 0 ? <li className="py-3 text-sm text-muted-foreground">{openOnly ? "Every payment is matched or set aside." : "No payments captured."}</li> : null}
        </ul>
      </section>
    </div>
  );
}

function DaysTab() {
  const days = useAdminFeeDays();
  const rec = useReconcileDay();
  const [note, setNote] = useState("");
  return (
    <section className={`${card} space-y-3`}>
      <div>
        <h2 className="text-base font-bold text-brand-navy">Daily reconciliation</h2>
        <p className="text-sm text-muted-foreground">Check the day's Yoco report and bank statement are all captured, match or set aside every payment, then reconcile the day.</p>
      </div>
      <Input maxLength={500} aria-label="Note" placeholder="Note (optional), for example: Yoco and FNB statements checked" value={note} onChange={(e) => setNote(e.target.value)} />
      {days.error ? <p role="alert" className="text-sm text-red-600">{errorText(days.error)}</p> : null}
      <ul className="divide-y divide-border">
        {(days.data ?? []).map((d) => (
          <li key={d.day} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
            <div>
              <p className="font-semibold text-brand-navy">{day(d.day)}</p>
              <p className="text-xs text-muted-foreground">
                {d.payments} payment{d.payments === 1 ? "" : "s"} · {rands(d.total_received)}{d.unmatched ? ` · ${d.unmatched} not matched` : ""}
              </p>
              {d.reconciled_at ? <p className="text-xs text-green-700">Reconciled by {d.reconciled_by ?? "?"}</p> : null}
              {d.changed_after ? <p className="text-xs text-amber-800">A payment was captured after this day was reconciled: check it.</p> : null}
            </div>
            {!d.reconciled_at ? (
              <button type="button" className={primaryButton} disabled={d.unmatched > 0 || rec.isPending}
                onClick={() => rec.mutate({ day: d.day, note }, { onSuccess: () => { toast.success("Day reconciled"); setNote(""); }, onError: (x) => toast.error(errorText(x)) })}>
                Reconcile
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

const DETAIL_FIELDS: [keyof AdminFeeSettings, string, string?][] = [
  ["legal_name", "Company name"], ["registration_number", "Registration number"], ["address", "Address"],
  ["contact_email", "Email"], ["contact_phone", "Phone"], ["bank_name", "Bank"], ["account_holder", "Account holder"],
  ["account_number", "Account number", "Digits only"], ["branch_code", "Branch code"],
  ["yoco_link", "Yoco payment link (optional)", "Starts with https://"], ["payment_note", "Note on every invoice (optional)", "For example: use the invoice number as your payment reference"],
];

function DetailsTab({ canEdit }: { canEdit: boolean }) {
  const settings = useAdminFeeSettings();
  const save = useSaveAdminFeeSettings();
  const [draft, setDraft] = useState<AdminFeeSettings | null>(null);
  const v = draft ?? settings.data ?? {};
  if (settings.error) return <p role="alert" className="text-sm text-red-600">{errorText(settings.error)}</p>;
  return (
    <form className={`${card} space-y-3`} onSubmit={(e) => {
      e.preventDefault();
      save.mutate(v, { onSuccess: () => { toast.success("Invoice details saved"); setDraft(null); }, onError: (x) => toast.error(errorText(x)) });
    }}>
      <div>
        <h2 className="text-base font-bold text-brand-navy">Invoice details</h2>
        <p className="text-sm text-muted-foreground">
          Printed on every admin-fee invoice and receipt. {canEdit ? "Only you (the Director) can change them." : "Only the Director can change these."}
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {DETAIL_FIELDS.map(([k, label, hint]) => (
          <Field key={k} label={label} hint={hint}>
            <Input value={v[k] ?? ""} readOnly={!canEdit} onChange={(e) => setDraft({ ...v, [k]: e.target.value })} />
          </Field>
        ))}
      </div>
      {canEdit ? <button type="submit" className={primaryButton} disabled={!draft || save.isPending}>Save details</button> : null}
    </form>
  );
}

export default function StaffAdminFeesPage() {
  const { data: role, isLoading } = useStaffRole();
  const [tab, setTab] = useState<Tab>("invoices");
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!canDecideTimeRequests(role)) return <p className="text-sm text-muted-foreground">Admin fees are for the Administrator and the Director.</p>;
  return (
    <div className="space-y-4">
      <div role="tablist" className="flex flex-wrap gap-2">
        {TABS.map(([t, l]) => (
          <button key={t} role="tab" type="button" aria-selected={tab === t} onClick={() => setTab(t)}
            className={`rounded-full border px-4 py-1.5 text-sm ${tab === t ? "border-brand-teal bg-teal-50 font-semibold text-brand-navy" : "border-border bg-white"}`}>{l}</button>
        ))}
      </div>
      {tab === "invoices" ? <InvoicesTab /> : tab === "payments" ? <PaymentsTab /> : tab === "days" ? <DaysTab /> : <DetailsTab canEdit={role === "owner"} />}
    </div>
  );
}
