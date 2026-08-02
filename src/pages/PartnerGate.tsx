import type { ReactNode } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { useProfileRole } from "@/hooks/useProfileRole";

/*
 * Session guard for the referral-partner portal (/partner/*).
 *
 * Role check verified against the live schema: the referral-partner role is
 * stored as profiles.role = 'partner' (user_role enum is 'owner' | 'partner';
 * there is no separate 'referral_partner' enum value). The partner's business
 * identity hangs off profiles.referral_partner_id → referral_partners.
 *
 * Anyone else — signed out (role resolves to null), owner, or a failed role
 * lookup — is sent to /login. RLS is the real backstop (a partner session can
 * only read its own rows); this gate keeps the UI honest, same posture as
 * OwnerGate on the owner side.
 */
export default function PartnerGate({ children }: { children?: ReactNode }) {
  const { data: role, isLoading } = useProfileRole();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (role !== "partner") {
    return <Navigate to="/login" replace />;
  }

  // Works both as a layout route (nested /partner/* routes via Outlet) and as
  // a plain wrapper, whichever shape the routing layer mounts it with.
  return <>{children ?? <Outlet />}</>;
}
