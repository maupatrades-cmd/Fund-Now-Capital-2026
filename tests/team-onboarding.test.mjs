import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Team exposes direct lead referrers and partner-linked sub-agents", async () => {
  const [team, page, invite] = await Promise.all([
    source("src/lib/team.ts"),
    source("src/pages/TeamPage.tsx"),
    source("supabase/functions/admin-invite-user/index.ts"),
  ]);
  assert.match(team, /"lead_referrer" \| "sub_agent"/);
  assert.match(page, /Which partner does this sub-agent belong to\?/);
  assert.match(page, /parent_partner_id: v\.role === "sub_agent"/);
  assert.match(invite, /requestedRole === "sub_agent" \? "lead_referrer"/);
  assert.match(invite, /partner_lead_referrers/);
  assert.match(invite, /sourced_via_partner_id/);
});

test("temporary-password invitations force a verified password change", async () => {
  const [app, auth, changePage, changeFunction, invite] = await Promise.all([
    source("src/App.tsx"),
    source("src/pages/AuthPage.tsx"),
    source("src/pages/ChangePasswordPage.tsx"),
    source("supabase/functions/change-user-password/index.ts"),
    source("supabase/functions/admin-invite-user/index.ts"),
  ]);
  assert.match(invite, /must_change_password: inviteMethod === "temp_password"/);
  assert.match(auth, /navigate\("\/change-password"/);
  assert.match(app, /must_change_password === true/);
  assert.match(changePage, /current_password: currentPassword, new_password: newPassword/);
  assert.match(changeFunction, /signInWithPassword/);
  assert.match(changeFunction, /must_change_password: false/);
  assert.doesNotMatch(changeFunction, /console\.(?:log|error)\([^\n]*(?:currentPassword|newPassword)/);
});

test("lead-referrer submit supports Path A and Path B without anonymous execution", async () => {
  const [page, migration] = await Promise.all([
    source("src/pages/lead-referrer/LeadReferrerSubmitLeadPage.tsx"),
    source("supabase/migrations/20260816202433_team_lead_referrer_onboarding.sql"),
  ]);
  assert.match(page, /p_contact_email:/);
  assert.match(page, /p_contact_cell:/);
  assert.match(migration, /attribution_path.*case when v_parent is null then 'A' else 'B' end/s);
  assert.match(migration, /sourced_by_lead_refer_id/);
  assert.match(migration, /revoke all on function public\.lead_referrer_submit_lead[^;]+from public, anon/s);
});
