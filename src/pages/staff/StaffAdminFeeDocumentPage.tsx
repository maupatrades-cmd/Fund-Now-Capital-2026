import { Link, useParams } from "react-router-dom";
import { errorText } from "@/components/staff/StaffShell";
import { INVOICE_STATUS, rands, useAdminFeeDocument } from "@/hooks/useAdminFees";

// One admin-fee invoice, printable (the staff menu is hidden when printing). Once the invoice is fully paid it also
// shows the receipt. Company and bank details come from the Director's invoice details; nothing is filled in here.
const day = (iso: string) => new Date(iso.length > 10 ? iso : `${iso}T12:00:00`).toLocaleDateString("en-ZA", { timeZone: "Africa/Johannesburg", dateStyle: "long" });

export default function StaffAdminFeeDocumentPage() {
  const { invoiceId } = useParams();
  const q = useAdminFeeDocument(invoiceId);
  if (q.error) return <p role="alert" className="text-sm text-red-600">{errorText(q.error)}</p>;
  if (!q.data) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const { invoice: i, receipt, payments, settings: s } = q.data;
  const missingBank = !s.bank_name || !s.account_number || !s.branch_code;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <Link to="/staff/admin-fees" className="text-sm font-semibold text-brand-teal underline">Back to admin fees</Link>
        <button type="button" onClick={() => window.print()} className="rounded-lg bg-brand-teal px-4 py-2 text-sm font-semibold text-white">Print or save as PDF</button>
        {missingBank ? <p className="text-sm text-amber-800">The Director has not entered the bank details yet (Admin fees → Invoice details).</p> : null}
      </div>
      <article className="mx-auto max-w-3xl space-y-6 rounded-2xl border border-border bg-white p-8 text-sm text-brand-navy shadow-sm print:border-0 print:shadow-none">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-4">
          <div>
            <img src="/brand-mark.png" alt="" className="mb-2 h-10 w-10 object-contain" />
            <p className="text-lg font-bold">{s.legal_name ?? "Fund Now Capital"}</p>
            {s.registration_number ? <p className="text-xs text-muted-foreground">Registration {s.registration_number}</p> : null}
            {s.address ? <p className="whitespace-pre-line text-xs text-muted-foreground">{s.address}</p> : null}
            <p className="text-xs text-muted-foreground">{[s.contact_email, s.contact_phone].filter(Boolean).join(" · ")}</p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold">{receipt ? "Invoice and receipt" : "Invoice"}</p>
            <p className="font-semibold">{i.invoice_number}</p>
            <p className="text-xs">Issued {day(i.issued_at)}</p>
            <p className="text-xs">Due {day(i.due_on)}</p>
            <p className="mt-1 inline-block rounded-full bg-slate-100 px-3 py-0.5 text-xs font-semibold">{INVOICE_STATUS[i.status]}</p>
          </div>
        </header>
        <section>
          <p className="text-xs uppercase text-muted-foreground">Invoice to</p>
          <p className="font-semibold">{i.billed_to}</p>
          {i.billed_email ? <p className="text-xs">{i.billed_email}</p> : null}
        </section>
        <table className="w-full text-left">
          <thead><tr className="border-b border-border text-xs uppercase text-muted-foreground"><th className="py-2">Description</th><th className="py-2 text-right">Amount</th></tr></thead>
          <tbody>
            <tr className="border-b border-border"><td className="py-3">{i.description}</td><td className="py-3 text-right">{rands(i.amount)}</td></tr>
            <tr><td className="py-2 text-right font-semibold">Total</td><td className="py-2 text-right font-bold">{rands(i.amount)}</td></tr>
            {Number(i.paid) > 0 ? <tr><td className="py-1 text-right">Paid</td><td className="py-1 text-right">{rands(i.paid)}</td></tr> : null}
            {Number(i.paid) > 0 ? <tr><td className="py-1 text-right font-semibold">Balance</td><td className="py-1 text-right font-semibold">{rands(i.balance)}</td></tr> : null}
          </tbody>
        </table>
        {i.status !== "paid" && i.status !== "void" ? (
          <section className="space-y-1 rounded-xl bg-slate-50 p-4">
            <p className="font-semibold">How to pay</p>
            {!missingBank ? (
              <p className="text-xs">EFT to {s.account_holder ?? s.legal_name ?? ""} · {s.bank_name} · account {s.account_number} · branch {s.branch_code}. Use <strong>{i.invoice_number}</strong> as the reference.</p>
            ) : <p className="text-xs">Bank details to follow.</p>}
            {s.yoco_link ? <p className="text-xs">Card: {s.yoco_link}</p> : null}
            {s.payment_note ? <p className="text-xs">{s.payment_note}</p> : null}
          </section>
        ) : null}
        {receipt ? (
          <section className="space-y-2 border-t border-border pt-4">
            <p className="text-base font-bold">Receipt {receipt.receipt_number}</p>
            <p className="text-xs">Received with thanks on {day(receipt.issued_at)}:</p>
            <ul className="text-xs">
              {payments.map((p, n) => <li key={n}>{day(p.received_on)} · {p.method === "yoco" ? "Card (Yoco)" : "EFT"} · ref {p.reference} · {rands(p.amount)}</li>)}
            </ul>
          </section>
        ) : null}
        {i.void_reason ? <p className="text-xs text-red-700">This invoice is void: {i.void_reason}</p> : null}
        <footer className="border-t border-border pt-3 text-center text-xs text-muted-foreground">Many funders. More approvals.</footer>
      </article>
    </div>
  );
}
