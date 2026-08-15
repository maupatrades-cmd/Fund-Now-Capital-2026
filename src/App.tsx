import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import AuthPage from "@/pages/AuthPage";
import PublicApplyPage from "@/pages/PublicApplyPage";
import TermsViewPage from "@/pages/TermsViewPage";
import SignAgreementPage from "@/pages/SignAgreementPage";
import AgreementsPage from "@/pages/AgreementsPage";
import NewAgreementPage from "@/pages/NewAgreementPage";
import AgreementDetailPage from "@/pages/AgreementDetailPage";
import OwnerGate from "@/components/layout/OwnerGate";
import PartnerGate from "@/pages/PartnerGate";
import PartnerHomePage from "@/pages/PartnerHomePage";
import PartnerSubmitLeadPage from "@/pages/partner/SubmitLeadPage";
import PartnerMyLeadsPage from "@/pages/partner/MyLeadsPage";
import PartnerDealsPage from "@/pages/partner/PartnerDealsPage";
import PartnerInvoicesPage from "@/pages/partner/PartnerInvoicesPage";
import PartnerInvoiceDetailPage from "@/pages/partner/PartnerInvoiceDetailPage";
import PartnerNotificationSettingsPage from "@/pages/partner/NotificationSettingsPage";
import PartnerPaymentSettingsPage from "@/pages/partner/PaymentSettingsPage";
import PartnerBadgesPage from "@/pages/partner/PartnerBadgesPage";
import PartnerStatementsPage from "@/pages/partner/StatementsPage";
import ContractorGate from "@/pages/ContractorGate";
import ClientGate from "@/pages/client/ClientGate";
import ClientHomePage from "@/pages/client/ClientHomePage";
import ClientApplicationPage from "@/pages/client/ClientApplicationPage";
import ClientDocumentsPage from "@/pages/client/ClientDocumentsPage";
import ClientLegalPage from "@/pages/client/ClientLegalPage";
import ClientProgressPage from "@/pages/client/ClientProgressPage";
import ClientAppointmentsPage from "@/pages/client/ClientAppointmentsPage";
import ClientMessagesPage from "@/pages/client/ClientMessagesPage";
import ClientOffersPage from "@/pages/client/ClientOffersPage";
import ClientProfilePage from "@/pages/client/ClientProfilePage";
import ClientLegalDocumentsPage from "@/pages/client/ClientLegalDocumentsPage";
import LeadReferrerGate from "@/pages/LeadReferrerGate";
import LeadReferrerHomePage from "@/pages/lead-referrer/LeadReferrerHomePage";
import LeadReferrerSubmitLeadPage from "@/pages/lead-referrer/LeadReferrerSubmitLeadPage";
import ClientInvitationsPage from "@/pages/ClientInvitationsPage";
import DashboardPage from "@/pages/DashboardPage";
import PipelinePage from "@/pages/PipelinePage";
import DealDetailPage from "@/pages/DealDetailPage";
import ArchivedDealsPage from "@/pages/ArchivedDealsPage";
import TasksPage from "@/pages/TasksPage";
import DealPackagePage from "@/pages/DealPackagePage";
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
import RepaymentsPage from "@/pages/RepaymentsPage";
import PartnerEarningsPage from "@/pages/PartnerEarningsPage";
import PayoutsPage from "@/pages/PayoutsPage";
import PartnerApprovalsPage from "@/pages/PartnerApprovalsPage";
import ContractorApprovalsPage from "@/pages/ContractorApprovalsPage";
import ActivityPage from "@/pages/ActivityPage";
import ReportsPage from "@/pages/ReportsPage";
import DataQualityPage from "@/pages/DataQualityPage";
import StatementsPage from "@/pages/StatementsPage";
import NotificationsPage from "@/pages/NotificationsPage";
import NotificationPreferencesPage from "@/pages/NotificationPreferencesPage";
import IndustriesPage from "@/pages/IndustriesPage";
import FundersSettingsPage from "@/pages/FundersSettingsPage";
import TeamPage from "@/pages/TeamPage";
import TermsAdminPage from "@/pages/TermsAdminPage";
import LegalStudioPage from "@/pages/LegalStudioPage";
import OwnerPayeesPage from "@/pages/OwnerPayeesPage";
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
        Agreement signing. ROLE-AGNOSTIC on purpose: the token in the
        URL identifies the signing party, so a partner, contractor or
        lead-referrer all sign here rather than each portal growing its own copy.

        It sits behind a session (not a role gate) because every signer RPC is
        granted to `authenticated` only — anon is explicitly revoked across the
        e-sign surface. An unauthenticated visitor is bounced to the login page,
        signs in, and returns to the same link. An unauthenticated visitor gets
        the login page in place rather than a redirect, so the link they were
        sent still works after they sign in.
      */}
      <Route
        path="/sign/:token"
        element={session ? <SignAgreementPage /> : <AuthPage />}
      />

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
        <Route path="client-invitations" element={<ClientInvitationsPage />} />
        <Route path="statements" element={<PartnerStatementsPage />} />
        <Route path="invoices" element={<PartnerInvoicesPage />} />
        <Route path="invoices/:invoiceId" element={<PartnerInvoiceDetailPage />} />
        <Route path="badges" element={<PartnerBadgesPage />} />
        <Route path="settings/notifications" element={<PartnerNotificationSettingsPage />} />
        <Route path="settings/payment" element={<PartnerPaymentSettingsPage />} />
        <Route path="*" element={<Navigate to="/partner" replace />} />
      </Route>
      <Route path="/contractor/*" element={<ContractorGate />} />
      <Route path="/client" element={<ClientGate />}>
        <Route index element={<ClientHomePage />} />
        <Route path="application" element={<ClientApplicationPage />} />
        <Route path="documents" element={<ClientDocumentsPage />} />
        <Route path="legal" element={<ClientLegalPage />} />
        <Route path="progress" element={<ClientProgressPage />} />
        <Route path="appointments" element={<ClientAppointmentsPage />} />
        <Route path="messages" element={<ClientMessagesPage />} />
        <Route path="offers" element={<ClientOffersPage />} />
        <Route path="profile" element={<ClientProfilePage />} />
        <Route path="legal-documents" element={<ClientLegalDocumentsPage />} />
        <Route path="*" element={<Navigate to="/client" replace />} />
      </Route>
      <Route path="/lead-referrer" element={<LeadReferrerGate />}>
        <Route index element={<LeadReferrerHomePage />} />
        <Route path="submit-lead" element={<LeadReferrerSubmitLeadPage />} />
        <Route path="client-invitations" element={<ClientInvitationsPage />} />
        <Route path="*" element={<Navigate to="/lead-referrer" replace />} />
      </Route>

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
        <Route path="/tasks" element={<TasksPage />} />
        <Route path="/deals/:id" element={<DealDetailPage />} />
        <Route path="/deals/archived" element={<ArchivedDealsPage />} />
        <Route path="/deals/:id/package" element={<DealPackagePage />} />
        <Route path="/invoices" element={<InvoicesPage />} />
        <Route path="/repayments" element={<RepaymentsPage />} />
        {/* Static paths rank above /invoices/:id in React Router v6. */}
        <Route path="/invoices/partner-approvals" element={<PartnerApprovalsPage />} />
        <Route path="/invoices/contractor-approvals" element={<ContractorApprovalsPage />} />
        <Route path="/invoices/:id" element={<InvoiceDetailPage />} />
        <Route path="/partner-earnings" element={<PartnerEarningsPage />} />
        <Route path="/payouts" element={<PayoutsPage />} />
        <Route path="/leads" element={<LeadsPage />} />
        <Route path="/leads/new" element={<LeadFormPage />} />
        <Route path="/leads/:id" element={<LeadDetailPage />} />
        <Route path="/leads/:id/edit" element={<LeadFormPage />} />
        <Route path="/clients" element={<ClientsPage />} />
        <Route path="/clients/new" element={<ClientFormPage />} />
        <Route path="/clients/:id" element={<ClientDetailPage />} />
        <Route path="/clients/:id/edit" element={<ClientFormPage />} />
        <Route path="/client-invitations" element={<ClientInvitationsPage />} />
        <Route path="/documents" element={<DocumentsPage />} />
        {/* Static /agreements/new must rank above /agreements/:id. */}
        <Route path="/agreements" element={<AgreementsPage />} />
        <Route path="/agreements/new" element={<NewAgreementPage />} />
        <Route path="/agreements/:id" element={<AgreementDetailPage />} />
        <Route path="/funders" element={<FundersPage />} />
        <Route path="/funders/new" element={<FunderFormPage />} />
        <Route path="/funders/:id" element={<FunderDetailPage />} />
        <Route path="/funders/:id/edit" element={<FunderFormPage />} />
        <Route path="/calculator" element={<CalculatorPage />} />
        <Route path="/activity" element={<ActivityPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/data-quality" element={<DataQualityPage />} />
        <Route path="/statements" element={<StatementsPage />} />
        <Route path="/team" element={<TeamPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/settings/notifications" element={<NotificationPreferencesPage />} />
        <Route path="/settings/industries" element={<IndustriesPage />} />
        <Route path="/settings/funders" element={<FundersSettingsPage />} />
        <Route path="/settings/terms" element={<TermsAdminPage />} />
        <Route path="/settings/legal-studio" element={<LegalStudioPage />} />
        <Route path="/settings/payees" element={<OwnerPayeesPage />} />
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
