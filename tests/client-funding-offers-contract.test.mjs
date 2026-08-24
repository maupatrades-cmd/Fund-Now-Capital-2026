import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../supabase/migrations/20260824120000_client_funding_offers_outcomes.sql", import.meta.url), "utf8");
const workspace = migration.slice(migration.indexOf("create or replace function public.client_funding_offer_workspace"), migration.indexOf("create or replace function public.client_decide_funding_offer"));

test("published offer creation is evidence-backed", () => {
  assert.match(migration, /status in \('approved','quote_received'\)/);
  assert.match(migration, /document_type in \('offer_letter','term_sheet'\)/);
  assert.match(migration, /verification_status='accepted'/);
  assert.match(migration, /d\.is_current_version/);
});

test("client projection excludes internal funder and commission fields", () => {
  assert.doesNotMatch(workspace, /offered_commission|gross_commission|decline_notes_internal|notes/);
  assert.match(workspace, /client_funder_label/);
  assert.match(workspace, /current_client_id\(\)/);
});

test("decisions are immutable and direct writes are blocked", () => {
  assert.match(migration, /client_offer_decisions_immutable/);
  assert.match(migration, /revoke all on table public\.client_funding_offer_decisions from public, anon, authenticated/);
  assert.match(migration, /A decision has already been recorded/);
});

test("acceptance advances workflow and creates owner follow-up", () => {
  assert.match(migration, /stage='verification_kyc'/);
  assert.match(migration, /Progress accepted client offer/);
  assert.match(migration, /CLIENT_OFFER_.*upper\(p_decision\)/s);
});
