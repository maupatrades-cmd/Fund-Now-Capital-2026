import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("supabase/migrations/20260824235000_notification_delivery_retry_command_center.sql", "utf8");
const edge = readFileSync("supabase/functions/send-notification-email/index.ts", "utf8");
const page = readFileSync("src/pages/NotificationDeliveryPage.tsx", "utf8");

test("retry RPC is owner-only, bounded, and serialised", () => {
  assert.match(migration, /p\.role = 'owner'/);
  assert.match(migration, /attempt_number between 1 and 3/);
  assert.match(migration, /delivery_status = 'pending'/);
  assert.match(migration, /Only the latest failed attempt can be retried/);
  assert.match(migration, /revoke execute on function public\.owner_retry_notification_email\(uuid\) from public, anon/);
});

test("retry attempts reuse the authenticated webhook path and become dead letters", () => {
  assert.match(migration, /'delivery_id', p_delivery_id/);
  assert.match(edge, /requestedDeliveryId/);
  assert.match(edge, /\.eq\("delivery_status", "pending"\)/);
  assert.match(edge, /attemptNumber >= 3 \? "dead_letter" : "failed"/);
});

test("owner workspace exposes evidence and source navigation without automatic retry", () => {
  assert.match(page, /Notification delivery centre/);
  assert.match(page, /Open source record/);
  assert.match(page, /Queue retry/);
  assert.doesNotMatch(page, /setInterval|automatic retry/i);
});
