import { Link } from "react-router-dom";
import {
  ArrowRight,
  BriefcaseBusiness,
  CheckCircle2,
  Clock3,
  ListChecks,
  PlusCircle,
  RefreshCw,
} from "lucide-react";
import { BadgesCard } from "@/components/portal/BadgesCard";
import {
  DEAL_STATUS_BADGE,
  dealStatus,
  type PortalDealStatus,
  usePortalDeals,
} from "@/hooks/usePortalDeals";
import { leadStatus, usePortalLeads } from "@/hooks/usePortalLeads";
import { cn } from "@/lib/utils";

const PIPELINE_STAGES: PortalDealStatus[] = [
  "New",
  "Qualified",
  "Submitted",
  "Approved",
  "Funded",
  "Declined",
];

const QUICK_ACTIONS = [
  ["/partner/submit-lead", "Capture a lead", "Send a new funding opportunity to FNC"],
  ["/partner/leads", "Review my leads", "See qualification progress and outcomes"],
  ["/partner/statements", "Open statements", "View your existing settlement records"],
] as const;

function shortDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-ZA", { day: "2-digit", month: "short" }).format(date);
}

function todayLabel(): string {
  return new Intl.DateTimeFormat("en-ZA", {
    weekday: "long",
    day: "2-digit",
    month: "long",
  })
    .format(new Date())
    .toLocaleUpperCase("en-ZA");
}

function MetricCard({
  label,
  value,
  note,
  icon: Icon,
}: {
  label: string;
  value: string;
  note: string;
  icon: typeof BriefcaseBusiness;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
          <p className="mt-3 text-3xl font-bold text-[#13283d]">{value}</p>
          <p className="mt-1 text-xs text-slate-500">{note}</p>
        </div>
        <span className="rounded-xl bg-[#fdf3dc] p-2.5 text-[#b26f11]">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
      </div>
    </div>
  );
}

export function BrightDestinyPartnerDashboard({
  displayName,
  identityLoading,
}: {
  displayName: string;
  identityLoading: boolean;
}) {
  const leads = usePortalLeads("partner");
  const deals = usePortalDeals("partner");
  const leadRows = leads.data ?? [];
  const dealRows = deals.data ?? [];
  const loading = identityLoading || leads.isLoading || deals.isLoading;
  const loadError = leads.isError || deals.isError;

  const stageCounts = Object.fromEntries(
    PIPELINE_STAGES.map((stage) => [
      stage,
      dealRows.filter((deal) => dealStatus(deal.current_stage) === stage).length,
    ]),
  ) as Record<PortalDealStatus, number>;

  const underReview = leadRows.filter(
    (lead) => leadStatus(lead.qualification_stage) === "Under Review",
  ).length;
  const dealsInFlight = dealRows.filter((deal) => {
    const status = dealStatus(deal.current_stage);
    return status !== "Funded" && status !== "Declined";
  }).length;
  const metric = (value: number) => (loading || loadError ? "—" : String(value));
  const maxStageCount = Math.max(...PIPELINE_STAGES.map((stage) => stageCounts[stage]), 1);
  const recentDeals = [...dealRows]
    .sort((a, b) => b.submitted_at.localeCompare(a.submitted_at))
    .slice(0, 5);

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-2xl bg-gradient-to-r from-[#102c45] to-[#173b5a] shadow-lg">
        <div className="grid gap-6 p-6 sm:p-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#f1b91d]">{todayLabel()}</p>
            <h1 className="mt-3 font-serif text-3xl font-semibold text-white sm:text-4xl">
              {identityLoading ? "Welcome" : `Welcome back, ${displayName}`}
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
              {loading || loadError
                ? "Your Fund Now Capital partner pipeline is loading."
                : `${dealsInFlight} ${dealsInFlight === 1 ? "deal is" : "deals are"} currently moving through your funding pipeline.`}
            </p>
          </div>

          <div className="flex flex-wrap gap-3 lg:justify-end">
              <Link
                to="/partner/submit-lead"
                className="inline-flex items-center gap-2 rounded-xl border border-[#dca423]/60 px-5 py-3 text-sm font-bold text-[#ffd438] transition hover:bg-[#dca423]/10"
              >
                <PlusCircle className="h-4 w-4" />
                New lead
              </Link>
              <Link
                to="/partner/deals"
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#ffd438] to-[#c9830d] px-5 py-3 text-sm font-bold text-[#10283f] transition hover:brightness-105"
              >
                Open pipeline
                <ArrowRight className="h-4 w-4" />
              </Link>
          </div>
        </div>
      </section>

      {loadError && (
        <div role="alert" className="flex items-center justify-between gap-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span>Some partner dashboard information could not be loaded.</span>
          <button
            type="button"
            onClick={() => {
              void leads.refetch();
              void deals.refetch();
            }}
            className="inline-flex items-center gap-2 font-semibold hover:text-red-900"
          >
            <RefreshCw className="h-4 w-4" /> Retry
          </button>
        </div>
      )}

      <section aria-label="Partner summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Funded deals" value={metric(stageCounts.Funded)} note="Completed on your partner book" icon={CheckCircle2} />
        <MetricCard label="Deals in flight" value={metric(dealsInFlight)} note="Still moving through funding" icon={BriefcaseBusiness} />
        <MetricCard label="Leads under review" value={metric(underReview)} note="Being qualified by Fund Now" icon={Clock3} />
        <MetricCard label="Total leads" value={metric(leadRows.length)} note="Submitted through your portal" icon={ListChecks} />
      </section>

      <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(300px,0.8fr)]">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-[#13283d]">Pipeline snapshot</h2>
              <p className="text-xs text-slate-500">Your privacy-safe partner pipeline</p>
            </div>
            <Link to="/partner/deals" className="text-sm font-semibold text-[#b26f11] hover:text-[#13283d]">View all</Link>
          </div>
          <div className="mt-5 space-y-3">
            {PIPELINE_STAGES.map((stage) => (
              <div key={stage} className="grid grid-cols-[86px_minmax(0,1fr)_28px] items-center gap-3 text-sm">
                <span className="text-slate-600">{stage}</span>
                <span className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                  <span
                    className="block h-full rounded-full bg-gradient-to-r from-[#dca423] to-[#f8d640]"
                    style={{ width: loadError ? "0%" : `${(stageCounts[stage] / maxStageCount) * 100}%` }}
                  />
                </span>
                <span className="text-right font-bold text-[#13283d]">{loading || loadError ? "—" : stageCounts[stage]}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <h2 className="text-lg font-bold text-[#13283d]">Quick actions</h2>
          <p className="text-xs text-slate-500">Continue work on your partner book</p>
          <div className="mt-5 space-y-3">
            {QUICK_ACTIONS.map(([to, title, description]) => (
              <Link key={to} to={to} className="flex items-center justify-between rounded-xl border border-slate-200 p-4 transition hover:border-[#dca423] hover:bg-[#fdf3dc]/40">
                <span>
                  <span className="block text-sm font-bold text-[#13283d]">{title}</span>
                  <span className="mt-1 block text-xs text-slate-500">{description}</span>
                </span>
                <ArrowRight className="h-4 w-4 text-[#b26f11]" />
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-[#13283d]">Recent deals</h2>
            <p className="text-xs text-slate-500">Only deals attributed to your signed-in partner account</p>
          </div>
          <Link to="/partner/deals" className="text-sm font-semibold text-[#b26f11] hover:text-[#13283d]">Open pipeline</Link>
        </div>

        {loading ? (
          <div className="mt-5 h-28 animate-pulse rounded-xl bg-slate-100" />
        ) : loadError ? (
          <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-5 py-8 text-center">
            <p className="text-sm font-semibold text-red-700">Recent deals are temporarily unavailable</p>
            <p className="mt-1 text-xs text-red-600">Use Retry above before relying on this list.</p>
          </div>
        ) : dealRows.length === 0 ? (
          <div className="mt-5 rounded-xl border border-dashed border-slate-300 px-5 py-8 text-center">
            <p className="text-sm font-semibold text-[#13283d]">No partner deals yet</p>
            <p className="mt-1 text-xs text-slate-500">Qualified referrals will appear here automatically.</p>
          </div>
        ) : (
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-slate-200 text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="pb-3 font-semibold">Deal</th><th className="pb-3 font-semibold">Client</th>
                  <th className="pb-3 font-semibold">Stage</th><th className="pb-3 font-semibold">Funding panel</th>
                  <th className="pb-3 text-right font-semibold">Submitted</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recentDeals.map((deal) => {
                  const status = dealStatus(deal.current_stage);
                  return (
                    <tr key={deal.deal_id}>
                      <td className="py-4 font-bold text-[#13283d]">{deal.deal_reference ?? "Pending"}</td>
                      <td className="py-4 text-slate-700">{deal.client_business_name}</td>
                      <td className="py-4"><span className={cn("inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset", DEAL_STATUS_BADGE[status])}>{status}</span></td>
                      <td className="py-4 text-slate-600">{deal.anonymized_funder_name ?? "FNC funding panel"}</td>
                      <td className="py-4 text-right text-slate-500">{shortDate(deal.submitted_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <BadgesCard portal="partner" />
    </div>
  );
}
