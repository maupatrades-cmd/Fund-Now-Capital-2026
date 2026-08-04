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
    staleTime: 60_000,
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
    .sort((a, b) => (b.earned_at ?? "").localeCompare(a.earned_at ?? ""))
    .slice(0, limit);
}

export function earnedCount(badges: MyBadge[] | undefined): number {
  return (badges ?? []).filter((b) => b.earned).length;
}
