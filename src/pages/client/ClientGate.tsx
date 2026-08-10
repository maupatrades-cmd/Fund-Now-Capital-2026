import { Navigate, Outlet } from "react-router-dom";
import { useProfileRole } from "@/hooks/useProfileRole";
import { roleHome } from "@/lib/roles";

export default function ClientGate() {
  const { data: role, isPending } = useProfileRole();

  if (isPending) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#06131d] text-sm text-white/70">
        Opening your secure portal…
      </div>
    );
  }

  if (role !== "client") {
    return <Navigate to={roleHome(role)} replace />;
  }

  return <Outlet />;
}
