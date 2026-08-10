import { Info, Wallet, Clock3, CheckCircle2, ReceiptText } from "lucide-react";
import { formatZAR } from "@/lib/format";
import { EmptyState } from "@/components/ui/empty-state";
import { usePayoutReconciliation } from "@/hooks/usePayoutReconciliation";
import type { PayoutRow, PayoutTotals, PayeeType } from "@/lib/payoutReconciliation";

// Build 11 — Unified payout reconciliation queue. One owner view of what's owed
// and where it sits, across referral partners AND contractors. Real names +
// amounts (owner surface; S7C masking is partner/contractor-facing only).
export default function PayoutsPage() {
  const {
    partnerRows,
    contractorRows,
    partnerTotals,
    contractorTotals,
    isLoading,
    isError,
    error,
  } = usePayoutReconciliation();

  return (
    <div className="max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-brand-navy">Payouts</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Everything you owe partners and contractors, and where each amount sits in the payout
          pipeline.
        </p>
      </div>

      <div className="flex items-start gap-2 rounded-xl border border-brand-teal/30 bg-brand-teal/5 p-3 text-sm text-brand-navy">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          <span className="font-medium">Payable</span> is ready to pay now.{" "}
          <span className="font-medium">Awaiting approval / payment</span> track invoices through
          their lifecycle. Due-date and overdue reminders arrive in a later build.
        </p>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading payout reconciliation…</p>}
      {isError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Couldn't load payouts: {error?.message ?? "unknown error"}
        </div>
      )}

      {!isLoading && !isError && (
        <>
          <Section
            title="Referral partners"
            type="partner"
            rows={partnerRows}
            totals={partnerTotals}
          />
          <Section
            title="Contractors"
            type="contractor"
            rows={contractorRows}
            totals={contractorTotals}
          />
        </>
      )}
    </div>
  );
}

function Section({
  title,
  type,
  rows,
  totals,
}: {
  title: string;
  type: PayeeType;
  rows: PayoutRow[];
  totals: PayoutTotals;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile
          icon={Wallet}
          tone="amber"
          label="Payable now"
          value={formatZAR(totals.payable, { cents: true })}
        />
        <Tile
          icon={Clock3}
          tone="blue"
          label="Awaiting approval"
          value={formatZAR(totals.awaitingApproval, { cents: true })}
        />
        <Tile
          icon={ReceiptText}
          tone="teal"
          label="Awaiting payment"
          value={formatZAR(totals.awaitingPayment, { cents: true })}
        />
        <Tile
          icon={CheckCircle2}
          tone="green"
          label="Settled"
          value={formatZAR(totals.settled, { cents: true })}
        />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title={`No ${type} payouts yet`}
          description={
            type === "partner"
              ? "Partner commission appears here once a funded deal's commission becomes payable."
              : "Contractor commission appears here once FNC has been paid on a contractor's deal."
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-white">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-medium">{type === "partner" ? "Partner" : "Contractor"}</th>
                <th className="px-4 py-3 text-right font-medium">Payable now</th>
                <th className="px-4 py-3 text-right font-medium">Awaiting approval</th>
                <th className="px-4 py-3 text-right font-medium">Awaiting payment</th>
                <th className="px-4 py-3 text-right font-medium">Settled</th>
                <th className="px-4 py-3 text-right font-medium">Rejected</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.payeeId} className="border-b border-border/60 hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-brand-navy">{r.payeeName}</td>
                  <td className="px-4 py-3 text-right font-semibold text-amber-700">
                    {r.payable > 0 ? formatZAR(r.payable, { cents: true }) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right text-muted-foreground">
                    {r.awaitingApproval > 0 ? formatZAR(r.awaitingApproval, { cents: true }) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right text-muted-foreground">
                    {r.awaitingPayment > 0 ? formatZAR(r.awaitingPayment, { cents: true }) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right text-brand-green">
                    {r.settled > 0 ? formatZAR(r.settled, { cents: true }) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right text-muted-foreground">
                    {r.rejectedCount > 0 ? r.rejectedCount : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const TILE_TONES: Record<string, string> = {
  amber: "border-amber-200 bg-amber-50 text-amber-800",
  blue: "border-blue-200 bg-blue-50 text-blue-700",
  teal: "border-brand-teal/30 bg-brand-teal/5 text-brand-navy",
  green: "border-brand-green/30 bg-brand-green/5 text-brand-navy",
};

function Tile({
  icon: Icon,
  tone,
  label,
  value,
}: {
  icon: typeof Wallet;
  tone: keyof typeof TILE_TONES | string;
  label: string;
  value: string;
}) {
  return (
    <div className={"rounded-xl border p-3 " + (TILE_TONES[tone] ?? TILE_TONES.teal)}>
      <div className="flex items-center gap-1.5 text-xs font-medium">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <p className="mt-1 text-lg font-bold">{value}</p>
    </div>
  );
}
