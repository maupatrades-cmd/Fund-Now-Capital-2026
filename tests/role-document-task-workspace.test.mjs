import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(new URL("../supabase/migrations/20260824234000_role_document_task_workspace.sql", import.meta.url), "utf8");
const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
const portalShell = await readFile(new URL("../src/components/portal/PortalShell.tsx", import.meta.url), "utf8");
const leadShell = await readFile(new URL("../src/components/lead-referrer/LeadReferrerShell.tsx", import.meta.url), "utf8");
const component = await readFile(new URL("../src/components/tasks/RoleDocumentTaskWorkspace.tsx", import.meta.url), "utf8");

test("workspace reuses governed evidence and owner_tasks without a duplicate task table", () => {
  assert.doesNotMatch(migration, /create\s+table/i);
  assert.match(migration, /from public\.owner_tasks t/i);
  assert.match(migration, /join public\.deal_document_task_evidence e on e\.task_id = t\.id/i);
  assert.match(migration, /t\.task_kind in \('document_request','paperwork_review'\)/i);
});

test("role projection enforces caller assignment and hides internal notes", () => {
  assert.match(migration, /v_role = 'owner' or t\.assigned_to = v_uid/i);
  assert.doesNotMatch(migration.match(/create or replace function public\.role_document_task_workspace\(\)[\s\S]*?\$\$;/i)?.[0] ?? "", /t\.notes/i);
  assert.match(migration, /v_role not in \('owner','partner','contractor','lead_referrer'\)/i);
  assert.match(migration, /revoke all on function public\.role_document_task_workspace\(\) from public, anon/i);
});

test("only owner can reassign and unresolved evidence prevents false completion", () => {
  assert.match(migration, /if not public\.is_owner\(\).*Only the owner can reassign document tasks/is);
  assert.match(migration, /if p_status = 'completed' and v_is_submission_blocker then/i);
  assert.match(migration, /cannot be completed until the required document is accepted/i);
  assert.match(migration, /has_table_privilege\('authenticated','public\.owner_tasks','UPDATE'\)/i);
});

test("all three role portals expose the shared authorized task surface", () => {
  assert.match(app, /path="tasks" element=\{<RoleDocumentTasksPage portal="partner"/);
  assert.match(app, /path="tasks" element=\{<LeadReferrerTasksPage/);
  assert.match(portalShell, /Paperwork tasks/);
  assert.match(leadShell, /Paperwork tasks/);
  assert.match(component, /data-testid="role-document-task-workspace"/);
  assert.match(component, /Submission blocked:/);
});
