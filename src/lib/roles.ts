// Role-based landing targets. Single source of truth for "where does this
// role live" so the login redirect, the `/` landing, and the cross-role
// bounces in the gates can never disagree.
//
// Mirrors the live `public.user_role` enum on profiles.role.
// switchboard / coordinator are the two staff roles. Holding one grants nothing
// until the owner enables the person (staff_access); they land on /staff,
// where StaffGate shows a waiting card until the owner enables them.
export type UserRole =
  | "owner"
  | "partner"
  | "contractor"
  | "client"
  | "lead_referrer"
  | "switchboard"
  | "coordinator";

export function roleHome(role: string | null | undefined): string {
  if (role === "partner") return "/partner";
  if (role === "contractor") return "/contractor";
  if (role === "client") return "/client";
  if (role === "lead_referrer") return "/lead-referrer";
  if (role === "switchboard" || role === "coordinator") return "/staff";
  // Owner keeps the current behaviour. An unknown/missing role also lands on
  // /dashboard, where OwnerGate shows its access-restricted card — the same
  // dead end a non-owner gets today.
  return "/dashboard";
}
