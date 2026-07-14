import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

// The signed-in user's role from their profiles row ('owner' | 'partner' | null).
export function useProfileRole() {
  return useQuery({
    queryKey: ["profile-role"],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<string | null> => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
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
