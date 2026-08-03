import { useMemo, useState } from "react";
import { Banknote, TrendingUp, HardHat, Handshake, RefreshCw } from "lucide-react";
import { formatZAR } from "@/lib/format";
import {
  commissionByMonth,
  computeContractorPerformance,
  computeFunderPerformance,
  computeKpis,
  computePartnerPerformance,
  presetRange,
  type ContractorPerfRow,
  type CsvColumn,
  type DateRange,
  type FunderPerfRow,
  type PartnerPerfRow,
  type PresetKey,
} from "@/lib/reports";
import { useReports } from "@/hooks/useReports";
import { KpiCard, KpiCardSkeleton } from "@/components/reports/KpiCard";
import { DateRangeFilter } from "@/components/reports/DateRangeFilter";
import { ReportTable, type ReportColumn } from "@/components/reports/ReportTable";
import { CommissionByMonthChart } from "@/components/reports/CommissionByMonthChart";

const money = (n: number) => formatZAR(n);
const moneyOrDash = (n: number | null) => (n == null ? "—" : formatZAR(n));
const pct = (n: number) => `${n.toFixed(1)}%`;

// ---- table column configs --------------------------------------------------
const funderColumns: ReportColumn<FunderPerfRow>[] = [
  { key: "name", header: "Funder", align: "left", sortValue: (r) => r.funderName, render: (r) => (
    <span className="font-medium text-brand-navy">{r.funderName}</span>
  ) },
  { key: "gross", header: "Total Gross", align: "right", sortValue: (r) => r.totalGross, render: (r) => money(r.totalGross) },
  { key: "deals", header: "Deals Funded", align: "right", sortValue: (r) => r.dealsFunded, render: (r) => r.dealsFunded },
  { key: "avg", header: "Avg Deal Size", align: "right", sortValue: (r) => r.avgDealSize ?? -1, render: (r) => moneyOrDash(r.avgDealSize) },
  { key: "pct", header: "% of Total", align: "right", sortValue: (r) => r.pctOfTotal, render: (r) => pct(r.pctOfTotal) },
];

const funderCsv: CsvColumn<FunderPerfRow>[] = [
  { header: "Funder", value: (r) => r.funderName },
  { header: "Total Gross", value: (r) => r.totalGross },
  { header: "Deals Funded", value: (r) => r.dealsFunded },
  { header: "Avg Deal Size", value: (r) => r.avgDealSize ?? "" },
  { header: "% of Total", value: (r) => r.pctOfTotal.toFixed(1) },
];

const contractorColumns: ReportColumn<ContractorPerfRow>[] = [
  { key: "name", header: "Contractor", align: "left", sortValue: (r) => r.name, render: (r) => (
    <span className="font-medium text-brand-navy">{r.name}</span>
  ) },
  { key: "leads", header: "Leads Submitted", align: "right", sortValue: (r) => r.leadsSubmitted, render: (r) => r.leadsSubmitted },
  { key: "deals", header: "Deals Funded", align: "right", sortValue: (r) => r.dealsFunded, render: (r) => r.dealsFunded },
  { key: "gross", header: "FNC Gross Generated", align: "right", sortValue: (r) => r.fncGross, render: (r) => money(r.fncGross) },
  { key: "level", header: "Current Level", align: "right", sortValue: (r) => r.fncGross, render: (r) => (
    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{r.level}</span>
  ) },
];

const contractorCsv: CsvColumn<ContractorPerfRow>[] = [
  { header: "Contractor", value: (r) => r.name },
  { header: "Leads Submitted", value: (r) => r.leadsSubmitted },
  { header: "Deals Funded", value: (r) => r.dealsFunded },
  { header: "FNC Gross Generated", value: (r) => r.fncGross },
  { header: "Current Level", value: (r) => r.level },
];

const partnerColumns: ReportColumn<PartnerPerfRow>[] = [
  { key: "name", header: "Partner", align: "left", sortValue: (r) => r.name, render: (r) => (
    <span className="font-medium text-brand-navy">{r.name}</span>
  ) },
  { key: "leads", header: "Leads Submitted", align: "right", sortValue: (r) => r.leadsSubmitted, render: (r) => r.leadsSubmitted },
  { key: "deals", header: "Deals Funded", align: "right", sortValue: (r) => r.dealsFunded, render: (r) => r.dealsFunded },
  { key: "share", header: "Partner Share Earned", align: "right", sortValue: (r) => r.partnerShare, render: (r) => money(r.partnerShare) },
];

const partnerCsv: CsvColumn<PartnerPerfRow>[] = [
  { header: "Partner", value: (r) => r.name },
  { header: "Leads Submitted", value: (r) => r.leadsSubmitted },
  { header: "Deals Funded", value: (r) => r.dealsFunded },
  { header: "Partner Share Earned", value: (r) => r.partnerShare },
];

export default function ReportsPage() {
  const { commissions, leads, partners, contractors, isLoading, isError, error, refetch } =
    useReports();

  const [preset, setPreset] = useState<PresetKey>("last30");
  const [range, setRange] = useState<DateRange>(() => presetRange("last30"));

  const kpis = useMemo(
    () => computeKpis(commissions, leads, range),
    [commissions, leads, range],
  );
  const funderRows = useMemo(
    () => computeFunderPerformance(commissions, range),
    [commissions, range],
  );
  const contractorRows = useMemo(
    () => computeContractorPerformance(contractors, commissions, leads, range),
    [contractors, commissions, leads, range],
  );
  const partnerRows = useMemo(
    () => computePartnerPerformance(partners, commissions, leads, range),
    [partners, commissions, leads, range],
  );
  // Fixed last-12-months window, independent of the page filter (per brief).
  const monthly = useMemo(() => commissionByMonth(commissions), [commissions]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-bold text-brand-navy">Reports</h1>
        <DateRangeFilter preset={preset} range={range} onPreset={setPreset} onRange={setRange} />
      </div>

      {isError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <p>Couldn't load reports: {error?.message ?? "unknown error"}</p>
          <button
            type="button"
            onClick={refetch}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-brand-navy px-3 py-1.5 text-xs font-semibold text-white"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Retry
          </button>
        </div>
      ) : isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <KpiCardSkeleton key={i} />
          ))}
        </div>
      ) : (
        <>
          {/* Row 1 — KPI cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              icon={Banknote}
              label="Total Commission Earned"
              value={money(kpis.totalCommission)}
              tone="green"
              sub="FNC gross, selected range"
            />
            <KpiCard icon={TrendingUp} label="Deals Funded" value={String(kpis.dealsFunded)} />
            <KpiCard icon={HardHat} label="Active Contractors" value={String(kpis.activeContractors)} />
            <KpiCard icon={Handshake} label="Active Partners" value={String(kpis.activePartners)} />
          </div>

          {/* Row 2 — Funder performance */}
          <ReportTable
            title="Funder performance"
            columns={funderColumns}
            rows={funderRows}
            getRowKey={(r) => r.funderId}
            defaultSortKey="gross"
            emptyMessage="No commission data in this date range."
            csvFilename={`funder-performance-${range.from || "all"}_${range.to || "all"}.csv`}
            csvColumns={funderCsv}
          />

          {/* Row 3 — Contractor leaderboard */}
          <ReportTable
            title="Contractor performance"
            columns={contractorColumns}
            rows={contractorRows}
            getRowKey={(r) => r.contractorId}
            defaultSortKey="gross"
            emptyMessage="No contractor activity in this date range."
            csvFilename={`contractor-performance-${range.from || "all"}_${range.to || "all"}.csv`}
            csvColumns={contractorCsv}
          />

          {/* Row 4 — Partner leaderboard */}
          <ReportTable
            title="Partner performance"
            columns={partnerColumns}
            rows={partnerRows}
            getRowKey={(r) => r.partnerId}
            defaultSortKey="share"
            emptyMessage="No partner activity in this date range."
            csvFilename={`partner-performance-${range.from || "all"}_${range.to || "all"}.csv`}
            csvColumns={partnerCsv}
          />

          {/* Row 5 — Commission by month */}
          <CommissionByMonthChart data={monthly} />
        </>
      )}
    </div>
  );
}
