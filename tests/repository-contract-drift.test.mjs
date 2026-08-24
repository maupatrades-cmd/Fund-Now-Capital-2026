import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { inspectRepository } from "../scripts/verify-repository-contracts.mjs";

async function fixture({ source, sql = "", edgeFunctions = [] }) {
  const root = await mkdtemp(path.join(tmpdir(), "fnc-contract-preflight-"));
  await mkdir(path.join(root, "src"), { recursive: true });
  await mkdir(path.join(root, "supabase", "migrations"), { recursive: true });
  await writeFile(path.join(root, "src", "contract.ts"), source);
  await writeFile(path.join(root, "supabase", "migrations", "20260101000000_fixture.sql"), sql);
  for (const name of edgeFunctions) {
    const directory = path.join(root, "supabase", "functions", name);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "index.ts"), "export {};\n");
  }
  return root;
}

test("passes when literal RPC and Edge Function contracts exist in repository source", async () => {
  const root = await fixture({
    source: `
      supabase.rpc("owner_workspace");
      supabase.functions.invoke('send-example');
    `,
    sql: "create or replace function public.owner_workspace() returns jsonb language sql as $$ select '{}'::jsonb $$;",
    edgeFunctions: ["send-example"],
  });
  const result = await inspectRepository(root);
  assert.deepEqual(result.missingRpcs, []);
  assert.deepEqual(result.missingEdgeFunctions, []);
});

test("fails closed when repository source is missing", async () => {
  const root = await fixture({
    source: `
      supabase.rpc("missing_workspace");
      supabase.functions.invoke("missing-edge");
    `,
  });
  const result = await inspectRepository(root);
  assert.deepEqual(result.missingRpcs.map(({ name }) => name), ["missing_workspace"]);
  assert.deepEqual(result.missingEdgeFunctions.map(({ name }) => name), ["missing-edge"]);
});

test("reports non-literal call sites for explicit manual verification", async () => {
  const root = await fixture({ source: "supabase.rpc(selectedRpc);" });
  const result = await inspectRepository(root);
  assert.deepEqual(result.missingRpcs, []);
  assert.equal(result.dynamicCalls.length, 1);
  assert.equal(result.dynamicCalls[0].expression, "selectedRpc");
});

