// Gamification badge presentation helpers (Sprint 5, Lane 5c).
//
// The single data contract is the SECURITY DEFINER `get_my_badges()` RPC, which
// returns EVERY badge applicable to the signed-in partner/contractor with its
// earned state (earned-first, then sort_order, then name). Nothing here reveals
// funder identity or commission math — badges are motivational only (POPIA-safe).
import {
  Award,
  Medal,
  Trophy,
  Star,
  Sprout,
  Rocket,
  Coins,
  Banknote,
  Gem,
  BadgeCheck,
  RefreshCw,
  Target,
  TrendingUp,
  Flame,
  Crown,
  Zap,
  Sparkles,
  HandCoins,
  PiggyBank,
  Handshake,
  CalendarCheck,
  type LucideIcon,
} from "lucide-react";

export type BadgeTier = "bronze" | "silver" | "gold" | "platinum";

// One row of get_my_badges(). `tier` arrives as the badge_tier enum's text.
export type MyBadge = {
  badge_id: string;
  code: string;
  name: string;
  description: string;
  icon_name: string;
  color_class: string;
  tier: BadgeTier;
  sort_order: number;
  earned: boolean;
  earned_at: string | null;
  context: Record<string, unknown> | null;
};

// icon_name (stored on the badge) → lucide icon. Broad, forgiving map keyed by
// the exact lucide component name so the DB can add badges without a frontend
// change; anything unmapped falls back to a generic Award medal.
const ICONS: Record<string, LucideIcon> = {
  Award,
  Medal,
  Trophy,
  Star,
  Sprout,
  Rocket,
  Coins,
  Banknote,
  Gem,
  BadgeCheck,
  RefreshCw,
  Target,
  TrendingUp,
  Flame,
  Crown,
  Zap,
  Sparkles,
  HandCoins,
  PiggyBank,
  Handshake,
  CalendarCheck,
};

export function badgeIcon(iconName: string | null | undefined): LucideIcon {
  return (iconName && ICONS[iconName]) || Award;
}

// Per-tier medal styling. `earned` styling is the full-colour medal; `locked`
// is a muted, desaturated version. Kept as class strings so Tailwind's JIT sees
// them literally (no dynamic class construction).
export type TierStyle = {
  label: string;
  /** Ring + gradient for the earned medal disc. */
  disc: string;
  /** Icon colour when earned. */
  icon: string;
  /** Small tier pill. */
  pill: string;
};

export const TIER_STYLE: Record<BadgeTier, TierStyle> = {
  bronze: {
    label: "Bronze",
    disc: "bg-gradient-to-br from-amber-200 to-amber-400 ring-amber-500/40",
    icon: "text-amber-800",
    pill: "bg-amber-100 text-amber-800 ring-amber-600/20",
  },
  silver: {
    label: "Silver",
    disc: "bg-gradient-to-br from-slate-100 to-slate-300 ring-slate-400/40",
    icon: "text-slate-700",
    pill: "bg-slate-100 text-slate-700 ring-slate-500/20",
  },
  gold: {
    label: "Gold",
    disc: "bg-gradient-to-br from-yellow-200 to-amber-400 ring-amber-500/50",
    icon: "text-amber-900",
    pill: "bg-yellow-100 text-yellow-800 ring-yellow-600/20",
  },
  platinum: {
    label: "Platinum",
    disc: "bg-gradient-to-br from-cyan-100 to-teal-300 ring-teal-400/50",
    icon: "text-teal-900",
    pill: "bg-cyan-100 text-cyan-800 ring-cyan-600/20",
  },
};

export function tierStyle(tier: string): TierStyle {
  return TIER_STYLE[(tier as BadgeTier)] ?? TIER_STYLE.bronze;
}

// Earned subset, most-recent first (server already earned-first, but this makes
// the "Recent Badges" ordering explicit and independent of RPC order).
export function recentEarned(badges: MyBadge[], limit?: number): MyBadge[] {
  const earned = badges
    .filter((b) => b.earned && b.earned_at)
    // Numeric epoch compare (Greptile P2, ported from PR #126) — not
    // localeCompare, whose collation is locale-sensitive; ISO 8601 timestamps
    // sort deterministically by millis, newest first.
    .sort((a, b) => new Date(b.earned_at!).getTime() - new Date(a.earned_at!).getTime());
  return typeof limit === "number" ? earned.slice(0, limit) : earned;
}

export function earnedCount(badges: MyBadge[]): number {
  return badges.reduce((n, b) => n + (b.earned ? 1 : 0), 0);
}
