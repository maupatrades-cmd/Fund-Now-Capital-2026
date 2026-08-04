import { FileText } from "lucide-react";
import { formatZAR } from "@/lib/format";
import { EmptyState } from "@/components/ui/empty-state";
import {
  csvMoney,
  statementFilename,
  toNum,
  type CsvColumn,
  type OwnerStatementLine,
  type YearMonth,
} from "@/lib/statements";
import { useOwnerStatement } from "@/hooks/useStatements";
import { MonthPicker } from "./MonthPicker";
import { ExportCsvButton } from "./ExportCsvButton";
import { KindBadge, StateBadge, StatementFrame, TotalTile } from "./StatementUI";

const money = (n: number | string | null | undefined) => formatZAR(toNum(n), { cents: true });
const day = (iso: string) => iso.slice(0, 10);

// Owner sees REAL names + the full split, so the CSV mirrors the on-screen table.
const ownerCsv: CsvColumn<OwnerStatementLine>[] = [
  { header: "Date", value: (r) => day(r.occurred_at) },
  { header: "Type", value: (r) => r.kind },
  { header: "Deal", value: (r) => r.deal_reference ?? "" },
  { header: "Client", value: (r) => r.client_name ?? "" },
  { header: "Funder", value: (r) => r.funder_name ?? "" },
  { header: "Partner", value: (r) => r.partner_name ?? "" },
  { header: "Contractor", value: (r) => r.contractor_name ?? "" },
  { header: "Gross Commission", value: (r) => csvMoney(r.gross_commission) },
  { header: "Company Retention", value: (r) => csvMoney(r.company_retention) },
  { header: "Partner Share", value: (r) => csvMoney(r.partner_share) },
  { header: "Owner Share", value: (r) => csvMoney(r.owner_share) },
  { header: "Contractor Share", value: (r) => csvMoney(r.contractor_share) },
  { header: "Bonus", value: (r) => csvMoney(r.bonus_amount) },
  { header: "State", value: (r) => r.state },
];

export function OwnerStatementView({
  ym,
  onMonth,
}: {
  ym: YearMonth;
  onMonth: (next: YearMonth) => void;
}) {
  const q = useOwnerStatement(ym);
  const stmt = q.data;
  const lines = stmt?.line_items ?? [];
  const t = stmt?.totals;

  return (
    <StatementFrame
      title="Monthly Statement"
      subtitle="Every commission and bonus across all funders, partners, and contractors."
      picker={<MonthPicker value={ym} onChange={onMonth} />}
      actions={
        <ExportCsvButton
          filename={statementFilename("owner", ym)}
          rows={lines}
          columns={ownerCsv}
        />
      }
      isLoading={q.isLoading}
      isError={q.isError}
      error={q.error as Error | null}
      onRetry={() => void q.refetch()}
    >
      {/* Totals */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
        <TotalTile label="Gross Commission" value={money(t?.gross_commission)} emphasis sub={stmt?.period.label} />
        <TotalTile label="Company Retention" value={money(t?.company_retention)} />
        <TotalTile label="Owner Share" value={money(t?.owner_share)} />
        <TotalTile label="Partner Share" value={money(t?.partner_share)} />
        <TotalTile label="Contractor Share" value={money(t?.contractor_share)} />
        <TotalTile label="Bonuses" value={money(t?.bonus)} />
      </div>

      {lines.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={`No activity in ${stmt?.period.label ?? "this month"}`}
          description="Commissions and bonuses appear here once a deal is genuinely funded and its commission is locked. Pick another month to review earlier activity."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-white shadow-sm">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-border bg-slate-50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2.5 font-medium">Date</th>
                <th className="px-3 py-2.5 font-medium">Type</th>
                <th className="px-3 py-2.5 font-medium">Deal</th>
                <th className="px-3 py-2.5 font-medium">Client</th>
                <th className="px-3 py-2.5 font-medium">Funder</th>
                <th className="px-3 py-2.5 text-right font-medium">Gross</th>
                <th className="px-3 py-2.5 text-right font-medium">Partner</th>
                <th className="px-3 py-2.5 text-right font-medium">Owner</th>
                <th className="px-3 py-2.5 text-right font-medium">Contractor</th>
                <th className="px-3 py-2.5 text-right font-medium">Bonus</th>
                <th className="px-3 py-2.5 font-medium">State</th>
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
                  <td className="whitespace-nowrap px-3 py-2.5 text-right">{r.kind === "commission" ? money(r.gross_commission) : "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right">{r.kind === "commission" ? money(r.partner_share) : "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right">{r.kind === "commission" ? money(r.owner_share) : "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right">{r.kind === "commission" ? money(r.contractor_share) : "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right">{r.kind === "bonus" ? money(r.bonus_amount) : "—"}</td>
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
