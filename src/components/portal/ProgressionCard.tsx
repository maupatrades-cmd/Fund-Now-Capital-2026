import { Link } from "react-router-dom";
import { TrendingUp, ChevronRight, Award } from "lucide-react";
import { useMyProgression } from "@/hooks/useContractorProgression";
import {
  LEVEL_LABEL,
  REIMBURSEMENT_ZAR,
  computeLevelProgress,
  type ProgressionData,
} from "@/lib/progression";
import { formatZAR } from "@/lib/format";

// Compact progression card for the contractor portal home. Shows the current
// level, its monthly reimbursement reference, and a single progress bar toward
// the next level. Deep-links to the full detail view. FNC gross is never shown
// here (S7C) — the server already omits it from the contractor view.
export default function ProgressionCard() {
  const { data, isLoading, isError } = useMyProgression();

  return (
    <div className="rounded-xl border border-border bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-brand-navy/5 text-brand-navy">
            <TrendingUp className="h-5 w-5" />
          </span>
          <div>
            <h3 className="text-sm font-semibold text-brand-navy">My progression</h3>
            <p className="text-xs text-muted-foreground">Your level and monthly reimbursement</p>
          </div>
        </div>
        <Link
          to="/contractor/progression"
          className="inline-flex items-center gap-0.5 text-xs font-medium text-brand-teal hover:underline"
        >
          Details <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      <div className="mt-4">
        {isLoading ? (
          <div className="h-16 animate-pulse rounded-lg bg-slate-100" />
        ) : isError || !data ? (
          <p className="text-sm text-muted-foreground">Couldn't load your progression right now.</p>
        ) : (
          <ProgressionSummary data={data} />
        )}
      </div>
    </div>
  );
}

function ProgressionSummary({ data }: { data: ProgressionData }) {
  const prog = computeLevelProgress(data);
  const level = data.current_level;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-teal/10 px-3 py-1 text-sm font-semibold text-brand-teal">
          <Award className="h-4 w-4" />
          {LEVEL_LABEL[level]}
        </span>
        <span className="text-sm text-brand-navy">
          <span className="font-semibold">{formatZAR(REIMBURSEMENT_ZAR[level])}</span>
          <span className="text-muted-foreground"> / month reimbursement</span>
        </span>
      </div>

      {prog.next ? (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Progress to {LEVEL_LABEL[prog.next]}</span>
            <span className="font-medium text-brand-navy">{prog.overallPct}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-brand-teal transition-all"
              style={{ width: `${prog.overallPct}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {data.metrics.leads_submitted}/{prog.threshold?.leads_submitted} leads ·{" "}
            {data.metrics.deals_funded}/{prog.threshold?.deals_funded} deals funded
          </p>
        </div>
      ) : (
        <p className="text-sm font-medium text-brand-green">
          You've reached the top level. 🎉
        </p>
      )}
    </div>
  );
}
