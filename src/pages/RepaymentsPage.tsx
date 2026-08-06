import { useState, type FormEvent } from "react";
import { Check, Plus } from "lucide-react";
import { toast } from "sonner";
import { useCreateSchedule, useFundedSubmissions, useRecordRepayment, useRepaymentSchedules } from "@/hooks/useRepayments";
import { formatZAR } from "@/lib/format";

function one<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

export default function RepaymentsPage() {
  const schedules = useRepaymentSchedules();
  const options = useFundedSubmissions();
  const create = useCreateSchedule();
  const record = useRecordRepayment();
  const [submissionId, setSubmissionId] = useState("");
  const [total, setTotal] = useState("");
  const [count, setCount] = useState("12");
  const [firstDue, setFirstDue] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await create.mutateAsync({ p_submission_id: submissionId, p_total_repayable: Number(total), p_instalment_count: Number(count), p_first_due_date: firstDue });
      setSubmissionId(""); setTotal(""); setFirstDue("");
      toast.success("Repayment schedule created");
    } catch (error) { toast.error((error as Error).message || "Could not create schedule"); }
  }

  async function markPaid(id: string, amountDue: string) {
    const amount = window.prompt("Amount received", amountDue);
    if (!amount) return;
    const reference = window.prompt("Payment reference (optional)");
    try {
      await record.mutateAsync({ p_instalment_id: id, p_amount: Number(amount), p_reference: reference });
      toast.success("Repayment recorded");
    } catch (error) { toast.error((error as Error).message || "Could not record repayment"); }
  }

  return <div className="max-w-6xl space-y-6">
    <div><h1 className="text-2xl font-bold text-brand-navy">Repayments</h1><p className="mt-1 text-sm text-muted-foreground">Track customer payments to funders without changing FNC earnings.</p></div>
    <form onSubmit={(event) => void submit(event)} className="grid gap-3 rounded-xl border border-border bg-white p-5 md:grid-cols-4">
      <select required value={submissionId} onChange={(e) => setSubmissionId(e.target.value)} className="rounded-lg border border-border px-3 py-2 text-sm md:col-span-2">
        <option value="">Select funded submission</option>
        {(options.data ?? []).map((item) => <option key={item.id} value={item.id}>{one(item.deal)?.reference ?? "Deal"} · {one(item.funder)?.name ?? "Funder"} · {formatZAR(Number(item.amount_funded))}</option>)}
      </select>
      <input required type="number" min="1" value={total} onChange={(e) => setTotal(e.target.value)} placeholder="Total repayable" className="rounded-lg border border-border px-3 py-2 text-sm" />
      <input required type="number" min="1" max="120" value={count} onChange={(e) => setCount(e.target.value)} aria-label="Number of instalments" className="rounded-lg border border-border px-3 py-2 text-sm" />
      <input required type="date" value={firstDue} onChange={(e) => setFirstDue(e.target.value)} aria-label="First due date" className="rounded-lg border border-border px-3 py-2 text-sm" />
      <button disabled={create.isPending} className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-teal px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"><Plus className="h-4 w-4" />Create schedule</button>
    </form>
    {schedules.isLoading && <p className="text-sm text-muted-foreground">Loading repayment schedules...</p>}
    {schedules.isError && <p className="rounded-lg bg-red-50 p-4 text-sm text-red-700">Could not load repayment schedules.</p>}
    <div className="space-y-4">{(schedules.data ?? []).map((schedule) => {
      const submission = one(schedule.submission);
      return <section key={schedule.id} className="rounded-xl border border-border bg-white p-5 shadow-sm">
        <div className="flex justify-between gap-3"><div><h2 className="font-semibold text-brand-navy">{one(submission?.deal)?.reference ?? "Deal"}</h2><p className="text-sm text-muted-foreground">{one(submission?.funder)?.name ?? "Funder"} · {formatZAR(Number(schedule.total_repayable))}</p></div><span className="h-fit rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold">{schedule.status}</span></div>
        <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b text-xs text-muted-foreground"><th className="py-2">#</th><th>Due</th><th>Amount</th><th>Status</th><th /></tr></thead><tbody>
          {[...schedule.instalments].sort((a,b) => a.instalment_number-b.instalment_number).map((item) => <tr key={item.id} className="border-b last:border-0"><td className="py-3">{item.instalment_number}</td><td>{new Date(`${item.due_date}T00:00:00`).toLocaleDateString("en-ZA")}</td><td>{formatZAR(Number(item.amount_due))}</td><td>{item.paid_at ? "Paid" : new Date(`${item.due_date}T23:59:59`) < new Date() ? "Overdue" : "Due"}</td><td className="text-right">{!item.paid_at && <button disabled={record.isPending} onClick={() => void markPaid(item.id,item.amount_due)} className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs disabled:opacity-50"><Check className="h-3 w-3" />Record paid</button>}</td></tr>)}
        </tbody></table></div>
      </section>;
    })}</div>
  </div>;
}
