import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/useSession";
import type { MyBadge } from "@/lib/badges";
import type { PortalKind } from "@/components/portal/PortalShell";

/*
 * The signed-in partner/contractor's badge collection — every badge applicable
 * to their role, with earned state. Backed by the SECURITY DEFINER get_my_badges()
 * RPC, which scopes strictly to auth.uid() and returns nothing for the owner, so a
 * partner can never see a contractor's milestones and vice-versa (POPIA).
 *
 * The query key carries the session user id (mirrors usePortalDeals / useProfileRole):
 * a same-tab sign-out → sign-in as a different same-role user can never be served the
 * previous user's cached badges. `useSession()` is `undefined` while resolving and
 * `null` when signed out — both collapse to `uid === null`; we gate the fetch on a
 * concrete uid so a first-paint authenticated fetch can't cache under the placeholder
 * key, and surface that window as loading rather than an empty collection.
 *
 * `portal` is carried in the key for cache separation only; the RPC itself derives
 * the role from auth.uid() server-side (it does not take the portal as an argument).
 */
export function useMyBadges(portal: PortalKind) {
  const uid = useSession()?.user?.id ?? null;

  const query = useQuery({
    queryKey: ["my-badges", portal, uid],
    enabled: uid !== null,
    staleTime: 60_000,
    queryFn: async (): Promise<MyBadge[]> => {
      const { data, error } = await supabase.rpc("get_my_badges");
      if (error) throw error;
      return (data ?? []) as MyBadge[];
    },
  });

  return { ...query, isLoading: query.isLoading || uid === null };
}
