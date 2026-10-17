import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
const compile = (source) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText;
const library = compile(await readFile(new URL("../src/lib/ownerCommission.ts", import.meta.url), "utf8"));
const { commissionAmount, UnconfirmedCommissionChange } = await import(`data:text/javascript;base64,${Buffer.from(library).toString("base64")}`);
const source = compile(await readFile(new URL("../src/hooks/useManualCommissionPayment.ts", import.meta.url), "utf8"))
  .replace(/^import .*;$/gm, "").replaceAll("export ", "");
const load = new Function("useMutation", "useQueryClient", "useSession", "supabase", "commissionAmount", "UnconfirmedCommissionChange", "invalidateActivity", source + "; return useRecordManualPayment;");
function fixture({ openedUid = "owner", switchAfterUpload = false, uploadError = null, rpcError = null } = {}) {
  const calls = [], invalidations = [];
  let checks = 0;
  const supabase = {
    auth: { getUser: async () => ({ data: { user: { id: switchAfterUpload && ++checks > 1 ? "other" : "owner" } }, error: null }) },
    storage: { from: (bucket) => ({ upload: async (path, file, options) => { calls.push({ type: "upload", bucket, path, file, options }); return { error: uploadError }; } }) },
    rpc: async (name, args) => { calls.push({ type: "rpc", name, args }); return { data: rpcError ? null : { entry_id: "entry" }, error: rpcError }; },
  };
  const cache = { invalidateQueries: async (key) => invalidations.push(key) };
  const mutation = load((options) => options, () => cache, () => ({ user: { id: "owner" } }), supabase, commissionAmount, UnconfirmedCommissionChange, () => invalidations.push("activity"))(openedUid);
  const input = { entryId: "entry", amount: "0006.1", currency: "ZAR", reference: " EFT-001 ", file: new File(["proof"], "sensitive-bank-name.pdf", { type: "application/pdf" }) };
  return { mutation, input, calls, invalidations };
}

test("payment upload is private, non-overwriting and bound to the exact reviewed amount", async () => {
  const { mutation, input, calls, invalidations } = fixture();
  assert.equal(mutation.retry, false);
  await mutation.mutationFn(input);
  assert.equal(calls[0].bucket, "commission-payment-proofs");
  assert.equal(calls[0].options.upsert, false);
  assert.match(calls[0].path, /^owner\/entry\/[a-f0-9-]+\.pdf$/);
  assert.equal(calls[1].name, "owner_record_commission_payment");
  assert.deepEqual(calls[1].args, { p_entry_id: "entry", p_expected_amount: "6.10", p_currency: "ZAR", p_payment_reference: "EFT-001", p_proof_path: calls[0].path });
  await mutation.onSettled();
  assert.equal(invalidations.length, 4);
});

test("an account change before or after upload prevents the payment command", async () => {
  for (const options of [{ openedUid: "different" }, { switchAfterUpload: true }]) {
    const f = fixture(options);
    await assert.rejects(f.mutation.mutationFn(f.input), /session changed/);
    assert.equal(f.calls.some((call) => call.type === "rpc"), false);
  }
});

test("upload errors and invalid proof never request payment; ambiguous writes require history review", async () => {
  const upload = fixture({ uploadError: { message: "Network lost" } });
  await assert.rejects(upload.mutation.mutationFn(upload.input), /could not be confirmed/);
  assert.equal(upload.calls.some((call) => call.type === "rpc"), false);
  const invalid = fixture();
  await assert.rejects(invalid.mutation.mutationFn({ ...invalid.input, file: new File(["x"], "script.html", { type: "text/html" }) }), /PDF, PNG or JPEG/);
  assert.equal(invalid.calls.length, 0);
  const ambiguous = fixture({ rpcError: { message: "Lost response" } });
  await assert.rejects(ambiguous.mutation.mutationFn(ambiguous.input), UnconfirmedCommissionChange);
});
