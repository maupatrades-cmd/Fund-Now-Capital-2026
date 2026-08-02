import { Navigate } from "react-router-dom";
import { ShieldAlert } from "lucide-react";
import AppLayout from "./AppLayout";
import { useProfileRole } from "@/hooks/useProfileRole";
import { roleHome } from "@/lib/roles";
import { signOutAndRedirect } from "@/lib/signOut";

// Every owner screen sits behind this gate, so a signed-in non-owner can't
// reach the owner UI or its edit controls. Partners and contractors are
// bounced to their own portals (POPIA cross-role isolation); an unknown role
// still gets the access-restricted card. RLS is the real backstop; this
// keeps the UI honest too.
export default function OwnerGate() {
  const { data: role, isPending, isError } = useProfileRole();

  if (isPending) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (!isError && (role === "partner" || role === "contractor")) {
    return <Navigate to={roleHome(role)} replace />;
  }

  if (isError || role !== "owner") {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-sm space-y-3 rounded-xl border border-border bg-white p-8 text-center shadow-sm">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-amber-100 text-amber-700">
            <ShieldAlert className="h-6 w-6" />
          </span>
          <h1 className="text-lg font-semibold text-brand-navy">Owner access only</h1>
          <p className="text-sm text-muted-foreground">
            This area is restricted to the Fund Now Capital owner. The partner portal is coming
            in a later phase.
          </p>
          <button
            type="button"
            onClick={() => void signOutAndRedirect()}
            className="rounded-lg bg-brand-navy px-4 py-2 text-sm font-semibold text-white"
          >
            Sign out
          </button>
        </div>
      </div>
    );
  }

  return <AppLayout />;
}
