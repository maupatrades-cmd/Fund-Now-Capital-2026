import { Lock, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { badgeIcon, tierStyle, type MyBadge } from "@/lib/badges";

/*
 * A single badge "medal" — a tiered gradient disc with the badge's icon.
 *   * Earned  → full-colour disc + a subtle corner sparkle (the ONLY celebration
 *               effect on this surface; the brief calls for a subtle sparkle, not
 *               confetti or PriorityGlow).
 *   * Locked  → desaturated/muted disc + a small lock, so the collection reads as
 *               an aspirational set rather than a wall of greyed-out unknowns.
 */
export function BadgeMedal({
  badge,
  size = "md",
  sparkle = true,
}: {
  badge: MyBadge;
  size?: "sm" | "md";
  sparkle?: boolean;
}) {
  const style = tierStyle(badge.tier);
  const Icon = badgeIcon(badge.icon_name);
  const dim = size === "sm" ? "h-12 w-12" : "h-16 w-16";
  const iconDim = size === "sm" ? "h-6 w-6" : "h-8 w-8";

  return (
    <div className={cn("relative shrink-0", dim)}>
      <div
        className={cn(
          "flex h-full w-full items-center justify-center rounded-full ring-2 shadow-sm",
          badge.earned
            ? style.disc
            : "bg-slate-100 ring-slate-200",
        )}
        aria-hidden="true"
      >
        <Icon
          className={cn(iconDim, badge.earned ? style.icon : "text-slate-300")}
          strokeWidth={1.75}
        />
      </div>

      {/* Earned → subtle corner sparkle. Locked → small lock. */}
      {badge.earned ? (
        sparkle && (
          <Sparkles
            className="absolute -right-0.5 -top-0.5 h-4 w-4 animate-pulse text-amber-400 drop-shadow"
            aria-hidden="true"
          />
        )
      ) : (
        <span
          role="img"
          aria-label="Locked badge"
          className="absolute -bottom-0.5 -right-0.5 grid h-5 w-5 place-items-center rounded-full bg-white ring-1 ring-slate-200"
        >
          <Lock className="h-3 w-3 text-slate-400" aria-hidden="true" />
        </span>
      )}
    </div>
  );
}
