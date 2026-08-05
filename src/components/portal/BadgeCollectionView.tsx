import { Award } from "lucide-react";
import { useMyBadges } from "@/hooks/useBadges";
import { earnedCount, tierStyle, type MyBadge } from "@/lib/badges";
import { formatRelative } from "@/lib/format";
import { BadgeMedal } from "@/components/portal/BadgeMedal";
import { EmptyState } from "@/components/ui/empty-state";
import type { PortalKind } from "@/components/portal/PortalShell";

/*
 * The full badge collection for a partner/contractor — every badge applicable to
 * their role, earned-first (get_my_badges() ordering), with a progress header.
 * Earned badges show their earned date; locked ones show how to unlock. This is
 * the Duolingo/Strava-style "trophy case": aspirational, not a grey wall.
 *
 * POPIA: get_my_badges() is auth.uid()-scoped and role-separated; no funder or
 * commission figures ever appear here.
 */
export function BadgeCollectionView({ portal }: { portal: PortalKind }) {
  const { data, isLoading, isError, refetch } = useMyBadges(portal);
  const badges = data ?? [];
  const earned = earnedCount(badges);
  const total = badges.length;
  const pct = total > 0 ? Math.round((earned / total) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold text-brand-navy">Badges</h1>
        <p className="text-sm text-muted-foreground">
          Milestones you earn as you bring in leads and grow your funded deals.
        </p>
      </div>

      {/* Progress header */}
      {!isLoading && !isError && total > 0 && (
        <div className="rounded-xl border border-border bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between text-sm">
            <span className="font-semibold text-brand-navy">
              {earned} of {total} earned
            </span>
            <span className="text-muted-foreground">{pct}%</span>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-gradient-to-r from-brand-teal to-brand-green transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl bg-slate-100" />
          ))}
        </div>
      ) : isError ? (
        <EmptyState
          icon={Award}
          title="Couldn't load your badges"
          description="Something went wrong fetching your collection."
          action={
            <button
              type="button"
              onClick={() => void refetch()}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-brand-navy hover:bg-slate-50"
            >
              Try again
            </button>
          }
        />
      ) : total === 0 ? (
        <EmptyState
          icon={Award}
          title="No badges available yet"
          description="Your badge collection will appear here."
        />
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {badges.map((b) => (
            <BadgeRow key={b.badge_id} badge={b} />
          ))}
        </ul>
      )}
    </div>
  );
}

function BadgeRow({ badge }: { badge: MyBadge }) {
  const style = tierStyle(badge.tier);
  return (
    <li
      className={
        "flex items-start gap-4 rounded-xl border p-4 shadow-sm " +
        (badge.earned ? "border-border bg-white" : "border-dashed border-slate-200 bg-slate-50/60")
      }
    >
      <BadgeMedal badge={badge} size="md" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className={"text-sm font-semibold " + (badge.earned ? "text-brand-navy" : "text-slate-500")}>
            {badge.name}
          </h3>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ring-1 ${style.pill}`}>
            {style.label}
          </span>
        </div>
        <p className={"mt-1 text-xs " + (badge.earned ? "text-muted-foreground" : "text-slate-400")}>
          {badge.description}
        </p>
        <p className="mt-2 text-[11px] font-medium">
          {badge.earned ? (
            <span className="text-brand-green">
              Earned{badge.earned_at ? ` · ${formatRelative(badge.earned_at)}` : ""}
            </span>
          ) : (
            <span className="text-slate-400">Locked</span>
          )}
        </p>
      </div>
    </li>
  );
}
