import { useState } from "react";
import { toast } from "sonner";
import { card, errorText } from "@/components/staff/StaffShell";
import {
  useCoordinatorKpis, useQualifyingFiles, useSignoffQualifyingFiles, useStaffRole, type CoordinatorKpi, type QualifyingFiles,
} from "@/hooks/useStaffDesk";

const day = (iso: string) => new Date(iso).toLocaleDateString("en-ZA", { timeZone: "Africa/Johannesburg", dateStyle: "medium" });
const rand = (n: number) => `R${Number(n).toLocaleString("en-ZA", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
// First day of the month `offset` months from now (Johannesburg), as YYYY-MM-01.
function sastMonth(offset: number) {
  const [y, m] = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" }).split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + offset, 1));
  return d.toISOString().slice(0, 10);
}
const monthName = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-ZA", { month: "long", year: "numeric", timeZone: "UTC" });

// The Director's view: one block per coordinator with the files, count x rate = total, and Sign off once the month ended.
function DirectorFiles({ data }: { data: QualifyingFiles }) {
  const signoff = useSignoffQualifyingFiles();
  const handlers = [...new Set(data.files.map((f) => f.handler_id))];
  if (handlers.length === 0) return <p className="text-sm text-muted-foreground">No files moved to Submitted in {monthName(data.month)}.</p>;
  return (
    <div className="space-y-3">
      {handlers.map((h) => {
        const files = data.files.filter((f) => f.handler_id === h);
        const signed = data.signoffs.find((x) => x.handler_id === h);
        const total = files.length * Number(data.rate_per_file);
        return (
          <div key={h} className="rounded-lg border border-border p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-semibold text-brand-navy">{files[0].handler_name ?? "Staff member"}</p>
              <p className="text-sm">
                {signed ? <>{signed.count} × {rand(signed.rate)} = <strong>{rand(signed.total)}</strong></>
                  : <>{files.length} × {rand(data.rate_per_file)} = <strong>{rand(total)}</strong></>}
              </p>
            </div>
            <ul className="mt-1 divide-y divide-border text-sm">
              {files.map((f) => (
                <li key={f.lead_id} className="py-1">{f.business_name} <span className="text-xs text-muted-foreground">· {f.deal_reference ?? "deal"} · submitted {day(f.reached_submitted_at)}</span></li>
              ))}
            </ul>
            <div className="mt-2">
              {signed ? (
                <p className="text-xs text-green-700">Signed off {day(signed.signed_at)} · {signed.on_payslip ? "on the payslip" : "goes on the payslip when the next payroll cycle is opened"}</p>
              ) : data.month_ended ? (
                <button type="button" className="rounded-lg bg-brand-teal px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50" disabled={signoff.isPending}
                  onClick={() => {
                    if (!window.confirm(`Sign off ${files.length} file${files.length === 1 ? "" : "s"} for ${files[0].handler_name ?? "this coordinator"} (${monthName(data.month)})? This is paid on the payslip and cannot be undone.`)) return;
                    signoff.mutate({ month: data.month, handlerId: h }, {
                      onSuccess: (r) => toast.success(r.already_signed_off ? "Already signed off" : r.added_to_payslip ? "Signed off and added to the payslip" : "Signed off"),
                      onError: (x) => toast.error(errorText(x)),
                    });
                  }}>
                  Sign off {monthName(data.month)}
                </button>
              ) : <p className="text-xs text-muted-foreground">You can sign off once the month has ended.</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function kpiState(k: CoordinatorKpi): { text: string; cls: string } {
  if (k.not_tracked) return { text: "Not tracked yet", cls: "text-muted-foreground" };
  if (k.value_pct == null) return { text: "No data yet", cls: "text-muted-foreground" };
  const met = k.direction === "min" ? k.value_pct >= k.target_pct : k.value_pct <= k.target_pct;
  return { text: `${k.value_pct}%`, cls: met ? "text-green-700" : "text-red-600" };
}

// Files the Director moved to Submitted (or a later stage) in a month: R29 each from Nov 2026 (owner, 20 Nov), paid on
// the payslip one month in arrears once the Director signs the month off. The Coordinator sees her own; the Director sees
// every coordinator and signs off. Plus the Coordinator's KPI scorecard against the agreed targets.
export function QualifyingAndKpis({ enabled }: { enabled: boolean }) {
  const { data: role } = useStaffRole();
  const isOwner = role === "owner";
  const [month, setMonth] = useState(sastMonth(0));
  const q = useQualifyingFiles(enabled, month);
  const k = useCoordinatorKpis(enabled);
  return (
    <>
      <section className={card}>
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-bold text-brand-navy">Files submitted (R29 each)</h2>
          <select aria-label="Month" className="rounded-md border border-input px-2 py-1 text-sm" value={month} onChange={(e) => setMonth(e.target.value)}>
            {[0, -1, -2, -3].map((o) => <option key={o} value={sastMonth(o)}>{monthName(sastMonth(o))}</option>)}
          </select>
        </div>
        {q.error ? <p role="alert" className="text-sm text-red-600">{errorText(q.error)}</p> : null}
        {q.data && isOwner ? <DirectorFiles data={q.data} /> : null}
        {q.data && !isOwner ? (
          <>
            <p className="text-sm">
              <span className="text-2xl font-bold text-brand-navy">{q.data.count}</span> file{q.data.count === 1 ? "" : "s"} × {rand(q.data.rate_per_file)} ={" "}
              <span className="font-semibold">{rand(q.data.estimate_total)}</span>{" "}
              <span className="text-xs text-muted-foreground">
                {q.data.status === "signed_off" ? "(signed off by the Director)" : "(estimate until the Director signs off)"}
              </span>
            </p>
            <p className="text-xs text-muted-foreground">Paid on your payslip on {day(q.data.pay_date)}. A file counts once, the first time the Director moves its deal to Submitted (or straight to a later stage), if you handled or captured it.</p>
            <ul className="mt-2 divide-y divide-border text-sm">
              {q.data.files.map((f) => (
                <li key={f.lead_id} className="py-1.5">{f.business_name} <span className="text-xs text-muted-foreground">· submitted {day(f.reached_submitted_at)}</span></li>
              ))}
              {q.data.files.length === 0 ? <li className="py-1.5 text-muted-foreground">None yet this month.</li> : null}
            </ul>
          </>
        ) : null}
      </section>
      <section className={card}>
        <h2 className="mb-1 text-base font-bold text-brand-navy">Your scorecard (last 30 days)</h2>
        {k.error ? <p role="alert" className="text-sm text-red-600">{errorText(k.error)}</p> : null}
        <ul className="divide-y divide-border text-sm">
          {k.data?.kpis.map((x) => {
            const s = kpiState(x);
            return (
              <li key={x.key} className="flex items-baseline justify-between gap-3 py-1.5">
                <span>{x.label}<span className="block text-xs text-muted-foreground">Target {x.direction === "min" ? "at least" : "at most"} {x.target_pct}%{x.sample != null ? ` · ${x.sample} counted` : ""}</span></span>
                <span className={`font-semibold ${s.cls}`}>{s.text}</span>
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}
