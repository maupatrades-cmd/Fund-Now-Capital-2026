import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("lead-referrer portal exposes own leads and pipeline routes", async () => {
  const [app, shell] = await Promise.all([
    read("src/App.tsx"),
    read("src/components/lead-referrer/LeadReferrerShell.tsx"),
  ]);
  assert.match(app, /path="leads" element={<LeadReferrerLeadsPage/);
  assert.match(app, /path="pipeline" element={<LeadReferrerPipelinePage/);
  assert.match(shell, /My leads/);
  assert.match(shell, /My pipeline/);
});

test("deal RPC is authenticated, role-gated and attribution-scoped", async () => {
  const sql = await read("supabase/migrations/20260824095543_lead_referrer_operational_pipeline.sql");
  assert.match(sql, /v_role is distinct from 'lead_referrer'/);
  assert.match(sql, /l\.attributed_to_lead_referrer_id = v_uid/);
  assert.match(sql, /l\.sourced_by_lead_refer_id = v_uid/);
  assert.match(sql, /revoke all on function public\.lead_referrer_list_own_deals\(\) from public, anon/);
  assert.match(sql, /set search_path = ''/);
  assert.doesNotMatch(sql, /referral_partner_id = v_partner/);
});
