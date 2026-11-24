import { Navigate, useLocation } from "react-router-dom";
import { useProfileRole } from "@/hooks/useProfileRole";

// /calls (the link in missed-call and meeting notices) sends each person to the Calls & meetings page of their own app.
export default function CallsRedirect() {
  const { data: role, isPending } = useProfileRole();
  const { search } = useLocation();
  if (isPending) return null;
  const base = role === "owner" ? "/meet"
    : role === "partner" ? "/partner/meet"
    : role === "contractor" ? "/contractor/meet"
    : role === "lead_referrer" ? "/lead-referrer/meet"
    : role ? "/staff/meet" : "/";
  return <Navigate to={`${base}${search}`} replace />;
}
