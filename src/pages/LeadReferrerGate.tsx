import { Navigate, Outlet } from "react-router-dom";
import { useProfileRole } from "@/hooks/useProfileRole";

export default function LeadReferrerGate() {
  const { data: role, isLoading } = useProfileRole();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-muted-foreground">
        Loading...
      </div>
    );
  }

  return role === "lead_referrer" ? <Outlet /> : <Navigate to="/" replace />;
}
