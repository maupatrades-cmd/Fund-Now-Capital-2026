import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Modal } from "@/components/ui/modal";
import { Badge } from "@/components/ui/badge";
import { EarningStateChip } from "./EarningStateChip";
import { formatZAR, formatRelative } from "@/lib/format";
import { formatInvoiceDate } from "@/lib/invoices";
import { EARNING_STATE_META, type EarningRow } from "@/lib/partnerEarnings";

// Drill-down for one earning. Owner view — shows the full 40/60/tier breakdown
// for a commission (this is the ONLY place the breakdown surfaces; the table
// headline is the partner's share). Bonus rows show the reason instead.
export function EarningDetailModal({ row, onClose }: { row: EarningRow; onClose: () => void }) {
  const b = row.breakdown;
  return (
    <Modal title={row.kind === "bonus" ? "Bonus detail" : "Commission detail"} onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-4 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <EarningStateChip state={row.state} />
          {row.kind === "bonus" && (
            <Badge className="bg-violet-100 text-violet-700 ring-1 ring-inset ring-violet-500/30">Bonus</Badge>
          )}
          <span className="ml-auto text-lg font-bold text-brand-navy">
            {formatZAR(row.amount, { cents: true })}
          </span>
        </div>

        <p className="text-xs text-muted-foreground">{EARNING_STATE_META[row.state]?.help}</p>

        <dl className="grid grid-cols-3 gap-x-3 gap-y-2">
          <Field label="Partner" value={row.partnerName ?? "—"} />
          <Field
            label="Deal"
            value={
              <Link to={`/deals/${row.dealId}`} className="font-medium text-brand-teal hover:underline">
                {row.dealReference ?? "View deal"}
              </Link>
            }
          />
          <Field label="Client" value={row.clientName ?? "—"} />
          <Field label="Funder" value={row.funderName ?? "—"} />
          <Field
            label={row.kind === "bonus" ? "Amount" : "Partner share"}
            value={formatZAR(row.amount, { cents: true })}
          />
          {row.kind === "bonus" && <Field label="Reason" value={row.reason ?? "—"} span={3} />}
        </dl>

        {b && (
          <div className="rounded-lg border border-border bg-slate-50 p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Commission breakdown{b.isPurchaseOrder ? " · Purchase order" : ""}
            </p>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5">
              <Money label="Gross commission" value={b.gross} strong />
              <Money label={`Partner share (${b.tierPct}%)`} value={b.partnerShare} strong />
              <Money label="Company retention (40%)" value={b.companyRetention} />
              <Money label="Partner pool (60%)" value={b.partnerPool} />
              <Money label="Owner share" value={b.ownerShare} />
            </dl>
          </div>
        )}

        <div className="rounded-lg border border-border p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Lifecycle</p>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
            <Stamp label="Earned" iso={row.earnedAt} />
            <Stamp label="Outstanding" iso={row.outstandingAt} />
            <Stamp label="Payable" iso={row.payableAt} />
            <Stamp label="Settled" iso={row.settledAt} />
          </dl>
        </div>

        {row.kind === "commission" && row.reason && (
          <Field label="Notes" value={row.reason} span={3} />
        )}

        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-slate-50"
          >
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}

function Field({
  label,
  value,
  span = 1,
}: {
  label: string;
  value: ReactNode;
  span?: 1 | 3;
}) {
  return (
    <div className={span === 3 ? "col-span-3" : ""}>
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="text-brand-navy">{value}</dd>
    </div>
  );
}

function Money({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <>
      <dt className={"text-muted-foreground" + (strong ? " font-semibold text-brand-navy" : "")}>{label}</dt>
      <dd className={"text-right tabular-nums" + (strong ? " font-semibold text-brand-navy" : " text-muted-foreground")}>
        {formatZAR(value, { cents: true })}
      </dd>
    </>
  );
}

function Stamp({ label, iso }: { label: string; iso: string | null }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right text-brand-navy">
        {iso ? `${formatInvoiceDate(iso)} · ${formatRelative(iso)}` : "—"}
      </dd>
    </>
  );
}
