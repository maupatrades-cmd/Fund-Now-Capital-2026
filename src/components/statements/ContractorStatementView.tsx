import { Wallet, Info } from "lucide-react";
import { formatZAR } from "@/lib/format";
import { EmptyState } from "@/components/ui/empty-state";
import {
  csvMoney,
  statementFilename,
  toNum,
  type ContractorStatementLine,
  type CsvColumn,
  type YearMonth,
} from "@/lib/statements";
import { useContractorStatement } from "@/hooks/useStatements";
import { MonthPicker } from "./MonthPicker";
import { ExportCsvButton } from "./ExportCsvButton";
import { StateBadge, StatementFrame, TotalTile } from "./StatementUI";

const money = (n: number | string | null | undefined) => formatZAR(toNum(n), { cents: true });
const day = (iso: string) => iso.slice(0, 10);

const contractorCsv: CsvColumn<ContractorStatementLine>[] = [
  { header: "Date", value: (r) => day(r.occurred_at) },
  { header: "Deal", value: (r) => r.deal_reference ?? "" },
  { header: "Client", value: (r) => r.client_name ?? "" },
  { header: "Funder", value: (r) => r.funder_name ?? "" },
  { header: "Your Earnings", value: (r) => csvMoney(r.amount) },
  { header: "Status", value: (r) => r.state },
];

export function ContractorStatementView({
  ym,
  onMonth,
}: {
  ym: YearMonth;
  onMonth: (next: YearMonth) => void;
}) {
  const q = useContractorStatement(ym);
  const stmt = q.data;
  const lines = stmt?.line_items ?? [];
  const t = stmt?.totals;
  const reimbursements = stmt?.reimbursements ?? [];
  const reimbursementsAvailable = stmt?.reimbursements_available ?? false;

  return (
    <StatementFrame
      title="My Monthly Statement"
      subtitle="Your commission earnings and monthly reimbursements."
      picker={<MonthPicker value={ym} onChange={onMonth} />}
      actions={
        <ExportCsvButton
          filename={statementFilename("contractor", ym)}
          rows={lines}
          columns={contractorCsv}
        />
      }
      isLoading={q.isLoading}
      isError={q.isError}
      error={q.error as Error | null}
      onRetry={() => void q.refetch()}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <TotalTile label="Total" value={money(t?.total)} emphasis sub={stmt?.period.label} />
        <TotalTile label="Commission" value={money(t?.commission_total)} />
        <TotalTile label="Reimbursements" value={money(t?.reimbursement_total)} />
      </div>

      {/* Commission earnings */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-brand-navy">Commission earnings</h2>
        {lines.length === 0 ? (
          <EmptyState
            icon={Wallet}
            title={`No commission in ${stmt?.period.label ?? "this month"}`}
            description="Your commission appears here once the deals you referred are funded and confirmed. Pick another month to review earlier statements."
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-white shadow-sm">
            <table className="w-full min-w-[600px] text-sm">
              <thead>
                <tr className="border-b border-border bg-slate-50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2.5 font-medium">Date</th>
                  <th className="px-3 py-2.5 font-medium">Deal</th>
                  <th className="px-3 py-2.5 font-medium">Client</th>
                  <th className="px-3 py-2.5 font-medium">Funder</th>
                  <th className="px-3 py-2.5 text-right font-medium">Your Earnings</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((r) => (
                  <tr key={r.id} className="border-b border-border last:border-0">
                    <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">{day(r.occurred_at)}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 font-medium text-brand-navy">{r.deal_reference ?? "—"}</td>
                    <td className="px-3 py-2.5 text-brand-navy">{r.client_name ?? "—"}</td>
                    <td className="px-3 py-2.5 text-brand-navy">{r.funder_name ?? "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold text-brand-navy">{money(r.amount)}</td>
                    <td className="px-3 py-2.5"><StateBadge state={r.state} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Reimbursements */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-brand-navy">Reimbursements</h2>
        {!reimbursementsAvailable ? (
          <div className="flex items-start gap-2.5 rounded-xl border border-border bg-white p-4 text-sm text-muted-foreground shadow-sm">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand-teal" />
            <p>
              Monthly petrol, airtime, and data reimbursements will appear here once your
              reimbursement schedule is set up. Reimbursements are separate from — and in addition
              to — your commission.
            </p>
          </div>
        ) : reimbursements.length === 0 ? (
          <div className="rounded-xl border border-border bg-white p-4 text-sm text-muted-foreground shadow-sm">
            No reimbursements recorded for {stmt?.period.label}.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-white shadow-sm">
            <table className="w-full min-w-[420px] text-sm">
              <thead>
                <tr className="border-b border-border bg-slate-50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2.5 font-medium">Item</th>
                  <th className="px-3 py-2.5 font-medium">Paid</th>
                  <th className="px-3 py-2.5 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {reimbursements.map((r) => (
                  <tr key={r.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-2.5 text-brand-navy">{r.label}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">
                      {r.paid_at ? day(r.paid_at) : "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold text-brand-navy">
                      {money(r.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </StatementFrame>
  );
}
