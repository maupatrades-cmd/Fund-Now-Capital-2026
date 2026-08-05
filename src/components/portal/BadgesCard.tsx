import { Link } from "react-router-dom";
import { Award, ChevronRight } from "lucide-react";
import { useMyBadges } from "@/hooks/useBadges";
import { recentEarned, earnedCount, tierStyle } from "@/lib/badges";
import { formatRelative } from "@/lib/format";
import { BadgeMedal } from "@/components/portal/BadgeMedal";
import type { PortalKind } from "@/components/portal/PortalShell";

/*
 * "Recent Badges" home-page card for the partner + contractor portals. Shows the
 * most-recently earned badges as medals plus an "X of Y earned" progress line and
 * a link into the full collection. When nothing is earned yet, it stays warm and
 * motivational (not a dead grey box) — the first badge is one lead away.
 *
 * POPIA: everything comes from get_my_badges() (auth.uid()-scoped); no funder or
 * commission data appears here.
 */
export function BadgesCard({ portal }: { portal: PortalKind }) {
  const { data, isLoading, isError } = useMyBadges(portal);
  const badges = data ?? [];
  const recent = recentEarned(badges, 4);
  const earned = earnedCount(badges);
  const total = badges.length;

  return (
    <section className="rounded-xl border border-border bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-brand-teal/10 text-brand-teal">
            <Award className="h-4 w-4" />
          </span>
          <div>
            <h3 className="text-sm font-semibold text-brand-navy">Your badges</h3>
            {!isLoading && !isError && (
              <p className="text-xs text-muted-foreground">
                {earned} of {total} earned
              </p>
            )}
          </div>
        </div>
        <Link
          to={`/${portal}/badges`}
          className="inline-flex items-center gap-1 text-xs font-medium text-brand-teal hover:text-brand-teal/80"
        >
          View all
          <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      <div className="mt-4">
        {isLoading ? (
          <div className="flex gap-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-16 w-16 animate-pulse rounded-full bg-slate-100" />
            ))}
          </div>
        ) : isError ? (
          <p className="text-sm text-muted-foreground">Couldn't load your badges just now.</p>
        ) : recent.length === 0 ? (
          <div className="rounded-lg bg-slate-50 px-4 py-5 text-center">
            <p className="text-sm font-medium text-brand-navy">No badges yet — your first is one lead away.</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Submit a lead to earn your <span className="font-medium text-brand-navy">First Lead</span> badge.
            </p>
          </div>
        ) : (
          <ul className="flex flex-wrap gap-5">
            {recent.map((b) => (
              <li key={b.badge_id} className="flex w-16 flex-col items-center gap-1 text-center">
                <BadgeMedal badge={b} size="md" />
                <span className={`text-[11px] font-semibold ${tierStyle(b.tier).icon}`}>
                  {tierStyle(b.tier).label}
                </span>
                <span className="line-clamp-2 text-[11px] leading-tight text-muted-foreground">
                  {b.name}
                </span>
                {b.earned_at && (
                  <span className="text-[10px] text-slate-400">{formatRelative(b.earned_at)}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
