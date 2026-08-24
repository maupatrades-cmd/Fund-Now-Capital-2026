import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(new URL("../supabase/migrations/20260824220000_contractor_document_chase_workspace.sql", import.meta.url), "utf8");
const gate = await readFile(new URL("../src/pages/ContractorGate.tsx", import.meta.url), "utf8");
const shell = await readFile(new URL("../src/components/portal/PortalShell.tsx", import.meta.url), "utf8");

test("workspace is restricted to the active contractor caller's attributed deals", () => {
  assert.match(migration, /p\.role::text = 'contractor'/i);
  assert.match(migration, /lead\.attributed_to_contractor_id = actor\.id/i);
  assert.match(migration, /d\.archived_at is null/i);
  assert.match(migration, /revoke all on function public\.contractor_document_chase_items\(\) from public, anon/i);
});

test("workspace output is client-safe and hides funder/internal fields", () => {
  const returns = migration.match(/returns table \(([\s\S]*?)\)\s*language sql/i)?.[1] ?? "";
  assert.doesNotMatch(returns, /funder|email|phone|contact|verification_notes|rule_scope/i);
  assert.match(migration, /rule\.requirement <> 'waived'|ranked\.requirement <> 'waived'/i);
});

test("task creation is scoped, idempotent and uses the existing assignee workflow", () => {
  assert.match(migration, /contractor_create_document_chase_task/i);
  assert.match(migration, /document_status = 'accepted'/i);
  assert.match(migration, /owner_tasks_one_open_contractor_document_chase/i);
  assert.match(migration, /assigned_to, created_by, task_kind/i);
});

test("contractor portal exposes the document chase route and navigation", () => {
  assert.match(gate, /path="documents"/);
  assert.match(shell, /Documents to chase/);
});
