import { Link } from "react-router-dom";
import { Award, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatRelative } from "@/lib/format";
import { BadgeMedallion } from "@/components/badges/BadgeMedallion";
import { useMyBadges, recentEarned, earnedCount } from "@/hooks/useBadges";
import type { PortalKind } from "@/components/portal/PortalShell";

/*
 * "Recent Badges" home-card for the contractor + partner portals (Sprint 5 Lane
 * 5c). Shows the most recently earned badges with a link to the full collection.
 * Before any badge is earned it renders an encouraging empty state rather than a
 * blank card — the whole point is motivation.
 *
 * Shared file with PROGRESSION + TRAINING on ContractorHomePage: this card is a
 * self-contained content-stack block, so the merge overlap stays a clean union.
 */
export function RecentBadgesCard({ portal }: { portal: PortalKind }) {
  const { data: badges, isPending, isError } = useMyBadges();
  const recent = recentEarned(badges, 3);
  const total = earnedCount(badges);
  const collectionHref = `/${portal}/badges`;

  return (
    <section className="rounded-xl border border-border bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-brand-teal/10 text-brand-teal">
            <Award className="h-4 w-4" />
          </span>
          <h2 className="text-base font-semibold text-brand-navy">Your badges</h2>
          {total > 0 && (
            <span className="rounded-full bg-brand-green/10 px-2 py-0.5 text-xs font-medium text-brand-green">
              {total} earned
            </span>
          )}
        </div>
        <Link
          to={collectionHref}
          className="inline-flex items-center gap-0.5 text-sm font-medium text-brand-teal hover:text-brand-teal/80"
        >
          View all
          <ChevronRight className="h-4 w-4" />
        </Link>
      </div>

      <div className="mt-4">
        {isPending ? (
          <div className="flex gap-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-12 w-12 animate-pulse rounded-full bg-slate-100" />
            ))}
          </div>
        ) : isError ? (
          <p className="text-sm text-muted-foreground">Couldn’t load your badges just now.</p>
        ) : recent.length === 0 ? (
          <div className="flex items-center gap-3 rounded-lg bg-slate-50 px-4 py-3">
            <Award className="h-5 w-5 shrink-0 text-brand-teal" />
            <p className="text-sm text-muted-foreground">
              No badges yet — submit your first lead to earn one. Every milestone you hit
              shows up here.
            </p>
          </div>
        ) : (
          <ul className="flex flex-wrap gap-5">
            {recent.map((badge) => (
              <li key={badge.badge_id} className="flex w-20 flex-col items-center text-center">
                <BadgeMedallion badge={badge} size="sm" />
                <span className={cn("mt-1.5 line-clamp-2 text-xs font-medium text-brand-navy")}>
                  {badge.name}
                </span>
                {badge.earned_at && (
                  <span className="text-[10px] text-muted-foreground">
                    {formatRelative(badge.earned_at)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
