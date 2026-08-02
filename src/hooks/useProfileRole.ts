import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/useSession";

// The signed-in user's role from their profiles row
// ('owner' | 'partner' | 'contractor' | null).
//
// Keyed by user id so a same-tab sign-out/sign-in as a different user can
// never reuse the previous user's cached role — each uid gets its own cache
// entry, and signed-out (uid null) resolves to a null role. Disabled while
// the session is still loading; consumers must treat `isPending` as the
// loading state (in TanStack Query v5 a disabled query has isLoading false
// but isPending true).
export function useProfileRole() {
  const session = useSession();
  const uid = session?.user?.id ?? null;

  return useQuery({
    queryKey: ["profile-role", uid],
    staleTime: 5 * 60_000,
    enabled: session !== undefined,
    queryFn: async (): Promise<string | null> => {
      if (!uid) return null;
      const { data, error } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", uid)
        .maybeSingle();
      if (error) throw error;
      return (data?.role as string | undefined) ?? null;
    },
  });
}
