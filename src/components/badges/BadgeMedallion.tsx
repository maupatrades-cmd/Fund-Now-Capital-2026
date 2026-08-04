import { Lock, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { badgeIcon, tierStyle, type MyBadge } from "@/lib/badges";

/*
 * A single badge medallion — the shared visual for the home card + the full
 * collection view. Earned badges wear their full tier colours with a subtle
 * sparkle accent (the ONLY celebration this lane ships — no confetti, no gsap,
 * per the brief). Locked badges are rendered greyscale + muted with a small lock,
 * so the collection reads as an aspirational ladder (Duolingo/Strava style).
 */
export function BadgeMedallion({
  badge,
  size = "md",
}: {
  badge: MyBadge;
  size?: "sm" | "md";
}) {
  const Icon = badgeIcon(badge.icon_name);
  const style = tierStyle(badge.tier);
  const earned = badge.earned;

  const dim = size === "sm" ? "h-12 w-12" : "h-16 w-16";
  const iconDim = size === "sm" ? "h-6 w-6" : "h-8 w-8";

  return (
    <div className="relative">
      <span
        aria-hidden="true"
        className={cn(
          "grid place-items-center rounded-full ring-2 transition-all",
          dim,
          earned ? cn(style.bg, style.ring) : "bg-slate-100 ring-slate-200",
        )}
      >
        <Icon
          className={cn(iconDim, earned ? style.icon : "text-slate-300")}
          strokeWidth={1.75}
        />
      </span>

      {/* Subtle sparkle on earned badges — a soft pulse, nothing loud. */}
      {earned && (
        <Sparkles
          aria-hidden="true"
          className="absolute -right-0.5 -top-0.5 h-4 w-4 animate-pulse text-amber-400"
          strokeWidth={2}
        />
      )}

      {/* Lock marker on locked badges. role=img + aria-label so a screen reader
          announces the locked state; the SVG itself is decorative. */}
      {!earned && (
        <span
          role="img"
          aria-label="Locked badge"
          className="absolute -bottom-0.5 -right-0.5 grid h-5 w-5 place-items-center rounded-full bg-white ring-1 ring-slate-200"
        >
          <Lock aria-hidden="true" className="h-3 w-3 text-slate-400" strokeWidth={2} />
        </span>
      )}
    </div>
  );
}
