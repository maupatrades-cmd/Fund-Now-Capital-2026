import { useCalculateCommission } from "@/hooks/useDealDetail";
import { formatZAR } from "@/lib/format";
import { pct } from "@/lib/funders";

// Renders the commission split for a gross amount using the server-side
// calculate_commission() database function (the single source of truth).
export function CommissionBreakdownView({
  gross,
  isPurchaseOrder,
}: {
  gross: number | null;
  isPurchaseOrder: boolean;
}) {
  const { data, isFetching, isError, error } = useCalculateCommission(gross, isPurchaseOrder);

  if (gross == null || gross <= 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Enter a gross commission to see the split.
      </p>
    );
  }
  if (isError) {
    return <p className="text-sm text-red-600">{(error as Error)?.message ?? "Calc failed"}</p>;
  }
  if (!data) {
    return <p className="text-sm text-muted-foreground">Calculating…</p>;
  }

  return (
    <div className={"space-y-1.5 text-sm" + (isFetching ? " opacity-60" : "")}>
      <Row label="Gross commission (X)" value={formatZAR(gross)} strong />
      <Row label="Company retention (40%)" value={formatZAR(data.company_retention)} />
      <Row label="Partner pool (60%)" value={formatZAR(data.partner_pool)} />
      <div className="my-1 border-t border-border" />
      <Row
        label={`Partner share (${pct(Number(data.tier_pct))} of pool)`}
        value={formatZAR(data.partner_share)}
      />
      <Row label="Owner share" value={formatZAR(data.owner_share)} strong />
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className={strong ? "text-brand-navy" : "text-muted-foreground"}>{label}</span>
      <span className={strong ? "font-bold text-brand-navy" : "font-medium text-brand-navy"}>
        {value}
      </span>
    </div>
  );
}
