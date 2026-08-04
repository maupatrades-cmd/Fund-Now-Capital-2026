import { Navigate, Route, Routes } from "react-router-dom";
import { useProfileRole } from "@/hooks/useProfileRole";
import { roleHome } from "@/lib/roles";
import { useSession } from "@/lib/useSession";
import { PortalTermsGate } from "@/components/terms/PortalTermsGate";
import ContractorHomePage from "./ContractorHomePage";
import ContractorSubmitLeadPage from "./contractor/SubmitLeadPage";
import ContractorMyLeadsPage from "./contractor/MyLeadsPage";
import ContractorDealsPage from "./contractor/ContractorDealsPage";
import ContractorTrainingPage from "./contractor/TrainingPage";
import ContractorTrainingModulePage from "./contractor/TrainingModulePage";
import ContractorStatementsPage from "./contractor/StatementsPage";
import ContractorNotificationSettingsPage from "./contractor/NotificationSettingsPage";

// Session + role guard for everything under /contractor/*. The contractor
// portal is its own world: contractors never see the owner CRM, and
// non-contractors never see this portal (POPIA cross-role isolation — the
// same treatment OwnerGate gives the owner routes). RLS remains the real
// backstop; this keeps the UI honest.
export default function ContractorGate() {
  const session = useSession();
  const { data: role, isPending, isError } = useProfileRole();

  // Watch the live session directly (not just the cached role) so signing
  // out while on /contractor bounces to login immediately — mirrors the
  // session wrapper App.tsx puts around the owner block.
  if (session === null) {
    return <Navigate to="/" replace />;
  }

  if (session === undefined || isPending) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  // Role missing (no profiles row) or lookup failure → login screen.
  if (isError || role == null) {
    return <Navigate to="/" replace />;
  }

  // Signed in as someone else → their own home (owner → /dashboard,
  // partner → /partner).
  if (role !== "contractor") {
    return <Navigate to={roleHome(role)} replace />;
  }

  // The gate owns its subtree (App.tsx mounts it at /contractor/*), so nested
  // contractor screens are added here in later PRs without touching App.tsx.
  // The T&C gate wraps the ENTIRE subtree so an unaccepted contractor can't
  // deep-link past it to a sub-route.
  // The T&C gate wraps the ENTIRE subtree — including notification settings — so
  // an unaccepted contractor can't deep-link past acceptance to any sub-route.
  return (
    <PortalTermsGate role="contractor">
      <Routes>
        <Route index element={<ContractorHomePage />} />
        <Route path="submit-lead" element={<ContractorSubmitLeadPage />} />
        <Route path="leads" element={<ContractorMyLeadsPage />} />
        <Route path="deals" element={<ContractorDealsPage />} />
        <Route path="training" element={<ContractorTrainingPage />} />
        <Route path="training/:moduleId" element={<ContractorTrainingModulePage />} />
        <Route path="statements" element={<ContractorStatementsPage />} />
        <Route path="settings/notifications" element={<ContractorNotificationSettingsPage />} />
        <Route path="*" element={<Navigate to="/contractor" replace />} />
      </Routes>
    </PortalTermsGate>
  );
}
