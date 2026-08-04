import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/useSession";
import type {
  ContractorStatement,
  OwnerStatement,
  PartnerStatement,
  YearMonth,
} from "@/lib/statements";

/*
 * Monthly Statements data layer (Sprint 4 Lane 4b).
 *
 * Each role reads its own statement through a SECURITY DEFINER RPC that self-
 * gates on identity and (for partner/contractor) anonymises the funder name
 * server-side. The client never touches commission_records directly — that keeps
 * the S7C-forbidden columns (gross / retention / pool / owner share / tier) off
 * every partner & contractor surface.
 *
 * Cache is keyed by userId + year + month (the canonical POPIA isolation
 * pattern, mirroring usePartnerInvoices / usePortalDeals): a same-tab sign-out /
 * sign-in as a different user of the same role can never reuse cached rows, and
 * each month is its own cache entry. `enabled: uid !== null` holds the query
 * until a concrete session id is known (undefined = still resolving) so a
 * placeholder-keyed fetch can't land under a null key on first paint.
 */

function useStatement<T>(rpc: string, ym: YearMonth, roleKey: string) {
  const uid = useSession()?.user?.id ?? null;
  const q = useQuery({
    queryKey: ["statement", roleKey, uid, ym.year, ym.month],
    enabled: uid !== null,
    // staleTime: 0 — explicit, because the app-wide default is 30s
    // (src/lib/queryClient.ts). Statement rows are private earnings, so every
    // mount/navigation must re-hit the SECURITY DEFINER RPC, which re-runs the
    // caller's identity gate. A cached response would let a partner/contractor
    // whose access was revoked mid-session keep seeing their old rows; a client
    // cache is not an authorization boundary, and data volume here is tiny.
    staleTime: 0,
    queryFn: async (): Promise<T> => {
      const { data, error } = await supabase.rpc(rpc, {
        p_year: ym.year,
        p_month: ym.month,
      });
      if (error) throw error;
      return data as T;
    },
  });

  // React Query keeps the last successful data when a BACKGROUND refetch fails
  // (status stays 'success', so `isError` is false) — which on this surface would
  // leave stale private rows rendered and CSV-exportable with no error/retry
  // shown. Treat ANY fetch failure — initial load or a later refetch (e.g. the
  // RPC gate now rejecting a revoked caller) — as a hard error: drop the data so
  // the table and export clear, and surface the retry state. `failureReason` is
  // set on a failed refetch even while status stays 'success', and resets on the
  // next success.
  const failed = q.isError || q.failureReason != null;
  return {
    data: failed ? undefined : q.data,
    isLoading: q.isLoading || uid === null,
    isError: failed,
    error: (q.error ?? q.failureReason ?? null) as Error | null,
    refetch: q.refetch,
  };
}

export function useOwnerStatement(ym: YearMonth) {
  return useStatement<OwnerStatement>("get_owner_monthly_statement", ym, "owner");
}

export function usePartnerStatement(ym: YearMonth) {
  return useStatement<PartnerStatement>("get_partner_monthly_statement", ym, "partner");
}

export function useContractorStatement(ym: YearMonth) {
  return useStatement<ContractorStatement>("get_contractor_monthly_statement", ym, "contractor");
}
