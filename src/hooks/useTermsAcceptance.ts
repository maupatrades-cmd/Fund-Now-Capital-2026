import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/useSession";
import {
  currentUserAgent,
  hashClientIp,
  type PortalRole,
  type TermsVersion,
} from "@/lib/terms";

// First-login T&C acceptance state for a partner/contractor portal.
//
// Two server reads (the current version for the role, and whether the caller has
// accepted it) drive `needsAcceptance`; an `accept` mutation records it.
//
// Cache is keyed by userId (mirrors useProfileRole) so a same-tab sign-out/sign-in
// as a different user can never be served the previous user's acceptance state.
export type TermsAcceptanceState = {
  needsAcceptance: boolean;
  version: TermsVersion | null;
};

export function useTermsAcceptance(role: PortalRole) {
  const session = useSession();
  const uid = session?.user?.id ?? null;
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["terms-acceptance", role, uid],
    enabled: !!uid,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<TermsAcceptanceState> => {
      if (!uid) return { needsAcceptance: false, version: null };

      // Current terms for this role (a single terms_versions row, or null when
      // none is published for the role — in which case there is nothing to accept).
      const { data: version, error: vErr } = await supabase.rpc(
        "get_current_terms_for_role",
        { p_role: role },
      );
      if (vErr) throw vErr;
      if (!version) return { needsAcceptance: false, version: null };

      const { data: accepted, error: aErr } = await supabase.rpc(
        "check_user_has_accepted_current",
        { p_user_id: uid, p_role: role },
      );
      if (aErr) throw aErr;

      return {
        needsAcceptance: accepted !== true,
        version: version as TermsVersion,
      };
    },
  });

  const accept = useMutation({
    mutationFn: async (versionId: string) => {
      // Best-effort client IP hash (fallback — the RPC prefers its own
      // server-derived hash). Never blocks: hashClientIp resolves to null on any
      // failure.
      const ipHash = await hashClientIp();
      const { data, error } = await supabase.rpc("accept_terms", {
        p_version_id: versionId,
        p_ip_hash: ipHash,
        p_user_agent: currentUserAgent(),
      });
      if (error) throw error;
      return data as { status?: string } | null;
    },
    onSuccess: () => {
      // Re-read acceptance state so the modal closes on success.
      void qc.invalidateQueries({ queryKey: ["terms-acceptance", role, uid] });
    },
  });

  return {
    isLoading: query.isPending,
    isError: query.isError,
    needsAcceptance: query.data?.needsAcceptance ?? false,
    version: query.data?.version ?? null,
    accept,
  };
}
