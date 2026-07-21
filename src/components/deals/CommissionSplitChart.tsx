import { useEffect, useRef, useState } from "react";
import { useCalculateCommission } from "@/hooks/useDealDetail";
import { formatZAR } from "@/lib/format";
import { pct } from "@/lib/funders";

// Animated commission split for the /calculator page. Renders a segmented SVG
// doughnut (green Partner pool 60% + teal Company retention 40%, gross in the
// centre) plus two readouts and the tiered rows below — all fed by the
// server-side calculate_commission() function (the single source of truth; the
// 60/40 proportions are read from the data, never hardcoded). Draw-in is pure
// CSS (stroke-dashoffset transition), respecting prefers-reduced-motion — gsap
// stays reserved for PriorityGlow (CLAUDE.md).
export function CommissionSplitChart({
  gross,
  isPurchaseOrder,
}: {
  gross: number | null;
  isPurchaseOrder: boolean;
}) {
  const { data, isFetching, isError, error } = useCalculateCommission(gross, isPurchaseOrder);
  const reduced = usePrefersReducedMotion();

  // Draw-in: start hidden, flip to shown on next frame so the CSS transition
  // plays. Reduced motion → shown immediately (no transition).
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    if (reduced) {
      setDrawn(true);
      return;
    }
    const id = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(id);
  }, [reduced]);

  const empty = gross == null || gross <= 0;

  if (isError) {
    return <p className="text-sm text-red-600">{(error as Error)?.message ?? "Calculation failed."}</p>;
  }

  // Geometry (constant regardless of state, so the ring shape is stable).
  const R = 70;
  const C = 2 * Math.PI * R;

  // Data-driven fractions; fall back to the engine's 60/40 for the empty ring.
  const total = empty ? 0 : gross;
  const pool = data ? Number(data.partner_pool) : 0;
  const retention = data ? Number(data.company_retention) : 0;
  const poolFrac = total > 0 ? pool / total : 0.6;
  const retFrac = total > 0 ? retention / total : 0.4;

  const poolLen = poolFrac * C;
  const retLen = retFrac * C;
  // Each segment is positioned by rotation (transform), so stroke-dashoffset is
  // free to animate the draw-in from hidden (=length) to shown (0).
  const tealRotation = -90 + poolFrac * 360;

  return (
    <div className="space-y-5">
      <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center sm:justify-center sm:gap-8">
        {/* Doughnut */}
        <svg
          viewBox="0 0 180 180"
          className={"h-44 w-44 shrink-0" + (isFetching ? " opacity-70" : "")}
          role="img"
          aria-label={
            empty
              ? "No commission entered"
              : `Gross ${formatZAR(gross)}: partner pool ${formatZAR(pool)}, company retention ${formatZAR(retention)}`
          }
        >
          {/* track */}
          <circle cx="90" cy="90" r={R} fill="none" stroke="#e6edf3" strokeWidth="22" />
          {!empty && data && (
            <>
              {/* Company retention (teal) — behind, positioned after the pool arc */}
              <circle
                cx="90"
                cy="90"
                r={R}
                fill="none"
                stroke="#2da8b8"
                strokeWidth="22"
                strokeDasharray={`${retLen} ${C}`}
                strokeDashoffset={drawn ? 0 : retLen}
                style={{
                  transform: `rotate(${tealRotation}deg)`,
                  transformOrigin: "90px 90px",
                  transition: reduced ? undefined : "stroke-dashoffset 900ms ease 250ms",
                }}
              />
              {/* Partner pool (green) — drawn from the top */}
              <circle
                cx="90"
                cy="90"
                r={R}
                fill="none"
                stroke="#5dba5d"
                strokeWidth="22"
                strokeDasharray={`${poolLen} ${C}`}
                strokeDashoffset={drawn ? 0 : poolLen}
                style={{
                  transform: "rotate(-90deg)",
                  transformOrigin: "90px 90px",
                  transition: reduced ? undefined : "stroke-dashoffset 900ms ease",
                }}
              />
            </>
          )}
          {/* centre label */}
          <text x="90" y="82" textAnchor="middle" className="fill-[#8aa0b3] text-[11px] font-medium">
            {empty ? "Total pool" : "Gross"}
          </text>
          <text x="90" y="104" textAnchor="middle" className="fill-brand-navy text-[19px] font-bold">
            {empty ? "—" : formatZAR(gross)}
          </text>
        </svg>

        {/* Readouts */}
        {empty ? (
          <p className="text-sm text-muted-foreground">Enter a gross commission to see the split.</p>
        ) : (
          data && (
            <div className="grid w-full max-w-xs grid-cols-1 gap-3 sm:w-auto">
              <Readout
                dot="#5dba5d"
                label="Partner pool"
                amount={formatZAR(pool)}
                percent={pct(poolFrac)}
              />
              <Readout
                dot="#2da8b8"
                label="Company retention"
                amount={formatZAR(retention)}
                percent={pct(retFrac)}
              />
            </div>
          )
        )}
      </div>

      {/* Tiered detail — the real split inside the partner pool. */}
      {!empty && data && (
        <div className="space-y-1.5 rounded-lg bg-slate-50 p-4 text-sm">
          <Row
            label={`Partner share (${pct(Number(data.tier_pct))} of pool)`}
            value={formatZAR(Number(data.partner_share))}
          />
          <Row label="Owner share" value={formatZAR(Number(data.owner_share))} strong />
        </div>
      )}
    </div>
  );
}

function Readout({
  dot,
  label,
  amount,
  percent,
}: {
  dot: string;
  label: string;
  amount: string;
  percent: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="mt-0.5 h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: dot }} />
      <div className="min-w-0">
        <div className="text-xs font-medium text-muted-foreground">
          {label} <span className="text-[11px]">· {percent}</span>
        </div>
        <div className="text-xl font-bold text-brand-navy">{amount}</div>
      </div>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className={strong ? "text-brand-navy" : "text-muted-foreground"}>{label}</span>
      <span className={strong ? "font-bold text-brand-navy" : "font-medium text-brand-navy"}>{value}</span>
    </div>
  );
}

// Track the OS "reduce motion" setting so the draw-in can be skipped.
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  const mqRef = useRef<MediaQueryList | null>(null);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    mqRef.current = mq;
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}
