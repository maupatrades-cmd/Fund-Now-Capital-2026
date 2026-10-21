import { Link } from "react-router-dom";
import { card, errorText } from "@/components/staff/StaffShell";
import { PAYSLIP_LABEL, rands, useMyPayslips } from "@/hooks/usePayroll";

// The signed-in staff member's own payslips, once HR has distributed them.
const monthName = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString("en-ZA", { month: "long", year: "numeric" });
const day = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString("en-ZA", { dateStyle: "medium" });

export default function StaffPayslipsPage() {
  const list = useMyPayslips();
  return (
    <section className={`${card} space-y-3`}>
      <div>
        <h1 className="text-lg font-bold text-brand-navy">My payslips</h1>
        <p className="text-sm text-muted-foreground">Queries about a payslip go to HR by the 11th of the month.</p>
      </div>
      {list.error ? <p role="alert" className="text-sm text-red-600">{errorText(list.error)}</p> : null}
      <ul className="divide-y divide-border">
        {(list.data ?? []).map((p) => (
          <li key={p.payslip_id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
            <div>
              <p className="font-semibold text-brand-navy">{monthName(p.pay_month)}</p>
              <p className="text-xs text-muted-foreground">Pay day {day(p.pay_date)} · net {rands(p.net)} · {PAYSLIP_LABEL[p.status]}</p>
            </div>
            <Link to={`/staff/payslips/${p.payslip_id}`} className="text-sm font-semibold text-brand-teal underline">
              {p.status === "distributed" ? "Open and acknowledge" : "Open"}
            </Link>
          </li>
        ))}
        {list.data && list.data.length === 0 ? <li className="py-3 text-sm text-muted-foreground">No payslips yet.</li> : null}
      </ul>
    </section>
  );
}
