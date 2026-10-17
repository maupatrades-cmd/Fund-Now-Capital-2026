import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const ownerSource = await readFile(new URL("../src/lib/ownerCommission.ts", import.meta.url), "utf8");
const compile = (source) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText;
const owner = await import(`data:text/javascript;base64,${Buffer.from(compile(ownerSource)).toString("base64")}`);
const hookSource = await readFile(new URL("../src/hooks/useManualPayouts.ts", import.meta.url), "utf8");
// Evaluate the real hook with injected auth/query/database boundaries.
const runnable = compile(hookSource).replace(/^import .*;$/gm, "");
const makeHook = new Function("useQuery", "supabase", "useSession", "useProfileRole", "collectCommissionRows",
  runnable.replace("export function useManualPayouts", "function useManualPayouts") + "; return useManualPayouts;");

function fixture({ fail = false, switchAccount = false, role = "owner", uid = "owner-a" } = {}) {
  let identityReads = 0;
  const offsets = [];
  const tables = {
    owner_commission_entries: [{ id: "a" }, { id: "b" }, { id: "c" }],
    owner_commission_adjustments: [{ id: 1, entry_id: "a", delta: "0.01" }],
    owner_commission_flags: [{ id: "f", entry_id: "a", status: "open" }],
  };
  const supabase = {
    auth: { getUser: async () => ({ data: { user: { id: switchAccount && ++identityReads > 1 ? "other" : uid } }, error: null }) },
    from(table) {
      const query = { select() { return query; }, order() { return query; }, eq() { return query; },
        range(start) {
          offsets.push([table, start]);
          return Promise.resolve(fail && table === "owner_commission_adjustments"
            ? { data: null, error: { message: "Adjustment history unavailable" } }
            : { data: tables[table].slice(start, start + 1), error: null });
        } };
      return query;
    },
  };
  const query = makeHook((options) => options, supabase, () => uid ? { user: { id: uid } } : null, () => ({ data: role }), owner.collectCommissionRows)();
  return { query, offsets, tables };
}

test("manual payout reads retain every allocation, adjustment and open flag under a server cap", async () => {
  const { query, offsets, tables } = fixture();
  const data = await query.queryFn();
  assert.deepEqual(data.entries, tables.owner_commission_entries);
  assert.deepEqual(data.adjustments, tables.owner_commission_adjustments);
  assert.deepEqual(data.flags, tables.owner_commission_flags);
  assert.deepEqual(offsets.filter(([table]) => table === "owner_commission_entries").map(([, start]) => start), [0, 1, 2, 3]);
});

test("unreadable corrections or an account switch reject the entire manual payout snapshot", async () => {
  await assert.rejects(fixture({ fail: true }).query.queryFn(), /Adjustment history unavailable/);
  await assert.rejects(fixture({ switchAccount: true }).query.queryFn(), /session changed/);
});

test("manual payout caches are private per account and disabled outside Owner sessions", () => {
  const a = fixture().query;
  const b = fixture({ uid: "owner-b" }).query;
  assert.notDeepEqual(a.queryKey, b.queryKey);
  assert.equal(a.gcTime, 0);
  assert.equal(a.enabled, true);
  assert.equal(fixture({ role: "sales_coordinator" }).query.enabled, false);
  assert.equal(fixture({ uid: null }).query.enabled, false);
});
