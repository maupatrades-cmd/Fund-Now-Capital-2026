import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

function includesAll(text, expected, context) {
  for (const value of expected) {
    assert.ok(text.includes(value), `${context}: missing ${JSON.stringify(value)}`);
  }
}

test("team invitations are owner-only and expose both supported delivery paths", async () => {
  const [teamPage, teamHook, edge] = await Promise.all([
    source("src/pages/TeamPage.tsx"),
    source("src/hooks/useTeam.ts"),
    source("supabase/functions/admin-invite-user/index.ts"),
  ]);

  includesAll(teamPage, [
    'invite_method: z.enum(["magic_link", "temp_password"])',
    'value="magic_link"',
    'value="temp_password"',
    'v.temp_password.trim().length < 8',
  ], "team invite UI");
  includesAll(teamHook, [
    'supabase.functions.invoke("admin-invite-user"',
    "invite_method: InviteMethod",
  ], "team invite request");
  includesAll(edge, [
    'userClient.rpc("is_owner")',
    'return json({ error: "Only the owner can invite people" }, 403)',
    'inviteMethod !== "magic_link" && inviteMethod !== "temp_password"',
    "service.auth.admin.generateLink",
    "sendMagicLinkEmail",
  ], "owner-only invite edge function");
});

test("partner, contractor, lead-referrer and owner portals fail closed by role", async () => {
  const [app, owner, partner, contractor, leadReferrer, roles] = await Promise.all([
    source("src/App.tsx"),
    source("src/components/layout/OwnerGate.tsx"),
    source("src/pages/PartnerGate.tsx"),
    source("src/pages/ContractorGate.tsx"),
    source("src/pages/LeadReferrerGate.tsx"),
    source("src/lib/roles.ts"),
  ]);

  includesAll(app, [
    '<Route path="/partner" element={<PartnerGate />}>',
    '<Route path="/contractor/*" element={<ContractorGate />} />',
    '<Route path="/lead-referrer" element={<LeadReferrerGate />}>',
    '<Route element={session ? <OwnerGate /> : <Navigate to="/" replace />}>',
  ], "portal routes");
  assert.ok(owner.includes('role !== "owner"'), "owner portal must reject non-owners");
  assert.ok(partner.includes('role !== "partner"'), "partner portal must reject non-partners");
  assert.ok(contractor.includes('role !== "contractor"'), "contractor portal must reject non-contractors");
  assert.ok(leadReferrer.includes('role === "lead_referrer"'), "lead-referrer portal must reject other roles");
  includesAll(roles, [
    'if (role === "partner") return "/partner";',
    'if (role === "contractor") return "/contractor";',
    'if (role === "lead_referrer") return "/lead-referrer";',
    'if (role === "client") return "/client";',
  ], "role landing boundaries");
});

test("client portal invitation is available from a lead and preserves attribution", async () => {
  const [leadPage, panel, edge] = await Promise.all([
    source("src/pages/LeadDetailPage.tsx"),
    source("src/components/leads/LeadClientInvitationPanel.tsx"),
    source("supabase/functions/bootstrap-client-account/index.ts"),
  ]);

  assert.match(leadPage, /<LeadClientInvitationPanel/);
  includesAll(panel, [
    "Send client portal link",
    "authorised_email_verified: true",
    "lead_id: leadId",
    'supabase.functions.invoke("bootstrap-client-account"',
  ], "lead client invitation");
  assert.ok(edge.includes("service_create_quick_client_invitation_for_lead"));
});

test("manual plan owns the not-yet-live onboarding acceptance cases", async () => {
  const plan = await source("docs/ROLE-ONBOARDING-CALENDAR-MANUAL-SMOKE-2026-08-24.md");
  includesAll(plan, [
    "Partner invitation",
    "Contractor invitation",
    "Lead Referrer invitation",
    "Sub-Agent invitation",
    "Parent partner is required",
    "Temporary-password first-login gate",
    "Magic-link path",
    "Presentation: 14:00–20:00 SAST only",
    "All other booking types: any published time",
    "Standalone booking",
  ], "manual smoke ownership");
});
