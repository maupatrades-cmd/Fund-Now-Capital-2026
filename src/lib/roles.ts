// Role-based landing targets. Single source of truth for "where does this
// role live" so the login redirect, the `/` landing, and the cross-role
// bounces in the gates can never disagree.
//
// Mirrors the live `public.user_role` enum on profiles.role.
export type UserRole = "owner" | "partner" | "contractor";

export function roleHome(role: string | null | undefined): string {
  if (role === "partner") return "/partner";
  if (role === "contractor") return "/contractor";
  // Owner keeps the current behaviour. An unknown/missing role also lands on
  // /dashboard, where OwnerGate shows its access-restricted card — the same
  // dead end a non-owner gets today.
  return "/dashboard";
}
