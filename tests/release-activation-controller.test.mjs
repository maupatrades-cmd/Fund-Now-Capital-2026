import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { buildActivationPlan, normalizeMigrationName, renderMarkdown } from "../scripts/ops/plan-release-activation.mjs";

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "fnc-activation-plan-"));
  await mkdir(path.join(root, "supabase", "migrations"), { recursive: true });
  await mkdir(path.join(root, "supabase", "functions", "send-example"), { recursive: true });
  await writeFile(path.join(root, "supabase", "migrations", "20260101000000_first.sql"), "select 1;\n");
  await writeFile(path.join(root, "supabase", "migrations", "20260102000000_second.sql"), "select 2;\n");
  await writeFile(path.join(root, "supabase", "functions", "send-example", "index.ts"), "export {};\n");
  return root;
}

test("orders only unapplied migrations and undeployed functions", async () => {
  const root = await fixture();
  const plan = await buildActivationPlan(root, {
    captured_at: "2026-08-24T10:00:00Z",
    baseline_commit: "abcdef1",
    applied_migration_versions: ["20260101000000"],
    deployed_edge_functions: [],
  });
  assert.deepEqual(plan.pending_migrations.map(({ version }) => version), ["20260102000000"]);
  assert.deepEqual(plan.pending_edge_functions, ["send-example"]);
  assert.equal(plan.blockers.length, 0);
  assert.equal(plan.safety.live_changes_performed, false);
  assert.match(renderMarkdown(plan), /SINGLE ACTOR REQUIRED/);
});

test("reconciles MCP-applied timestamp aliases by unambiguous logical name", async () => {
  const root = await fixture();
  const plan = await buildActivationPlan(root, {
    captured_at: "2026-08-24T10:00:00Z",
    baseline_commit: "abcdef1",
    applied_migrations: [
      { version: "20260103000000", name: "20260101000000_first" },
    ],
    deployed_edge_functions: [],
  });
  assert.deepEqual(plan.pending_migrations.map(({ version }) => version), ["20260102000000"]);
  assert.equal(plan.logical_name_aliases.length, 1);
  assert.equal(plan.logical_name_aliases[0].repository.version, "20260101000000");
  assert.deepEqual(plan.blockers, []);
});

test("normalizes repeated timestamp prefixes only", () => {
  assert.equal(normalizeMigrationName("20260812193636_20260812093000_Role_Document_Requirements.sql"), "role_document_requirements");
  assert.equal(normalizeMigrationName("client_portal_profile"), "client_portal_profile");
});

test("blocks ambiguous logical-name reconciliation", async () => {
  const root = await fixture();
  await writeFile(path.join(root, "supabase", "migrations", "20260103000000_20260101000000_first.sql"), "select 3;\n");
  const plan = await buildActivationPlan(root, {
    captured_at: "2026-08-24T10:00:00Z",
    baseline_commit: "abcdef1",
    applied_migrations: [{ version: "20260104000000", name: "first" }],
    deployed_edge_functions: [],
  });
  assert.ok(plan.blockers.some(({ code }) => code === "AMBIGUOUS_REPOSITORY_MIGRATION_NAME"));
  assert.equal(plan.logical_name_aliases.length, 0);
});

test("blocks when live inventory contains source-less objects", async () => {
  const root = await fixture();
  const plan = await buildActivationPlan(root, {
    captured_at: "2026-08-24T10:00:00Z",
    baseline_commit: "abcdef1",
    applied_migration_versions: ["20260101000000", "20251201000000"],
    deployed_edge_functions: ["send-example", "untracked-live-function"],
  });
  assert.deepEqual(plan.blockers.map(({ code }) => code), ["LIVE_ONLY_MIGRATION", "LIVE_ONLY_EDGE_FUNCTION"]);
  assert.match(renderMarkdown(plan), /BLOCKED\. Do not apply or deploy/);
});

test("blocks an applied migration that skips an older repository version", async () => {
  const root = await fixture();
  const plan = await buildActivationPlan(root, {
    captured_at: "2026-08-24T10:00:00Z",
    baseline_commit: "abcdef1",
    applied_migration_versions: ["20260102000000"],
    deployed_edge_functions: [],
  });
  assert.deepEqual(plan.blockers.map(({ code }) => code), ["MIGRATION_LEDGER_GAP"]);
  assert.equal(plan.blockers[0].details.first_pending.version, "20260101000000");
});

test("rejects inventory fields that could smuggle configuration or secrets", async () => {
  const root = await fixture();
  await assert.rejects(
    buildActivationPlan(root, {
      captured_at: "2026-08-24T10:00:00Z",
      baseline_commit: "abcdef1",
      applied_migration_versions: [],
      deployed_edge_functions: [],
      access_token: "must-not-be-accepted",
    }),
    /unsupported fields.*access_token/i,
  );
});
