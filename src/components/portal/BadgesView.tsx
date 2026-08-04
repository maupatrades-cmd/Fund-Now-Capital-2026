import { Award } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatRelative } from "@/lib/format";
import { BadgeMedallion } from "@/components/badges/BadgeMedallion";
import { tierStyle } from "@/lib/badges";
import { useMyBadges, earnedCount } from "@/hooks/useBadges";

/*
 * Full badge collection view for the contractor + partner portals (Sprint 5
 * Lane 5c) — the /{portal}/badges route. Renders EVERY badge applicable to the
 * caller's role: earned badges in full colour, locked ones muted, so it reads as
 * an aspirational ladder. Ordering comes straight from get_my_badges() (earned
 * first, then catalog order). POPIA-safe: the RPC only ever returns the caller's
 * own collection.
 */
export function BadgesView() {
  const { data: badges, isPending, isError } = useMyBadges();
  const total = badges?.length ?? 0;
  const earned = earnedCount(badges);
  const pct = total > 0 ? Math.round((earned / total) * 100) : 0;

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-brand-navy">
          <Award className="h-6 w-6 text-brand-teal" />
          Badges
        </h1>
        <p className="text-sm text-muted-foreground">
          Milestones you unlock as you bring in leads and close deals. Keep going — every
          badge is a real step forward.
        </p>
      </header>

      {isPending ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-40 animate-pulse rounded-xl border border-border bg-slate-50" />
          ))}
        </div>
      ) : isError ? (
        <div className="rounded-xl border border-border bg-white p-8 text-center text-sm text-muted-foreground shadow-sm">
          Couldn’t load your badges just now. Please try again.
        </div>
      ) : total === 0 ? (
        <div className="rounded-xl border border-border bg-white p-8 text-center shadow-sm">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-brand-teal/10 text-brand-teal">
            <Award className="h-6 w-6" />
          </span>
          <h3 className="mt-3 text-base font-semibold text-brand-navy">No badges available yet</h3>
          <p className="mt-1 text-sm text-muted-foreground">Check back soon.</p>
        </div>
      ) : (
        <>
          {/* Progress summary */}
          <div className="rounded-xl border border-border bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-brand-navy">
                {earned} of {total} earned
              </span>
              <span className="text-muted-foreground">{pct}%</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-gradient-to-r from-brand-teal to-brand-green transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>

          {/* Grid */}
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {badges!.map((badge) => {
              const style = tierStyle(badge.tier);
              return (
                <li
                  key={badge.badge_id}
                  className={cn(
                    "flex flex-col items-center gap-2 rounded-xl border bg-white p-4 text-center shadow-sm transition-colors",
                    badge.earned ? "border-border" : "border-dashed border-slate-200",
                  )}
                >
                  <BadgeMedallion badge={badge} size="md" />
                  <div className="mt-1 space-y-1">
                    <p
                      className={cn(
                        "text-sm font-semibold",
                        badge.earned ? "text-brand-navy" : "text-slate-400",
                      )}
                    >
                      {badge.name}
                    </p>
                    <span
                      className={cn(
                        "inline-block rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                        badge.earned ? style.chip : "bg-slate-100 text-slate-400",
                      )}
                    >
                      {style.label}
                    </span>
                  </div>
                  <p
                    className={cn(
                      "text-xs leading-snug",
                      badge.earned ? "text-muted-foreground" : "text-slate-400",
                    )}
                  >
                    {badge.description}
                  </p>
                  {badge.earned && badge.earned_at && (
                    <p className="mt-auto pt-1 text-[10px] font-medium text-brand-green">
                      Earned {formatRelative(badge.earned_at)}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
