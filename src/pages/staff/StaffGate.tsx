import { Navigate, Outlet } from "react-router-dom";
import { useProfileRole } from "@/hooks/useProfileRole";
import { useOwnStaffAccess, useStaffRole } from "@/hooks/useStaffDesk";
import { StaffShell, card } from "@/components/staff/StaffShell";

// Admits an enabled Switchboard / Coordinator (and the Owner, who can open every
// staff screen). The database is the real gate; this only decides which screen to
// show, and it fails closed: anything unclear shows the waiting card or bounces.
export default function StaffGate() {
  const { data: profileRole, isLoading } = useProfileRole();
  const staffRole = useStaffRole();
  const access = useOwnStaffAccess();

  if (isLoading || staffRole.isLoading) {
    return <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-muted-foreground">Loading...</div>;
  }
  if (profileRole !== "switchboard" && profileRole !== "coordinator" && profileRole !== "owner") {
    return <Navigate to="/" replace />;
  }
  if (!staffRole.data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className={`${card} max-w-md space-y-2 text-center`}>
          <h1 className="text-lg font-bold text-brand-navy">Waiting for activation</h1>
          <p className="text-sm text-muted-foreground">
            {access.data?.enabled === false || !access.data
              ? "Your account is ready, but the Owner has not switched your access on yet. You will see your workspace here as soon as they do."
              : "Your access is not active right now. Please contact the Owner."}
          </p>
        </div>
      </div>
    );
  }
  return <StaffShell><Outlet /></StaffShell>;
}
