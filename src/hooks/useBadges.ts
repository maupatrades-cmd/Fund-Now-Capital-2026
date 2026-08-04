import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/useSession";
import type { MyBadge } from "@/lib/badges";

// The signed-in user's badge collection (earned + locked) from get_my_badges().
//
// Cache keyed by the session user id (Macroscope cache-isolation rule): a
// same-tab sign-out/sign-in as a different user can never be served the previous
// user's badges. The authoritative scoping is the RPC itself (SECURITY DEFINER,
// auth.uid()-scoped) — this key just keeps the client cache honest. The RPC
// returns [] for the owner (no badge surface) and for the signed-out state.
export function useMyBadges() {
  const session = useSession();
  const uid = session?.user?.id ?? null;

  return useQuery({
    queryKey: ["my-badges", uid],
    enabled: !!uid,
    // staleTime 0: a badge is earned by a server-side trigger (on lead submit /
    // commission settle) and announced via a BADGE_EARNED notification, so the
    // card must not serve stale "no badges yet" data. 0 means React Query
    // refetches on mount — navigating back to the home/collection after the
    // triggering action shows the new badge immediately, instead of lagging the
    // notification by up to a minute (Greptile P1).
    staleTime: 0,
    queryFn: async (): Promise<MyBadge[]> => {
      const { data, error } = await supabase.rpc("get_my_badges");
      if (error) throw error;
      return (data ?? []) as MyBadge[];
    },
  });
}

// The most recently earned badges, newest first — for the "Recent Badges" home
// card. Derived from the same query so the card and the collection view never
// disagree.
export function recentEarned(badges: MyBadge[] | undefined, limit = 3): MyBadge[] {
  return (badges ?? [])
    .filter((b) => b.earned && b.earned_at)
    // Numeric timestamp compare (not localeCompare, which is locale-collation
    // sensitive) — ISO 8601 strings sort correctly by epoch millis (Greptile P2).
    .sort((a, b) => new Date(b.earned_at!).getTime() - new Date(a.earned_at!).getTime())
    .slice(0, limit);
}

export function earnedCount(badges: MyBadge[] | undefined): number {
  return (badges ?? []).filter((b) => b.earned).length;
}
