import { TrendingUp, Award, CheckCircle2, Circle, ListChecks, Briefcase } from "lucide-react";
import PortalShell from "@/components/portal/PortalShell";
import { useMyProgression } from "@/hooks/useContractorProgression";
import {
  LEVEL_ORDER,
  LEVEL_LABEL,
  REIMBURSEMENT_ZAR,
  NEXT_LEVEL_THRESHOLD,
  computeLevelProgress,
  type ProgressionData,
  type ProgressionLevel,
} from "@/lib/progression";
import { formatZAR, formatRelative } from "@/lib/format";

// Full contractor-facing progression detail. Current level + reimbursement, the
// live progress bars toward the next level, a promotion history, and the whole
// level ladder with its reimbursement + (provisional) targets. FNC gross is
// never shown (S7C) — the server omits it from the contractor view.
export default function ContractorProgressionPage() {
  const { data, isLoading, isError } = useMyProgression();

  return (
    <PortalShell portal="contractor">
      <div className="flex items-center gap-2">
        <span className="grid h-10 w-10 place-items-center rounded-full bg-brand-navy/5 text-brand-navy">
          <TrendingUp className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-2xl font-bold text-brand-navy">My Progress</h1>
          <p className="text-sm text-muted-foreground">
            Your level, reimbursement, and the road to the next one.
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="h-40 animate-pulse rounded-xl bg-slate-100" />
      ) : isError || !data ? (
        <div className="rounded-xl border border-border bg-white p-8 text-center text-sm text-muted-foreground shadow-sm">
          Couldn't load your progression right now. Please refresh.
        </div>
      ) : (
        <div className="space-y-6">
          <CurrentLevelPanel data={data} />
          <NextLevelPanel data={data} />
          <HistoryPanel data={data} />
          <LadderPanel level={data.current_level} />
          <p className="text-xs text-muted-foreground">
            Level-ups are approved by the Fund Now Capital team. Keep submitting quality leads and
            closing deals — your progress is tracked here automatically.
          </p>
        </div>
      )}
    </PortalShell>
  );
}

function CurrentLevelPanel({ data }: { data: ProgressionData }) {
  const level = data.current_level;
  return (
    <div className="rounded-xl border border-border bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Current level</p>
          <div className="mt-1 flex items-center gap-2">
            <Award className="h-6 w-6 text-brand-teal" />
            <span className="text-2xl font-bold text-brand-navy">{LEVEL_LABEL[level]}</span>
          </div>
        </div>
        <div className="text-right">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Monthly reimbursement</p>
          <p className="mt-1 text-2xl font-bold text-brand-navy">{formatZAR(REIMBURSEMENT_ZAR[level])}</p>
          <p className="text-xs text-muted-foreground">petrol · airtime · data</p>
        </div>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3">
        <MetricTile icon={ListChecks} label="Leads submitted" value={data.metrics.leads_submitted} />
        <MetricTile icon={Briefcase} label="Deals funded" value={data.metrics.deals_funded} />
      </div>
    </div>
  );
}

function MetricTile({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof ListChecks;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-lg border border-border bg-slate-50 p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <p className="mt-1 text-xl font-bold text-brand-navy">{value}</p>
    </div>
  );
}

function NextLevelPanel({ data }: { data: ProgressionData }) {
  const prog = computeLevelProgress(data);
  if (!prog.next || !prog.threshold) {
    return (
      <div className="rounded-xl border border-brand-green/30 bg-brand-green/5 p-6 text-center shadow-sm">
        <p className="text-base font-semibold text-brand-green">
          You've reached the top level — Level 3. 🎉
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Keep up the great work. The team may recognise standout performance in other ways too.
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-border bg-white p-6 shadow-sm">
      <p className="text-sm font-semibold text-brand-navy">
        Progress to {LEVEL_LABEL[prog.next]}
      </p>
      <p className="text-xs text-muted-foreground">
        {formatZAR(REIMBURSEMENT_ZAR[prog.next])} / month at the next level
      </p>

      <div className="mt-4 space-y-4">
        <ProgressRow
          label="Leads submitted"
          have={data.metrics.leads_submitted}
          need={prog.threshold.leads_submitted}
          pct={prog.leadsPct}
        />
        <ProgressRow
          label="Deals funded"
          have={data.metrics.deals_funded}
          need={prog.threshold.deals_funded}
          pct={prog.dealsPct}
        />
      </div>

      {prog.metThreshold && (
        <p className="mt-4 rounded-lg bg-brand-teal/10 px-3 py-2 text-xs font-medium text-brand-teal">
          You've hit the targets for {LEVEL_LABEL[prog.next]} — the team reviews level-ups and will be
          in touch.
        </p>
      )}
    </div>
  );
}

function ProgressRow({
  label,
  have,
  need,
  pct,
}: {
  label: string;
  have: number;
  need: number;
  pct: number;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium text-brand-navy">
          {have} / {need}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-brand-teal transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function HistoryPanel({ data }: { data: ProgressionData }) {
  const events: { key: string; at: string | null; label: string }[] = [
    { key: "Base", at: data.activated_at, label: "Activated at Base" },
    { key: "1", at: data.promoted_at_l1, label: "Promoted to Level 1" },
    { key: "2", at: data.promoted_at_l2, label: "Promoted to Level 2" },
    { key: "3", at: data.promoted_at_l3, label: "Promoted to Level 3" },
  ].filter((e) => e.at);

  if (events.length === 0) return null;

  return (
    <div className="rounded-xl border border-border bg-white p-6 shadow-sm">
      <p className="text-sm font-semibold text-brand-navy">Progression history</p>
      <ul className="mt-3 space-y-2">
        {events.map((e) => (
          <li key={e.key} className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="h-4 w-4 text-brand-green" />
            <span className="text-brand-navy">{e.label}</span>
            <span className="ml-auto text-xs text-muted-foreground">{formatRelative(e.at)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function LadderPanel({ level }: { level: ProgressionLevel }) {
  const currentIdx = LEVEL_ORDER.indexOf(level);
  return (
    <div className="rounded-xl border border-border bg-white p-6 shadow-sm">
      <p className="text-sm font-semibold text-brand-navy">The level ladder</p>
      <div className="mt-3 space-y-2">
        {LEVEL_ORDER.map((lvl, idx) => {
          const isCurrent = idx === currentIdx;
          const isDone = idx < currentIdx;
          const threshold =
            lvl !== "3" ? NEXT_LEVEL_THRESHOLD[lvl as Exclude<ProgressionLevel, "3">] : null;
          return (
            <div
              key={lvl}
              className={
                "flex items-center gap-3 rounded-lg border p-3 " +
                (isCurrent ? "border-brand-teal bg-brand-teal/5" : "border-border")
              }
            >
              {isDone ? (
                <CheckCircle2 className="h-5 w-5 shrink-0 text-brand-green" />
              ) : isCurrent ? (
                <Award className="h-5 w-5 shrink-0 text-brand-teal" />
              ) : (
                <Circle className="h-5 w-5 shrink-0 text-slate-300" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-brand-navy">{LEVEL_LABEL[lvl]}</p>
                {threshold && (
                  <p className="text-xs text-muted-foreground">
                    Targets next level: {threshold.leads_submitted} leads · {threshold.deals_funded}{" "}
                    deals funded
                  </p>
                )}
              </div>
              <span className="shrink-0 text-sm font-semibold text-brand-navy">
                {formatZAR(REIMBURSEMENT_ZAR[lvl])}
                <span className="text-xs font-normal text-muted-foreground">/mo</span>
              </span>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground">
        Targets are a guide — the Fund Now Capital team approves each level-up.
      </p>
    </div>
  );
}
