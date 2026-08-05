import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import AuthPage from "@/pages/AuthPage";
import PublicApplyPage from "@/pages/PublicApplyPage";
import TermsViewPage from "@/pages/TermsViewPage";
import OwnerGate from "@/components/layout/OwnerGate";
import PartnerGate from "@/pages/PartnerGate";
import PartnerHomePage from "@/pages/PartnerHomePage";
import PartnerSubmitLeadPage from "@/pages/partner/SubmitLeadPage";
import PartnerMyLeadsPage from "@/pages/partner/MyLeadsPage";
import PartnerDealsPage from "@/pages/partner/PartnerDealsPage";
import PartnerInvoicesPage from "@/pages/partner/PartnerInvoicesPage";
import PartnerInvoiceDetailPage from "@/pages/partner/PartnerInvoiceDetailPage";
import PartnerNotificationSettingsPage from "@/pages/partner/NotificationSettingsPage";
import PartnerBadgesPage from "@/pages/partner/PartnerBadgesPage";
import PartnerStatementsPage from "@/pages/partner/StatementsPage";
import ContractorGate from "@/pages/ContractorGate";
import DashboardPage from "@/pages/DashboardPage";
import PipelinePage from "@/pages/PipelinePage";
import DealDetailPage from "@/pages/DealDetailPage";
import ArchivedDealsPage from "@/pages/ArchivedDealsPage";
import ClientsPage from "@/pages/ClientsPage";
import ClientDetailPage from "@/pages/ClientDetailPage";
import ClientFormPage from "@/pages/ClientFormPage";
import DocumentsPage from "@/pages/DocumentsPage";
import LeadsPage from "@/pages/LeadsPage";
import LeadFormPage from "@/pages/LeadFormPage";
import LeadDetailPage from "@/pages/LeadDetailPage";
import FundersPage from "@/pages/FundersPage";
import FunderDetailPage from "@/pages/FunderDetailPage";
import FunderFormPage from "@/pages/FunderFormPage";
import CalculatorPage from "@/pages/CalculatorPage";
import InvoicesPage from "@/pages/InvoicesPage";
import InvoiceDetailPage from "@/pages/InvoiceDetailPage";
import PartnerEarningsPage from "@/pages/PartnerEarningsPage";
import PartnerApprovalsPage from "@/pages/PartnerApprovalsPage";
import ActivityPage from "@/pages/ActivityPage";
import ReportsPage from "@/pages/ReportsPage";
import StatementsPage from "@/pages/StatementsPage";
import NotificationsPage from "@/pages/NotificationsPage";
import NotificationPreferencesPage from "@/pages/NotificationPreferencesPage";
import IndustriesPage from "@/pages/IndustriesPage";
import FundersSettingsPage from "@/pages/FundersSettingsPage";
import TeamPage from "@/pages/TeamPage";
import { ConfettiProvider } from "@/lib/celebration/ConfettiProvider";
import { useProfileRole } from "@/hooks/useProfileRole";
import { roleHome } from "@/lib/roles";
import { useSession } from "@/lib/useSession";
import { queryClient } from "@/lib/queryClient";

// Signed-in landing for `/`: owner → /dashboard (unchanged), partner →
// /partner, contractor → /contractor. Role errors fall through to /dashboard,
// where OwnerGate handles non-owners exactly as before.
function RoleLanding() {
  const { data: role, isPending } = useProfileRole();

  if (isPending) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  return <Navigate to={roleHome(role)} replace />;
}

function AppRoutes() {
  const session = useSession();

  // The public /apply and /terms/current pages have no account and must not wait
  // on the session read — render them immediately (a cold applicant or a website
  // footer visitor lands here on a fresh load, so reading window.location at mount
  // is correct). Every other route stays behind the brief session-loading state.
  const publicPath =
    typeof window !== "undefined"
      ? window.location.pathname.replace(/\/+$/, "")
      : "";
  const onPublicRoute = publicPath === "/apply" || publicPath === "/terms/current";

  // Brief loading state while we read the persisted session.
  if (session === undefined && !onPublicRoute) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  return (
    <Routes>
      <Route
        path="/"
        element={session ? <RoleLanding /> : <AuthPage />}
      />

      {/*
        Public, unauthenticated contractor application (ONBOARDING.md Stage 1).
        Deliberately OUTSIDE every gate — a cold applicant has no account. It
        posts to the apply-submit-application Edge Function.
      */}
      <Route path="/apply" element={<PublicApplyPage />} />

      {/*
        Public Terms & Conditions viewer (Sprint 4, Lane 4d). No account needed —
        the FNC website footer links here. RLS exposes the current version to anon.
      */}
      <Route path="/terms/current" element={<TermsViewPage />} />

      {/*
        Role portals — the route entries live here because App.tsx owns
        routing; the gate components are each lane's own file.

        PartnerGate (DOCTOR-BUILD lane) is a role-guard LAYOUT route: it runs
        the partner-role check, then renders its children through <Outlet />,
        so PartnerHomePage is mounted as the index child here. Any deeper
        /partner/* path redirects back to /partner until real sub-screens land.

        ContractorGate (this lane) instead owns its own internal <Routes>, so
        it mounts under the /contractor/* splat and adds its own sub-screens.
      */}
      <Route path="/partner" element={<PartnerGate />}>
        <Route index element={<PartnerHomePage />} />
        <Route path="submit-lead" element={<PartnerSubmitLeadPage />} />
        <Route path="leads" element={<PartnerMyLeadsPage />} />
        <Route path="deals" element={<PartnerDealsPage />} />
        <Route path="statements" element={<PartnerStatementsPage />} />
        <Route path="invoices" element={<PartnerInvoicesPage />} />
        <Route path="invoices/:invoiceId" element={<PartnerInvoiceDetailPage />} />
        <Route path="badges" element={<PartnerBadgesPage />} />
        <Route path="settings/notifications" element={<PartnerNotificationSettingsPage />} />
        <Route path="*" element={<Navigate to="/partner" replace />} />
      </Route>
      <Route path="/contractor/*" element={<ContractorGate />} />

      {/*
        Authenticated app — owner-only, shared sidebar/top-bar layout.
        Owner-gating is centralised here: <OwnerGate> wraps the whole block, so
        every route inside is owner-only without a per-route check (no
        duplication to abstract). A dedicated <RequireOwner> wrapper — with
        per-route redirect targets, error messages, or layout variants — would
        only earn its place once we have ~8+ owner routes with varying needs.
        Not yet warranted; the single shared gate stays.
      */}
      <Route element={session ? <OwnerGate /> : <Navigate to="/" replace />}>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/pipeline" element={<PipelinePage />} />
        <Route path="/deals/:id" element={<DealDetailPage />} />
        <Route path="/deals/archived" element={<ArchivedDealsPage />} />
        <Route path="/invoices" element={<InvoicesPage />} />
        {/* Static path ranks above /invoices/:id in React Router v6. */}
        <Route path="/invoices/partner-approvals" element={<PartnerApprovalsPage />} />
        <Route path="/invoices/:id" element={<InvoiceDetailPage />} />
        <Route path="/partner-earnings" element={<PartnerEarningsPage />} />
        <Route path="/leads" element={<LeadsPage />} />
        <Route path="/leads/new" element={<LeadFormPage />} />
        <Route path="/leads/:id" element={<LeadDetailPage />} />
        <Route path="/leads/:id/edit" element={<LeadFormPage />} />
        <Route path="/clients" element={<ClientsPage />} />
        <Route path="/clients/new" element={<ClientFormPage />} />
        <Route path="/clients/:id" element={<ClientDetailPage />} />
        <Route path="/clients/:id/edit" element={<ClientFormPage />} />
        <Route path="/documents" element={<DocumentsPage />} />
        <Route path="/funders" element={<FundersPage />} />
        <Route path="/funders/new" element={<FunderFormPage />} />
        <Route path="/funders/:id" element={<FunderDetailPage />} />
        <Route path="/funders/:id/edit" element={<FunderFormPage />} />
        <Route path="/calculator" element={<CalculatorPage />} />
        <Route path="/activity" element={<ActivityPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/statements" element={<StatementsPage />} />
        <Route path="/team" element={<TeamPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/settings/notifications" element={<NotificationPreferencesPage />} />
        <Route path="/settings/industries" element={<IndustriesPage />} />
        <Route path="/settings/funders" element={<FundersSettingsPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ConfettiProvider>
          <AppRoutes />
          <Toaster position="top-center" richColors />
        </ConfettiProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
