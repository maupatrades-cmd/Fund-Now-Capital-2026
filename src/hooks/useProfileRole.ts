import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/useSession";

// The signed-in user's role from their profiles row
// ('owner' | 'partner' | 'contractor' | null).
//
// Keyed by the session user id so a same-tab sign-out/sign-in as a different
// user can never reuse the previous user's cached role — each uid gets its own
// cache entry (the Macroscope cache-isolation fix). The key uid comes from the
// session, but the *authoritative* uid is re-read inside the queryFn via
// getUser(), so the query never gates on `enabled`: `isLoading`/`isPending`
// stay true for the entire "role unknown" window and only resolve to a real
// value (or null when signed out). This keeps the hook safe for consumers that
// read `isLoading` (e.g. PartnerGate) as well as `isPending` — a disabled query
// would report isLoading=false with no data and bounce a signed-in user out of
// their portal on first render.
export function useProfileRole() {
  const session = useSession();
  const uid = session?.user?.id ?? null;

  return useQuery({
    queryKey: ["profile-role", uid],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<string | null> => {
      const { data: userData } = await supabase.auth.getUser();
      const authedUid = userData.user?.id;
      if (!authedUid) return null;
      const { data, error } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", authedUid)
        .maybeSingle();
      if (error) throw error;
      return (data?.role as string | undefined) ?? null;
    },
  });
}
