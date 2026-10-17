import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
const compile = (source) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText;
const moneySource = compile(await readFile(new URL("../src/lib/ownerCommission.ts", import.meta.url), "utf8"));
const { collectCommissionRows, commissionAmount, UnconfirmedCommissionChange } = await import(`data:text/javascript;base64,${Buffer.from(moneySource).toString("base64")}`);
const source = compile(await readFile(new URL("../src/hooks/useOwnerCommissionNotices.ts", import.meta.url), "utf8")).replace(/^import .*;$/gm, "").replaceAll("export ", "");
const load = new Function("useMutation", "useQuery", "useQueryClient", "useSession", "useProfileRole", "supabase", "commissionAmount", "UnconfirmedCommissionChange", "collectCommissionRows", "invalidateActivity", source + ";return {useIssueCommissionNotice,useOwnerCommissionNotices};");
function fixture({ uid = "owner", openedUid = uid, role = "owner", switchOnSecondCheck = false, rpcError = null, notices = [] } = {}) {
  const calls = [], invalidations = []; let checks = 0;
  const supabase = { auth: { getUser: async () => ({ data: { user: { id: switchOnSecondCheck && ++checks > 1 ? "different" : uid } }, error: null }) },
    rpc: (name, args) => {
      calls.push({ name, args });
      const response = { data: rpcError ? null : name.startsWith("staff_") ? notices : "notice-id", error: rpcError,
        order() { return response; }, range(start) { return Promise.resolve({ data: rpcError ? null : notices.slice(start,start+2), error: rpcError }); } };
      return response;
    } };
  const hooks = load((v) => v, (v) => v, () => ({ invalidateQueries: async (v) => invalidations.push(v) }), () => uid ? { user: { id: uid } } : null, () => ({ data: role }), supabase, commissionAmount, UnconfirmedCommissionChange, collectCommissionRows, () => invalidations.push("activity"));
  return { command: hooks.useIssueCommissionNotice("deal",openedUid), query: hooks.useOwnerCommissionNotices("deal"), calls, invalidations };
}

test("Owner notice issuance sends only allocation ID and exact amount, without automatic retries", async () => {
  const f = fixture(); assert.equal(f.command.retry,false);
  assert.equal(await f.command.mutationFn({ entryId: "allocation", amount: "0006.1" }), "notice-id");
  assert.deepEqual(f.calls, [{ name: "owner_issue_commission_notice", args: { p_entry_id: "allocation", p_expected_amount: "6.10" } }]);
  await f.command.onSettled();
  assert.deepEqual(f.invalidations[0].queryKey, ["owner-commission-notices","owner","deal"]);
});

test("session changes and ambiguous notice results cannot silently issue or retry", async () => {
  const changed = fixture({ openedUid: "previous-owner" });
  await assert.rejects(changed.command.mutationFn({ entryId: "allocation", amount: "6" }), /session changed/);
  assert.equal(changed.calls.length,0);
  const ambiguous = fixture({ rpcError: { message: "Connection lost" } });
  await assert.rejects(ambiguous.command.mutationFn({ entryId: "allocation", amount: "6" }), UnconfirmedCommissionChange);
});

test("Owner notice reads use a private per-account cache and reject account switches during fetch", async () => {
  const f = fixture(); assert.equal(f.query.enabled,true); assert.equal(f.query.gcTime,0);
  assert.notDeepEqual(f.query.queryKey, fixture({ uid: "another-owner" }).query.queryKey);
  assert.equal(fixture({ role: "coordinator" }).query.enabled,false);
  assert.equal(fixture({ uid: null }).query.enabled,false);
  assert.deepEqual(await f.query.queryFn(),[]);
  await assert.rejects(fixture({ switchOnSecondCheck: true }).query.queryFn(), /session changed/);
});

test("notice history continues past server caps instead of hiding newer revisions", async () => {
  const notices = [{ commission_notice_id: "first" }, { commission_notice_id: "second" }, { commission_notice_id: "newest" }];
  const f = fixture({ notices });
  assert.deepEqual(await f.query.queryFn(),notices);
  assert.equal(f.calls.length,3);
});
