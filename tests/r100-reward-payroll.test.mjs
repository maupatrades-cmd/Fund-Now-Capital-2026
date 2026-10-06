import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(new URL("../supabase/migrations/20260824164115_r100_reward_payroll_workspace.sql", import.meta.url), "utf8");
const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
const contractorGate = await readFile(new URL("../src/pages/ContractorGate.tsx", import.meta.url), "utf8");
const page = await readFile(new URL("../src/pages/QualifiedRewardsPage.tsx", import.meta.url), "utf8");

test("R100 payroll remains exactly-once and separate from commission money", () => {
  assert.match(migration, /references public\.complete_document_reward_locks/);
  assert.match(migration, /unique \(batch_id, reward_lock_id\)/);
  assert.match(migration, /amount = 100\.00/);
  assert.doesNotMatch(migration, /update public\.complete_document_reward_locks/i);
  assert.doesNotMatch(migration, /commission_records|partner_invoices|contractor_invoices/i);
});

test("cutoff batches only permit the 25th or 30th with evidence-backed payment", () => {
  assert.match(migration, /selected_payday in \(25, 30\)/);
  assert.match(migration, /reward\.cutoff_date = \(v_cycle \+ interval '21 days'\)::date/);
  assert.match(migration, /Payment reference and proof of payment are required/);
  assert.match(migration, /event_type[^\n]*'paid'|event_type = 'paid'/);
  assert.match(migration, /proof_storage_path/);
});

test("payout history is append-only and reversals offset rather than delete", () => {
  assert.match(migration, /R100 reward payout evidence is append-only/);
  assert.match(migration, /event_type = 'reversed' and amount_delta = -100\.00/);
  assert.match(migration, /before update or delete on public\.qualified_reward_payout_events/);
  assert.match(migration, /idempotency_key text not null unique/);
  assert.match(migration, /event_type = 'carried_forward'/);
  assert.match(migration, /order by scheduled\.scheduled_at desc limit 1/);
});

test("workspace enforces owner or direct-beneficiary privacy", () => {
  assert.match(migration, /public\.is_owner\(\) or reward\.beneficiary_profile_id = v_uid/);
  assert.match(migration, /Only the owner can schedule R100 reward payouts/);
  assert.match(migration, /Only the owner can record R100 reward payment/);
  assert.match(migration, /revoke all on table[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /Anonymous R100 payroll access is forbidden/);
});

test("owner, partner, contractor and lead-referrer surfaces are routed", () => {
  assert.match(app, /path="\/rewards"/);
  assert.match(app, /path="rewards" element=\{<PortalShell portal="partner"/);
  assert.match(app, /path="rewards" element=\{<LeadReferrerShell>/);
  assert.match(contractorGate, /path="rewards"/);
  assert.match(page, /Earned and locked/);
  assert.match(page, /Pending payout/);
  assert.match(page, /Record batch paid/);
});
