import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("offer notification enum values are committed before trigger use", async () => {
  const enumSql = await read("supabase/migrations/20260824121000_client_offer_notification_readiness.sql");
  assert.match(enumSql, /CLIENT_OFFER_PUBLISHED/);
  assert.match(enumSql, /CLIENT_OFFER_ACCEPTED/);
  assert.match(enumSql, /CLIENT_OFFER_DECLINED/);
  assert.doesNotMatch(enumSql, /create trigger/i);
});

test("published offers notify only the linked client through the durable notification path", async () => {
  const sql = await read("supabase/migrations/20260824121100_client_offer_notification_triggers.sql");
  assert.match(sql, /p\.client_id = new\.client_id/);
  assert.match(sql, /p\.role::text = 'client'/);
  assert.match(sql, /perform public\.emit_in_app_notification/);
  assert.match(sql, /'\/client\/offers'/);
  assert.doesNotMatch(sql, /commission|funder_submission_id|awarded_funder_id/i);
});

test("client decisions notify the owner without copying the private reason", async () => {
  const sql = await read("supabase/migrations/20260824121100_client_offer_notification_triggers.sql");
  assert.match(sql, /p\.role::text = 'owner'/);
  assert.match(sql, /CLIENT_OFFER_ACCEPTED/);
  assert.match(sql, /CLIENT_OFFER_DECLINED/);
  assert.doesNotMatch(sql, /new\.client_reason/);
});

test("delivery evidence RPC is owner-gated and anonymous execution is revoked", async () => {
  const sql = await read("supabase/migrations/20260824121100_client_offer_notification_triggers.sql");
  assert.match(sql, /not public\.is_owner\(\)/);
  assert.match(sql, /revoke all on function public\.owner_client_offer_delivery_evidence\(uuid\) from public, anon/);
  assert.match(sql, /notification_deliveries/);
});

test("email template has client-safe offer variants", async () => {
  const template = await read("supabase/functions/send-notification-email/email-template.ts");
  assert.match(template, /case "CLIENT_OFFER_PUBLISHED"/);
  assert.match(template, /Review my offer securely/);
  assert.match(template, /case "CLIENT_OFFER_ACCEPTED"/);
  assert.match(template, /case "CLIENT_OFFER_DECLINED"/);
});
