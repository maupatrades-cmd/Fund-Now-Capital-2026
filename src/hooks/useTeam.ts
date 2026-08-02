import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { invalidateActivity } from "@/hooks/useActivity";
import type {
  InviteMethod,
  ReferralPartnerOption,
  TeamMember,
  UserRole,
} from "@/lib/team";

const TEAM_KEY = ["team-members"];

// All people in the CRM (profiles), owner-readable via RLS. referral_partners
// is fetched separately and joined client-side (avoids nullable-FK embedding
// pitfalls — CLAUDE.md !left rule) to resolve each partner's display name.
export function useTeamMembers() {
  return useQuery({
    queryKey: TEAM_KEY,
    queryFn: async (): Promise<TeamMember[]> => {
      const [profilesRes, partnersRes] = await Promise.all([
        supabase
          .from("profiles")
          .select("id, email, full_name, role, referral_partner_id, is_active, phone_number, created_at")
          .order("created_at", { ascending: true }),
        supabase.from("referral_partners").select("id, name"),
      ]);
      if (profilesRes.error) throw profilesRes.error;
      if (partnersRes.error) throw partnersRes.error;

      const partnerName = new Map<string, string>();
      for (const p of partnersRes.data ?? []) partnerName.set(p.id as string, p.name as string);

      return (profilesRes.data ?? []).map((r) => ({
        id: r.id as string,
        email: (r.email as string | null) ?? null,
        full_name: (r.full_name as string | null) ?? null,
        role: r.role as UserRole,
        referral_partner_id: (r.referral_partner_id as string | null) ?? null,
        referral_partner_name: r.referral_partner_id
          ? partnerName.get(r.referral_partner_id as string) ?? null
          : null,
        is_active: r.is_active as boolean,
        phone_number: (r.phone_number as string | null) ?? null,
        created_at: r.created_at as string,
      }));
    },
  });
}

// Active referral partners for the "Edit Role → Partner" dropdown.
export function useReferralPartnerOptions() {
  return useQuery({
    queryKey: ["referral-partner-options"],
    queryFn: async (): Promise<ReferralPartnerOption[]> => {
      const { data, error } = await supabase
        .from("referral_partners")
        .select("id, name")
        .eq("is_active", true)
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((p) => ({ id: p.id as string, name: p.name as string }));
    },
  });
}

// Pull the JSON error body out of a Supabase FunctionsHttpError so the UI shows
// our message ("Only the owner can…") instead of a generic "non-2xx" string.
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

export type InviteInput = {
  email: string;
  full_name: string;
  phone: string;
  role: Exclude<UserRole, "owner">;
  invite_method: InviteMethod;
  temp_password?: string;
};

export type InviteResult = {
  ok: boolean;
  status: "created" | "existing";
  user_id: string;
  invite_method: InviteMethod;
  email_sent?: boolean;
  temp_password?: string | null;
  message?: string;
};

// Create (or idempotently resolve) a user via the admin-invite-user Edge
// Function. Returns the function's response so the caller can reveal a temp
// password or report an "already a member" outcome.
export function useInviteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: InviteInput): Promise<InviteResult> => {
      const { data, error } = await supabase.functions.invoke("admin-invite-user", { body: input });
      if (error) throw new Error(await functionErrorMessage(error, "Could not send the invite."));
      return data as InviteResult;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: TEAM_KEY });
      invalidateActivity(qc);
    },
  });
}

// Change a user's role (+ referral partner) via the admin_update_user_role RPC.
export function useUpdateUserRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      user_id: string;
      new_role: Exclude<UserRole, "owner">;
      new_referral_partner_id?: string | null;
    }) => {
      const { data, error } = await supabase.rpc("admin_update_user_role", {
        p_user_id: input.user_id,
        p_new_role: input.new_role,
        p_new_referral_partner_id: input.new_referral_partner_id ?? null,
      });
      if (error) throw new Error(error.message || "Could not update the role.");
      return data as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: TEAM_KEY });
      invalidateActivity(qc);
    },
  });
}

// Soft-deactivate a user via the admin-deactivate-user Edge Function.
export function useDeactivateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) => {
      const { data, error } = await supabase.functions.invoke("admin-deactivate-user", {
        body: { user_id: userId },
      });
      if (error) throw new Error(await functionErrorMessage(error, "Could not deactivate the user."));
      return data as { ok: boolean; status: string; user_id: string };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: TEAM_KEY });
      invalidateActivity(qc);
    },
  });
}
