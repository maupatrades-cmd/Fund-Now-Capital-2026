import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { errorText } from "@/components/staff/StaffShell";
import { LINE_LABEL, PAYSLIP_LABEL, rands, useMovePayslip, usePayslipDocument } from "@/hooks/usePayroll";

// One payslip, printable (the staff menu is hidden when printing). The database decides who may open it: the Director
// and the Administrator, HR once it has reached HR, and the staff member once it has been distributed to them.
const day = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString("en-ZA", { dateStyle: "long" });
const monthName = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString("en-ZA", { month: "long", year: "numeric" });

export default function StaffPayslipDocumentPage() {
  const { payslipId } = useParams();
  const q = usePayslipDocument(payslipId);
  const move = useMovePayslip();
  if (q.error) return <p role="alert" className="text-sm text-red-600">{errorText(q.error)}</p>;
  if (!q.data) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const p = q.data;
  const earnings = p.lines.filter((l) => Number(l.amount) > 0);
  const deductions = p.lines.filter((l) => Number(l.amount) < 0);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <Link to="/staff/payslips" className="text-sm font-semibold text-brand-teal underline">Back</Link>
        <button type="button" onClick={() => window.print()} className="rounded-lg bg-brand-teal px-4 py-2 text-sm font-semibold text-white">Print or save as PDF</button>
        {p.can_acknowledge ? (
          <button type="button" className="rounded-lg border border-brand-teal px-4 py-2 text-sm font-semibold text-brand-navy disabled:opacity-50" disabled={move.isPending}
            onClick={() => move.mutate({ payslipId: p.payslip_id, to: "acknowledged" }, { onSuccess: () => toast.success("Thank you. HR has been told."), onError: (x) => toast.error(errorText(x)) })}>
            I have received this payslip
          </button>
        ) : null}
      </div>
      <article className="mx-auto max-w-3xl space-y-6 rounded-2xl border border-border bg-white p-8 text-sm text-brand-navy shadow-sm print:border-0 print:shadow-none">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-4">
          <div>
            <img src="/brand-mark.png" alt="" className="mb-2 h-10 w-10 object-contain" />
            <p className="text-lg font-bold">{p.company.legal_name ?? "Fund Now Capital"}</p>
            {p.company.registration_number ? <p className="text-xs text-muted-foreground">Registration {p.company.registration_number}</p> : null}
            {p.company.address ? <p className="whitespace-pre-line text-xs text-muted-foreground">{p.company.address}</p> : null}
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold">Payslip</p>
            <p className="font-semibold">{monthName(p.pay_month)}</p>
            <p className="text-xs">Pay day {day(p.pay_date)}</p>
            <p className="text-xs">Commission and fees for {day(p.period_start)} to {day(p.period_end)}</p>
            <p className="mt-1 inline-block rounded-full bg-slate-100 px-3 py-0.5 text-xs font-semibold print:hidden">{PAYSLIP_LABEL[p.status]}</p>
          </div>
        </header>
        <section>
          <p className="text-xs uppercase text-muted-foreground">Employee</p>
          <p className="font-semibold">{p.full_name ?? ""}</p>
        </section>
        <table className="w-full text-left">
          <thead><tr className="border-b border-border text-xs uppercase text-muted-foreground"><th className="py-2">Earnings</th><th className="py-2 text-right">Amount</th></tr></thead>
          <tbody>
            {earnings.map((l, n) => <tr key={n} className="border-b border-border"><td className="py-2">{LINE_LABEL[l.kind]}: {l.label}</td><td className="py-2 text-right">{rands(l.amount)}</td></tr>)}
            <tr><td className="py-2 text-right font-semibold">Gross</td><td className="py-2 text-right font-semibold">{rands(p.gross)}</td></tr>
          </tbody>
        </table>
        {deductions.length ? (
          <table className="w-full text-left">
            <thead><tr className="border-b border-border text-xs uppercase text-muted-foreground"><th className="py-2">Deductions</th><th className="py-2 text-right">Amount</th></tr></thead>
            <tbody>
              {deductions.map((l, n) => <tr key={n} className="border-b border-border"><td className="py-2">{LINE_LABEL[l.kind]}: {l.label}</td><td className="py-2 text-right">{rands(-Number(l.amount))}</td></tr>)}
              <tr><td className="py-2 text-right font-semibold">Total deductions</td><td className="py-2 text-right font-semibold">{rands(p.deductions)}</td></tr>
            </tbody>
          </table>
        ) : null}
        <p className="border-t border-border pt-3 text-right text-base font-bold">Net pay {rands(p.net)}</p>
        <footer className="border-t border-border pt-3 text-center text-xs text-muted-foreground">Queries to HR by the 11th. Many funders. More approvals.</footer>
      </article>
    </div>
  );
}
