import { Wallet } from "lucide-react";
import { formatZAR } from "@/lib/format";
import { EmptyState } from "@/components/ui/empty-state";
import {
  csvMoney,
  statementFilename,
  toNum,
  type CsvColumn,
  type PartnerStatementLine,
  type YearMonth,
} from "@/lib/statements";
import { usePartnerStatement } from "@/hooks/useStatements";
import { MonthPicker } from "./MonthPicker";
import { ExportCsvButton } from "./ExportCsvButton";
import { KindBadge, StateBadge, StatementFrame, TotalTile } from "./StatementUI";

const money = (n: number | string | null | undefined) => formatZAR(toNum(n), { cents: true });
const day = (iso: string) => iso.slice(0, 10);

// Partner CSV shows ONLY his own take + the fictional funder name (S7C).
const partnerCsv: CsvColumn<PartnerStatementLine>[] = [
  { header: "Date", value: (r) => day(r.occurred_at) },
  { header: "Type", value: (r) => r.kind },
  { header: "Deal", value: (r) => r.deal_reference ?? "" },
  { header: "Client", value: (r) => r.client_name ?? "" },
  { header: "Funder", value: (r) => r.funder_name ?? "" },
  { header: "Your Earnings", value: (r) => csvMoney(r.amount) },
  { header: "Status", value: (r) => r.state },
];

export function PartnerStatementView({
  ym,
  onMonth,
}: {
  ym: YearMonth;
  onMonth: (next: YearMonth) => void;
}) {
  const q = usePartnerStatement(ym);
  const stmt = q.data;
  const lines = stmt?.line_items ?? [];
  const t = stmt?.totals;

  return (
    <StatementFrame
      title="My Monthly Statement"
      subtitle="Your commission earnings, presented as your 50% partner split of each deal."
      picker={<MonthPicker value={ym} onChange={onMonth} />}
      actions={
        <ExportCsvButton
          filename={statementFilename("partner", ym)}
          rows={lines}
          columns={partnerCsv}
        />
      }
      isLoading={q.isLoading}
      isError={q.isError}
      error={q.error as Error | null}
      onRetry={() => void q.refetch()}
    >
      {/* Totals — his numbers only. Never gross / pool / tier (S7C). */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <TotalTile label="Total Earnings" value={money(t?.total_earned)} emphasis sub={stmt?.period.label} />
        <TotalTile label="Commission" value={money(t?.commission_total)} />
        <TotalTile label="Bonuses" value={money(t?.bonus_total)} />
      </div>

      {lines.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title={`No earnings in ${stmt?.period.label ?? "this month"}`}
          description="Your earnings appear here once the deals you referred are funded and commission is confirmed. Pick another month to review earlier statements."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-white shadow-sm">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-border bg-slate-50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2.5 font-medium">Date</th>
                <th className="px-3 py-2.5 font-medium">Type</th>
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
                  <td className="px-3 py-2.5"><KindBadge kind={r.kind} /></td>
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
    </StatementFrame>
  );
}
