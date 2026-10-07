import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

// Owner-only: which Switchboard / Coordinator profiles the Owner has switched on.
// A staff role does nothing until the Owner enables the person here (after
// checking their signed contract outside the system).
export function useStaffAccessList() {
  return useQuery({
    queryKey: ["staff-access-admin"],
    queryFn: async (): Promise<Record<string, boolean>> => {
      const { data, error } = await supabase.from("staff_access").select("profile_id, access_enabled");
      if (error) throw error;
      return Object.fromEntries((data ?? []).map((r) => [r.profile_id as string, r.access_enabled === true]));
    },
  });
}

export function useSetStaffAccess() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (i: { profileId: string; enabled: boolean; contractReference: string | null }) => {
      const { error } = await supabase.rpc("owner_set_staff_access", {
        p_profile_id: i.profileId, p_enabled: i.enabled, p_contract_reference: i.contractReference, p_note: null,
      });
      if (error) throw error;
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["staff-access-admin"] }); },
  });
}
