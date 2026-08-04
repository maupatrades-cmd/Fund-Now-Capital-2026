// GAMIFICATION badge presentation helpers (Sprint 5 Lane 5c).
//
// Mirrors the DB catalog shape returned by the get_my_badges() RPC. The badge
// icon + medallion styling are resolved here from the row's icon_name (a lucide
// icon name) and tier so the whole badge surface reads as one system. Any
// unknown icon_name degrades to a generic Award icon; any unknown tier degrades
// to the bronze styling — a future seeded badge never renders broken.

import {
  Award,
  Sprout,
  Banknote,
  Coins,
  TrendingUp,
  Trophy,
  Medal,
  BadgeCheck,
  CalendarCheck,
  type LucideIcon,
} from "lucide-react";

export type BadgeTier = "bronze" | "silver" | "gold" | "platinum";

// One row of the caller's collection, straight from get_my_badges(). `earned`
// is the truth flag; `earned_at` is null for a locked badge.
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

// Only the icons the seeded catalog actually uses are imported (keeps the bundle
// honest); everything else falls back to Award.
const ICONS: Record<string, LucideIcon> = {
  Sprout,
  Banknote,
  Coins,
  TrendingUp,
  Trophy,
  Medal,
  BadgeCheck,
  CalendarCheck,
  Award,
};

export function badgeIcon(iconName: string): LucideIcon {
  return ICONS[iconName] ?? Award;
}

// Medallion styling per tier. Earned badges wear the full tier colours; locked
// badges are rendered muted by the component (not here) so one tier map drives
// both states. Bronze/silver/gold/platinum read as a real progression.
export const TIER_STYLES: Record<
  BadgeTier,
  { ring: string; bg: string; icon: string; label: string; chip: string }
> = {
  bronze: {
    ring: "ring-amber-700/30",
    bg: "bg-gradient-to-br from-amber-100 to-amber-50",
    icon: "text-amber-700",
    label: "Bronze",
    chip: "bg-amber-100 text-amber-800",
  },
  silver: {
    ring: "ring-slate-400/40",
    bg: "bg-gradient-to-br from-slate-100 to-slate-50",
    icon: "text-slate-500",
    label: "Silver",
    chip: "bg-slate-100 text-slate-700",
  },
  gold: {
    ring: "ring-amber-500/40",
    bg: "bg-gradient-to-br from-amber-200 to-amber-50",
    icon: "text-amber-500",
    label: "Gold",
    chip: "bg-amber-100 text-amber-700",
  },
  platinum: {
    ring: "ring-brand-teal/40",
    bg: "bg-gradient-to-br from-brand-teal/15 to-brand-green/10",
    icon: "text-brand-teal",
    label: "Platinum",
    chip: "bg-brand-teal/10 text-brand-teal",
  },
};

export function tierStyle(tier: BadgeTier) {
  return TIER_STYLES[tier] ?? TIER_STYLES.bronze;
}
