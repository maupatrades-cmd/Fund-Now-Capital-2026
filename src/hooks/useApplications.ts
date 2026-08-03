import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/useSession";
import { invalidateActivity } from "@/hooks/useActivity";
import type { ContractorApplication, PublicApplicationInput } from "@/lib/applications";

// Owner-only applications list. Keyed by the signed-in user id (portal-cache-key
// pattern, PR #100/#101/#107) so a role/session switch can never serve another
// user's cached rows. RLS still scopes the rows to the owner regardless.
const applicationsKey = (userId: string | null) => ["contractor-applications", userId] as const;

export function useApplications() {
  const session = useSession();
  const userId = session?.user?.id ?? null;
  return useQuery({
    queryKey: applicationsKey(userId),
    // Only run once we know who's signed in (avoids a null-keyed fetch flash).
    enabled: session !== undefined,
    queryFn: async (): Promise<ContractorApplication[]> => {
      const { data, error } = await supabase
        .from("contractors")
        .select(
          "id, full_name, email, phone, id_number, physical_address, experience_years, motivation_text, referral_source, referral_source_other, status, rejected_reason, screening_notes, submitted_at, created_at, updated_at",
        )
        .order("submitted_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ContractorApplication[];
    },
  });
}

function invalidateApplications(qc: ReturnType<typeof useQueryClient>) {
  // Broad match on the prefix so every user-scoped variant is refreshed.
  qc.invalidateQueries({ queryKey: ["contractor-applications"] });
}

// applicant → screening (owner-only RPC).
export function useMoveToScreening() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (applicationId: string) => {
      const { data, error } = await supabase.rpc("move_application_to_screening", {
        p_application_id: applicationId,
      });
      if (error) throw new Error(error.message || "Could not move the application to screening.");
      return data as { id: string; status: string; changed: boolean };
    },
    onSuccess: () => {
      invalidateApplications(qc);
      invalidateActivity(qc);
    },
  });
}

// applicant/screening → rejected with a required reason (owner-only RPC).
export function useRejectApplication() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { applicationId: string; reason: string }) => {
      const { data, error } = await supabase.rpc("reject_application", {
        p_application_id: input.applicationId,
        p_reason: input.reason,
      });
      if (error) throw new Error(error.message || "Could not reject the application.");
      return data as { id: string; status: string; changed: boolean };
    },
    onSuccess: () => {
      invalidateApplications(qc);
      invalidateActivity(qc);
    },
  });
}

export type SubmitApplicationResult = { ok: boolean; status: string; email_sent?: boolean };

// Pull the JSON error body (incl. our 429 message) out of a FunctionsHttpError.
async function functionErrorMessage(error: unknown, fallback: string): Promise<string> {
  const ctx = (error as { context?: unknown })?.context;
  if (ctx instanceof Response) {
    try {
      const body = await ctx.clone().json();
      if (body?.error) return String(body.error);
    } catch {
      /* not JSON — fall through */
    }
  }
  const msg = (error as { message?: string })?.message;
  return msg || fallback;
}

// PUBLIC submission — no auth. Calls the apply-submit-application Edge Function
// (which uses the service role internally). Not keyed to any session; safe to
// use on the unauthenticated /apply page.
export function useSubmitApplication() {
  return useMutation({
    mutationFn: async (input: PublicApplicationInput): Promise<SubmitApplicationResult> => {
      const { data, error } = await supabase.functions.invoke("apply-submit-application", {
        body: input,
      });
      if (error) throw new Error(await functionErrorMessage(error, "Could not submit your application."));
      return data as SubmitApplicationResult;
    },
  });
}
