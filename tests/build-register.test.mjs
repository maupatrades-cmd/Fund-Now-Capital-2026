import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { loadRegister, renderRegister } from "../scripts/render-build-register.mjs";

const root = path.resolve(import.meta.dirname, "..");

test("register has valid statuses, unique ids and resolvable dependencies", async () => {
  const register = await loadRegister();
  const allowed = new Set(Object.keys(register.status_definitions));
  const ids = register.items.map(({ id }) => id);
  assert.equal(new Set(ids).size, ids.length, "item ids must be unique");
  for (const item of register.items) {
    assert.ok(allowed.has(item.status), `${item.id} has an unknown status`);
    assert.ok(item.outcome && item.remaining, `${item.id} needs outcome and remaining text`);
    for (const dependency of item.depends_on) assert.ok(ids.includes(dependency), `${item.id} has unknown dependency ${dependency}`);
  }
  assert.deepEqual([...new Set(register.recommended_order)], register.recommended_order, "recommended order must not repeat items");
  assert.deepEqual(new Set(register.recommended_order), new Set(ids), "recommended order must cover every item");
});

test("every cited repository evidence path exists at the baseline", async () => {
  const register = await loadRegister();
  for (const item of register.items) {
    for (const evidence of item.repo_evidence) {
      await assert.doesNotReject(access(path.join(root, evidence)), `${item.id} evidence is missing: ${evidence}`);
    }
  }
});

test("committed markdown is generated from the machine-readable register", async () => {
  const register = await loadRegister();
  const committed = await readFile(path.join(root, "docs", "FNC-CANONICAL-OUTSTANDING-BUILD-REGISTER.md"), "utf8");
  assert.equal(committed, renderRegister(register));
});
