import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = async (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

function includesAll(text, expected, context) {
  for (const value of expected) {
    assert.ok(text.includes(value), `${context}: missing ${JSON.stringify(value)}`);
  }
}

test("client routes remain complete and nested behind ClientGate", async () => {
  const app = await source("src/App.tsx");
  includesAll(app, [
    '<Route path="/client" element={<ClientGate />}>',
    '<Route index element={<ClientHomePage />} />',
    '<Route path="application" element={<ClientApplicationPage />} />',
    '<Route path="documents" element={<ClientDocumentsPage />} />',
    '<Route path="progress" element={<ClientProgressPage />} />',
    '<Route path="appointments" element={<ClientAppointmentsPage />} />',
    '<Route path="messages" element={<ClientMessagesPage />} />',
    '<Route path="offers" element={<ClientOffersPage />} />',
    '<Route path="*" element={<Navigate to="/client" replace />} />',
  ], "client route contract");
});

test("login and role boundaries fail closed", async () => {
  const [app, gate] = await Promise.all([
    source("src/App.tsx"),
    source("src/pages/client/ClientGate.tsx"),
  ]);
  includesAll(app, [
    'element={session ? <RoleLanding /> : <AuthPage />}',
    'element={session ? <SignAgreementPage /> : <Navigate to="/" replace />}',
  ], "session boundary");
  includesAll(gate, [
    'if (role !== "client")',
    "return <Navigate to={roleHome(role)} replace />;",
    "return <Outlet />;",
  ], "client role gate");
});

test("portal invitation requires an authorised, valid email before sending", async () => {
  const invitations = await source("src/pages/ClientInvitationsPage.tsx");
  includesAll(invitations, [
    "supabase.functions.invoke('bootstrap-client-account'",
    "action: 'quick_invite'",
    "authorised_email_verified: true",
    "/^\\S+@\\S+\\.\\S+$/.test(quickForm.email.trim())",
    "&& quickConfirmed",
    'disabled={!quickReady}',
    "Links are one-time, audited and restricted by lead attribution.",
  ], "invitation safety contract");
});

test("dashboard exposes the core client journey and live workspace cards", async () => {
  const home = await source("src/pages/client/ClientHomePage.tsx");
  includesAll(home, [
    "<ClientPortalShell>",
    'to="/client/application"',
    'to="/client/documents"',
    'to="/client/messages"',
    "<ClientApplicationProgress />",
    "<ClientMeetingRequestCard />",
    "<ClientMessagesPanel />",
  ], "dashboard journey");
});

test("application supports draft, validation, submit and post-submit locking", async () => {
  const application = await source("src/pages/client/ClientApplicationPage.tsx");
  includesAll(application, [
    'queryKey: ["client-funding-products"]',
    'queryKey: ["client-application-draft"',
    'if (submit && !hasAmount)',
    'if (draft.data?.status === "submitted")',
    'status: "draft"',
    'update({ status: "submitted" })',
    "Save draft",
    "Submit application",
    "Application submitted. Fund Now Capital can now review it",
  ], "application lifecycle");
});

test("document workflow uses governed checklist, private storage and safe download", async () => {
  const documents = await source("src/pages/client/ClientDocumentsPage.tsx");
  includesAll(documents, [
    'supabase.rpc("client_portal_document_workspace")',
    'supabase.storage.from("documents").upload',
    'supabase.rpc("register_client_portal_document"',
    'supabase.storage.from("documents").remove([storagePath])',
    'createSignedUrl(document.storage_path, 60)',
    'accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"',
    'document?.verification_status !== "accepted"',
    "Needs replacement",
  ], "document lifecycle");
});

test("secure messages validate content and keep closed conversations read-only", async () => {
  const [panel, hook] = await Promise.all([
    source("src/components/client-portal/ClientMessagesPanel.tsx"),
    source("src/hooks/useClientPortalMessages.ts"),
  ]);
  includesAll(hook, [
    'supabase.rpc("client_portal_message_workspace")',
    'supabase.rpc("client_send_portal_message"',
  ], "message backend contract");
  includesAll(panel, [
    'selected?.status === "closed"',
    "This conversation is closed.",
    'maxLength={5000}',
    'disabled={send.isPending || !body.trim()',
    'aria-label="Conversation messages"',
  ], "message UI contract");
});

test("meeting requests validate time, stay in SAST and allow pending-only cancellation", async () => {
  const meeting = await source("src/components/client-portal/ClientMeetingRequestCard.tsx");
  includesAll(meeting, [
    'supabase.rpc("client_create_meeting_request"',
    'supabase.rpc("client_cancel_meeting_request"',
    'p_timezone: "Africa/Johannesburg"',
    'if (!preferredStart || subject.trim().length < 3) return;',
    'request.status === "pending"',
    'aria-label="Request a meeting"',
    "Cancel request",
  ], "meeting lifecycle");
});

test("progress vocabulary remains client-safe and offers route is honest about scope", async () => {
  const [progress, progressHook, offers] = await Promise.all([
    source("src/components/client-portal/ClientApplicationProgress.tsx"),
    source("src/hooks/useClientApplicationProgress.ts"),
    source("src/pages/client/ClientOffersPage.tsx"),
  ]);
  includesAll(progressHook, [
    'supabase.rpc("client_portal_application_progress")',
    '"received", "documents", "review", "funding_review", "decision", "finalising", "funded", "closed"',
  ], "progress backend contract");
  includesAll(progress, [
    'aria-current={current ? "step" : undefined}',
    "Your application is safely with Fund Now Capital.",
    "An outcome or offer is being prepared for you.",
    "Your funding journey is complete.",
  ], "progress UI contract");
  includesAll(offers, [
    'title="Review your outcomes"',
    "once the Owner publishes an outcome",
  ], "offers route contract");
});
