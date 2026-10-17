import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/ownerCommission.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } });
const { commissionAmount, effectiveCommission, canApproveCommission, commissionPercentage, collectCommissionRows } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

test("entered amounts remain exact decimal strings up to the database limit", () => {
  assert.equal(commissionAmount(" 00012.3 "), "12.30");
  assert.equal(commissionAmount("0"), "0.00");
  assert.equal(commissionAmount("999999999999.99"), "999999999999.99");
  for (const value of ["1.005", "1e3", "NaN", "Infinity", "1,000", "1000000000000", "", "-1", "+1", ".50"]) {
    assert.throws(() => commissionAmount(value), /two decimal places/);
  }
});

test("corrections retain exact cents without modifying the original or unrelated allocations", () => {
  const entry = { id: "a", amount: "0.10" };
  const adjustments = [{ entry_id: "a", delta: "0.20" }, { entry_id: "a", delta: "-0.05" }, { entry_id: "other", delta: "999.99" }];
  assert.equal(effectiveCommission(entry, adjustments), "0.25");
  assert.equal(entry.amount, "0.10");
  assert.equal(effectiveCommission({ id: "b", amount: "999999999999.99" }, [{ entry_id: "b", delta: "-0.01" }]), "999999999999.98");
  assert.equal(commissionAmount("-0.00", true), "0.00");
  assert.throws(() => commissionAmount("-0.005", true));
});

test("approval requires server reconciliation, resolved flags and a real draft", () => {
  const reconciled = { reconciled: true, open_flags: 0 };
  const drafts = [{ status: "draft" }];
  assert.equal(canApproveCommission(reconciled, drafts), true);
  assert.equal(canApproveCommission({ ...reconciled, reconciled: false }, drafts), false);
  assert.equal(canApproveCommission({ ...reconciled, open_flags: 1 }, drafts), false);
  assert.equal(canApproveCommission(reconciled, [{ status: "approved" }, { status: "paid" }, { status: "void" }]), false);
  assert.equal(canApproveCommission(reconciled, []), false);
});

test("optional percentages cannot introduce invalid or silently rounded terms", () => {
  assert.equal(commissionPercentage(""), null);
  for (const value of ["0", "28", "12.1234", "100.0000"]) assert.equal(commissionPercentage(value), value);
  for (const value of ["100.0001", "-1", "1e2", "28.12345", "NaN"]) assert.throws(() => commissionPercentage(value));
});

test("server row caps never silently truncate beneficiaries or adjustment history", async () => {
  const sourceRows = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }];
  const requestedOffsets = [];
  const result = await collectCommissionRows(async (start) => {
    requestedOffsets.push(start);
    return { data: sourceRows.slice(start, start + 2), error: null };
  });
  assert.deepEqual(result, sourceRows);
  assert.deepEqual(requestedOffsets, [0, 2, 4, 5]);
});

test("a later read failure rejects the workspace instead of showing partial financial history", async () => {
  await assert.rejects(collectCommissionRows(async (start) => start === 0
    ? { data: [{ id: 1 }], error: null }
    : { data: null, error: { message: "History could not be read" } }), /History could not be read/);
});
