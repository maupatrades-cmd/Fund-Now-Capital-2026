import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/useSession";
import {
  normaliseProgression,
  type ProgressionData,
  type ProgressionLevel,
} from "@/lib/progression";

// Contractor progression hooks.
//
// The read RPC get_contractor_progression is authorization-aware: the owner may
// read any contractor; a contractor may read only their own row (and the server
// masks FNC gross for them — S7C). All caches are keyed by the target contractor
// id so a same-tab re-login can never surface a previous user's cached row
// (mirrors usePortalLeads / useProfileRole).

async function fetchProgression(contractorId: string): Promise<ProgressionData> {
  const { data, error } = await supabase.rpc("get_contractor_progression", {
    p_contractor_id: contractorId,
  });
  if (error) throw error;
  return normaliseProgression(data);
}

// The signed-in contractor's OWN progression (portal card + detail page).
export function useMyProgression() {
  // `useSession()` is undefined while resolving and null when signed out — both
  // collapse to uid === null. Gate the fetch on a concrete uid so a real row is
  // never cached under a placeholder key (the cache-isolation rule).
  const uid = useSession()?.user?.id ?? null;

  const query = useQuery({
    queryKey: ["contractor-progression", uid],
    enabled: uid !== null,
    queryFn: () => fetchProgression(uid as string),
  });

  return { ...query, isLoading: query.isLoading || uid === null };
}

// Owner-only: a specific contractor's progression (Team Management dialog).
export function useContractorProgression(contractorId: string | null) {
  return useQuery({
    queryKey: ["contractor-progression", contractorId],
    enabled: contractorId != null,
    queryFn: () => fetchProgression(contractorId as string),
  });
}

export type PromoteInput = {
  contractorId: string;
  newLevel: ProgressionLevel;
  reason: string;
};

// Owner-only: change a contractor's level (owner_promote_contractor). Invalidates
// both the target contractor's cached row and any list consumers.
export function usePromoteContractor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: PromoteInput): Promise<ProgressionData> => {
      const { data, error } = await supabase.rpc("owner_promote_contractor", {
        p_contractor_id: input.contractorId,
        p_new_level: input.newLevel,
        p_reason: input.reason,
      });
      if (error) throw error;
      return normaliseProgression(data);
    },
    onSuccess: (_data, input) => {
      qc.invalidateQueries({ queryKey: ["contractor-progression", input.contractorId] });
    },
  });
}
