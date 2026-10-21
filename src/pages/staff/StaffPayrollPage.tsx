import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Field, card, errorText, primaryButton, selectClass } from "@/components/staff/StaffShell";
import { canDecideTimeRequests, useStaffRole } from "@/hooks/useStaffDesk";
import {
  CYCLE_LABEL, CYCLE_STEP, LINE_LABEL, PAYSLIP_LABEL, PAYSLIP_STEP, rands, useAddPayslipLine, useAddSalaryLine,
  useMoveCycle, useMovePayslip, useOpenCycle, usePayrollCycles, usePayrollPayslips, useRemovePayslipLine,
  type LineKind, type PayrollCycle, type PayrollPayslip,
} from "@/hooks/usePayroll";

// Payroll (docs/FNC-LAUNCH-PLAN-2026-11-09.md §5): the Director and the Administrator run the cycles and prepare and
// approve payslips; HR sees the payslips that reach HR and distributes them. Only the Director closes and pays.
const day = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString("en-ZA", { dateStyle: "medium" });
const monthName = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString("en-ZA", { month: "long", year: "numeric" });
const sastMonth = (offset: number) => {
  const d = new Date(`${new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" }).slice(0, 7)}-01T12:00:00`);
  d.setMonth(d.getMonth() + offset);
  return d.toISOString().slice(0, 7) + "-01";
};
const amountOk = (s: string) => /^\d{1,6}(\.\d{1,2})?$/.test(s) && Number(s) > 0;

function CycleCard({ c, selected, onSelect }: { c: PayrollCycle; selected: boolean; onSelect: () => void }) {
  const move = useMoveCycle();
  return (
    <li className={`space-y-2 rounded-xl border p-4 text-sm ${selected ? "border-brand-teal bg-teal-50" : "border-border bg-white"}`}>
      <button type="button" className="w-full text-left" onClick={onSelect}>
        <p className="font-semibold text-brand-navy">{monthName(c.pay_month)} · {CYCLE_LABEL[c.status]}</p>
        <p className="text-xs text-muted-foreground">
          Capture {day(c.period_start)} to {day(c.period_end)} · queries until {day(c.query_close_on)} · pay day {day(c.pay_date)}
        </p>
        <p className="text-xs">{c.payslips} payslips · {c.draft} being prepared · {c.awaiting_director} with the Director · {c.approved_or_later} approved · {c.acknowledged} acknowledged</p>
      </button>
      {c.next_steps.length ? (
        <div className="flex flex-wrap gap-2">
          {c.next_steps.map((s) => (
            <button key={s} type="button" className={s === "calculating" && c.status === "query_window" ? "rounded-lg border border-border px-3 py-1.5 text-xs font-semibold" : primaryButton}
              disabled={move.isPending}
              onClick={() => move.mutate({ cycleId: c.cycle_id, to: s }, { onSuccess: () => toast.success("Cycle updated"), onError: (x) => toast.error(errorText(x)) })}>
              {s === "calculating" && c.status === "query_window" ? "Back to calculating" : CYCLE_STEP[s] ?? s}
            </button>
          ))}
        </div>
      ) : null}
    </li>
  );
}

function AddLine({ p }: { p: PayrollPayslip }) {
  const add = useAddPayslipLine();
  const salary = useAddSalaryLine();
  const [kind, setKind] = useState<LineKind | "salary_month">("salary_month");
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [start, setStart] = useState("");
  const done = { onSuccess: () => { toast.success("Line added"); setLabel(""); setAmount(""); setStart(""); }, onError: (x: unknown) => toast.error(errorText(x)) };
  return (
    <div className="grid gap-2 sm:grid-cols-[10rem_1fr_8rem_auto]">
      <select className={selectClass} aria-label="Kind of line" value={kind} onChange={(e) => setKind(e.target.value as LineKind | "salary_month")}>
        <option value="salary_month">Monthly salary</option>
        {(Object.keys(LINE_LABEL) as LineKind[]).map((k) => <option key={k} value={k}>{LINE_LABEL[k]}</option>)}
      </select>
      {kind === "salary_month" ? (
        <Input type="date" aria-label="Start date if they started this month" title="Start date, only if they started during this month (pro-rata on working days)"
          value={start} onChange={(e) => setStart(e.target.value)} />
      ) : (
        <Input maxLength={120} aria-label="Description" placeholder="Description, for example: File fees, 3 closed files" value={label} onChange={(e) => setLabel(e.target.value)} />
      )}
      <Input inputMode="decimal" aria-label="Amount in Rands" placeholder={kind === "salary_month" ? "Monthly R" : "R"} value={amount} onChange={(e) => setAmount(e.target.value.trim())} />
      <button type="button" className={primaryButton} disabled={!amountOk(amount) || (kind !== "salary_month" && label.trim().length < 2) || add.isPending || salary.isPending}
        onClick={() => kind === "salary_month"
          ? salary.mutate({ payslipId: p.payslip_id, monthly: amount, startDate: start || null }, done)
          : add.mutate({ payslipId: p.payslip_id, kind, label, amount }, done)}>
        Add
      </button>
    </div>
  );
}

function PayslipRow({ p }: { p: PayrollPayslip }) {
  const move = useMovePayslip();
  const remove = useRemovePayslipLine();
  const [note, setNote] = useState("");
  const draft = p.status === "draft";
  return (
    <li className="space-y-2 py-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-brand-navy">{p.full_name ?? "Unnamed"} <span className="font-normal text-muted-foreground">· {p.staff_role}</span></p>
          <p className="text-xs">Gross {rands(p.gross)} · deductions {rands(p.deductions)} · <strong>net {rands(p.net)}</strong></p>
          {p.last_note ? <p className="text-xs text-amber-800">Note: {p.last_note}</p> : null}
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold">{PAYSLIP_LABEL[p.status]}</span>
      </div>
      <ul className="space-y-1 text-xs">
        {p.lines.map((l) => (
          <li key={l.line_id} className="flex items-center justify-between gap-2 rounded bg-slate-50 px-2 py-1">
            <span>{LINE_LABEL[l.kind]}: {l.label}</span>
            <span className="flex items-center gap-2">{rands(l.amount)}
              {draft && l.line_id ? (
                <button type="button" className="text-red-700 underline" disabled={remove.isPending}
                  onClick={() => remove.mutate({ lineId: l.line_id as string, reason: "Removed while preparing" }, { onError: (x) => toast.error(errorText(x)) })}>Remove</button>
              ) : null}
            </span>
          </li>
        ))}
        {p.lines.length === 0 ? <li className="text-muted-foreground">No lines yet.</li> : null}
      </ul>
      {draft && p.next_steps.includes("awaiting_director") ? <AddLine p={p} /> : null}
      {p.next_steps.length ? (
        <div className="flex flex-wrap items-center gap-2">
          {p.next_steps.includes("draft") ? (
            <Input className="max-w-sm" maxLength={500} aria-label="Reason to send back" placeholder="Reason to send back" value={note} onChange={(e) => setNote(e.target.value)} />
          ) : null}
          {p.next_steps.map((s) => (
            <button key={s} type="button" className={s === "draft" ? "rounded-lg border border-amber-400 px-4 py-2 text-sm font-semibold text-amber-800 disabled:opacity-50" : primaryButton}
              disabled={move.isPending || (s === "draft" && note.trim().length < 5)}
              onClick={() => move.mutate({ payslipId: p.payslip_id, to: s, note: s === "draft" ? note : undefined }, {
                onSuccess: () => { toast.success("Payslip updated"); setNote(""); }, onError: (x) => toast.error(errorText(x)),
              })}>
              {PAYSLIP_STEP[s] ?? s}
            </button>
          ))}
          <Link to={`/staff/payslips/${p.payslip_id}`} className="text-xs font-semibold text-brand-teal underline">Open payslip</Link>
        </div>
      ) : <Link to={`/staff/payslips/${p.payslip_id}`} className="text-xs font-semibold text-brand-teal underline">Open payslip</Link>}
    </li>
  );
}

function Payslips({ cycleId }: { cycleId: string }) {
  const list = usePayrollPayslips(cycleId);
  if (list.error) return <p role="alert" className="text-sm text-red-600">{errorText(list.error)}</p>;
  if (!list.data) return <p className="text-sm text-muted-foreground">Loading…</p>;
  return (
    <ul className="divide-y divide-border">
      {list.data.map((p) => <PayslipRow key={p.payslip_id} p={p} />)}
      {list.data.length === 0 ? <li className="py-3 text-sm text-muted-foreground">No payslips here yet.</li> : null}
    </ul>
  );
}

export default function StaffPayrollPage() {
  const { data: role, isLoading } = useStaffRole();
  const allowed = canDecideTimeRequests(role) || role === "hr";
  const cycles = usePayrollCycles(allowed);
  const open = useOpenCycle();
  const [month, setMonth] = useState(sastMonth(0));
  const [selected, setSelected] = useState<string | null>(null);
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!allowed) return <p className="text-sm text-muted-foreground">Payroll is for the Director, the Administrator and HR.</p>;
  const current = selected ?? cycles.data?.[0]?.cycle_id ?? null;
  return (
    <div className="space-y-5">
      <section className={`${card} space-y-3`}>
        <div>
          <h1 className="text-lg font-bold text-brand-navy">Payroll</h1>
          <p className="text-sm text-muted-foreground">
            {role === "hr"
              ? "Payslips approved by the Director reach you here. Distribute each one to the staff member."
              : "Capture from the 7th to the 6th, queries until the 11th, pay day the 27th (or the last working day before). Salary is for the current month; commission, fees and bonuses are paid a month in arrears. Only the Director closes and pays."}
          </p>
        </div>
        {canDecideTimeRequests(role) ? (
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Pay month">
              <select className={selectClass} value={month} onChange={(e) => setMonth(e.target.value)}>
                {[-1, 0, 1, 2].map((o) => <option key={o} value={sastMonth(o)}>{monthName(sastMonth(o))}</option>)}
              </select>
            </Field>
            <button type="button" className={primaryButton} disabled={open.isPending}
              onClick={() => open.mutate(month, { onSuccess: (id) => { toast.success("Cycle ready. A payslip was created for every staff member."); setSelected(id); }, onError: (x) => toast.error(errorText(x)) })}>
              Open cycle and create payslips
            </button>
          </div>
        ) : null}
        {cycles.error ? <p role="alert" className="text-sm text-red-600">{errorText(cycles.error)}</p> : null}
        <ul className="grid gap-3 lg:grid-cols-2">
          {(cycles.data ?? []).map((c) => <CycleCard key={c.cycle_id} c={c} selected={c.cycle_id === current} onSelect={() => setSelected(c.cycle_id)} />)}
          {cycles.data && cycles.data.length === 0 ? <li className="text-sm text-muted-foreground">No payroll cycles yet.</li> : null}
        </ul>
      </section>
      {current ? (
        <section className={`${card} space-y-3`}>
          <h2 className="text-base font-bold text-brand-navy">Payslips</h2>
          <Payslips cycleId={current} />
        </section>
      ) : null}
    </div>
  );
}
