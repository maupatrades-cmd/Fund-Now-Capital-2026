import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowUrl = new URL("../.github/workflows/release-ci.yml", import.meta.url);

test("release CI runs every required read-only repository gate", async () => {
  const workflow = await readFile(workflowUrl, "utf8");

  for (const command of [
    "npm ci --no-audit --no-fund",
    "npm run build",
    "npm run lint",
    "npm run test:repository-contracts",
    "npm run test:build-register",
    "npm run test:release-activation",
    "npm run test:cross-role-e2e",
    "npm run test:money-command-center",
    "npm run test:release-ci",
  ]) {
    assert.ok(workflow.includes(`run: ${command}`), `missing CI gate: ${command}`);
  }
});

test("release CI is least privilege and cannot target production", async () => {
  const workflow = await readFile(workflowUrl, "utf8");

  assert.match(workflow, /permissions:\s*\n\s+contents: read/);
  assert.match(workflow, /persist-credentials: false/);
  assert.doesNotMatch(workflow, /secrets\./i);
  assert.doesNotMatch(workflow, /supabase\.co|fund-now-capital-2026\.vercel\.app/i);
  assert.doesNotMatch(workflow, /supabase\s+(?:db\s+push|migration\s+up|functions\s+deploy)|vercel\s+(?:--prod|deploy)/i);
  assert.doesNotMatch(workflow, /apply[_ -]?migration/i);
});

test("release CI is bounded and cancels superseded runs", async () => {
  const workflow = await readFile(workflowUrl, "utf8");

  assert.match(workflow, /timeout-minutes: 20/);
  assert.match(workflow, /cancel-in-progress: true/);
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /push:\s*\n\s+branches:\s*\n\s+- main/);
});
