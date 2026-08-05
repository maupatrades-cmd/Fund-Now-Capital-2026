import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  Banknote,
  Wallet,
  Activity,
  TrendingUp,
  Clock,
  Inbox,
  FileText,
  CircleAlert,
  Plus,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { formatZAR, formatRelative, daysSince } from "@/lib/format";
import { stageLabel } from "@/lib/dealStages";
import {
  useDashboard,
  businessName,
  type DealRow,
  type ActivityRow,
} from "@/hooks/useDashboard";

export default function DashboardPage() {
  const { metrics, isLoading, isError, error } = useDashboard();

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">Loading dashboard…</div>;
  }
  if (isError || !metrics) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Couldn't load dashboard data: {(error as Error)?.message ?? "unknown error"}
      </div>
    );
  }

  const { kpis, pipeline, pipelineMax, actions, activity } = metrics;
  const urgentCount = actions.stuckDeals.length + actions.awaitingDecision.length + actions.fundedNotInvoiced.length;

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-brand-navy p-6 text-white shadow-sm">
        <div><p className="text-sm text-white/70">{new Date().toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "long" })}</p><h1 className="mt-1 text-2xl font-bold">Owner command centre</h1><p className="mt-1 text-sm text-white/75">{urgentCount === 0 ? "Everything is under control." : `${urgentCount} operational item${urgentCount === 1 ? "" : "s"} need attention.`}</p></div>
        <div className="flex flex-wrap gap-2"><Link to="/leads/new" className="inline-flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm font-semibold text-brand-navy"><UserPlus className="h-4 w-4" />New lead</Link><Link to="/pipeline" className="inline-flex items-center gap-2 rounded-lg border border-white/30 px-3 py-2 text-sm font-semibold text-white"><Plus className="h-4 w-4" />Open pipeline</Link></div>
      </section>
      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard
          icon={TrendingUp}
          label="Deals funded (this month)"
          value={String(kpis.fundedThisMonth)}
        />
        <KpiCard
          icon={Banknote}
          label="Gross commission (MTD)"
          value={formatZAR(kpis.grossMtd)}
        />
        <KpiCard
          icon={Wallet}
          label="Commission received / pending"
          value={formatZAR(kpis.received)}
          sub={`${formatZAR(kpis.pending)} pending`}
        />
        <KpiCard
          icon={Activity}
          label="Deals in flight"
          value={String(kpis.dealsInFlight)}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pipeline snapshot */}
        <Card title="Pipeline snapshot">
          <div className="space-y-2">
            {pipeline.map((row) => (
              <div key={row.stage} className="flex items-center gap-3">
                <div className="w-40 shrink-0 text-xs text-muted-foreground truncate">
                  {row.label}
                </div>
                <div className="flex-1 h-4 rounded bg-slate-100 overflow-hidden">
                  <div
                    className="h-full rounded bg-brand-teal transition-all"
                    style={{
                      width: `${pipelineMax > 0 ? (row.count / pipelineMax) * 100 : 0}%`,
                    }}
                  />
                </div>
                <div className="w-6 text-right text-xs font-semibold text-brand-navy">
                  {row.count}
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Actions needed */}
        <Card title="Actions needed">
          <div className="space-y-4">
            <ActionGroup
              icon={Clock}
              title="Deals stuck 5+ days"
              count={actions.stuckDeals.length}
            >
              {actions.stuckDeals.slice(0, 5).map((d) => (
                <DealLine
                  key={d.id}
                  deal={d}
                  meta={`${stageLabel(d.stage)} · ${daysSince(d.stage_entered_at)}d`}
                />
              ))}
            </ActionGroup>

            <ActionGroup
              icon={CircleAlert}
              title="Submissions awaiting decision 7+ days"
              count={actions.awaitingDecision.length}
            >
              {actions.awaitingDecision.slice(0, 5).map((s) => {
                const deal = Array.isArray(s.deal) ? s.deal[0] : s.deal;
                return (
                  <li key={s.id} className="flex items-center justify-between gap-3 py-1">
                    <Link to={deal?.id ? `/deals/${deal.id}` : "/pipeline"} className="text-sm text-brand-navy truncate hover:text-brand-teal">
                      {deal?.reference ?? "Deal"} · {businessName(deal?.client ?? null)}
                    </Link>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {daysSince(s.submitted_at ?? s.created_at)}d
                    </span>
                  </li>
                );
              })}
            </ActionGroup>

            <ActionGroup
              icon={FileText}
              title="Funded, not yet invoiced"
              count={actions.fundedNotInvoiced.length}
            >
              {actions.fundedNotInvoiced.slice(0, 5).map((d) => (
                <DealLine key={d.id} deal={d} meta={formatZAR(d.gross_commission)} />
              ))}
            </ActionGroup>
          </div>
        </Card>
      </div>

      {/* Recent activity */}
      <Card title="Recent activity">
        {activity.length === 0 ? (
          <EmptyState>No activity logged yet.</EmptyState>
        ) : (
          <ul className="divide-y divide-border">
            {activity.map((a) => (
              <ActivityLine key={a.id} item={a} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ---- small presentational pieces ----------------------------------------

function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-teal/10 text-brand-teal">
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <div className="mt-3 text-2xl font-bold text-brand-navy">{value}</div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-white p-5 shadow-sm">
      <h2 className="mb-4 text-sm font-semibold text-brand-navy">{title}</h2>
      {children}
    </section>
  );
}

function ActionGroup({
  icon: Icon,
  title,
  count,
  children,
}: {
  icon: LucideIcon;
  title: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-brand-teal" />
        <span className="text-sm font-medium text-brand-navy">{title}</span>
        <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-brand-navy">
          {count}
        </span>
      </div>
      {count === 0 ? (
        <p className="mt-1 pl-6 text-xs text-muted-foreground">
          None — you're all caught up.
        </p>
      ) : (
        <ul className="mt-1 pl-6">{children}</ul>
      )}
    </div>
  );
}

function DealLine({ deal, meta }: { deal: DealRow; meta: string }) {
  return (
    <li className="flex items-center justify-between gap-3 py-1">
      <Link to={`/deals/${deal.id}`} className="text-sm text-brand-navy truncate hover:text-brand-teal">
        {deal.reference ?? "Deal"} · {businessName(deal.client)}
      </Link>
      <span className="text-xs text-muted-foreground shrink-0">{meta}</span>
    </li>
  );
}

function ActivityLine({ item }: { item: ActivityRow }) {
  return (
    <li className="flex items-start gap-3 py-2.5">
      <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-slate-100 text-brand-navy">
        <Inbox className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm text-brand-navy truncate">
          {item.subject || item.body || item.channel}
        </div>
        <div className="text-xs text-muted-foreground">
          {businessName(item.client)} · {formatRelative(item.occurred_at)}
        </div>
      </div>
    </li>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="py-8 text-center text-sm text-muted-foreground">{children}</div>
  );
}
