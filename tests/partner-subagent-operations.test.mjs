import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(
  new URL("../supabase/migrations/20260824210000_partner_subagent_operations.sql", import.meta.url),
  "utf8",
);
const page = await readFile(new URL("../src/pages/PartnerNetworkPage.tsx", import.meta.url), "utf8");
const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");

test("RPC is authenticated and isolates partners by canonical membership", () => {
  assert.match(migration, /from public\.partner_lead_referrers membership/i);
  assert.match(migration, /actor\.role = 'owner'/i);
  assert.match(migration, /actor\.role = 'partner'/i);
  assert.match(migration, /actor\.referral_partner_id = membership\.referral_partner_id/i);
  assert.match(migration, /revoke all on function public\.list_partner_subagent_operations\(\) from public, anon/i);
});

test("projection excludes private contact, banking and referrer compensation fields", () => {
  const returns = migration.match(/returns table \(([\s\S]*?)\)\s*language sql/i)?.[1] ?? "";
  assert.doesNotMatch(returns, /email|phone|bank|commission|earning|contact_/i);
});

test("both Owner and partner surfaces route to the operational directory", () => {
  assert.match(app, /path="\/partner-network"/);
  assert.match(app, /path="network"/);
  assert.match(page, /surface === "owner"/);
  assert.match(page, /surface === "partner"/);
});
