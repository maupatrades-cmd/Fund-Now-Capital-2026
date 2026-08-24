import assert from "node:assert/strict"
import test from "node:test"
import {
  assertSafeTarget,
  createRunNamespace,
  parseHostList,
  requiredRoles,
  runAuthenticatedCrossRoleSmoke,
} from "./e2e/authenticated-cross-role-runner.mjs"

test("authenticated runner covers all six operational identities", () => {
  assert.deepEqual(requiredRoles, ["owner", "client", "partner", "contractor", "lead_referrer", "partner_sub_agent"])
})

test("run namespaces are unique and visibly synthetic", () => {
  const first = createRunNamespace()
  const second = createRunNamespace()
  assert.match(first, /^fnc-e2e-\d{14}-[a-f0-9]{8}$/)
  assert.notEqual(first, second)
})

test("targets require an exact allow-list match", () => {
  const allowed = parseHostList("localhost:54321,preview.example.test")
  assert.equal(assertSafeTarget("http://localhost:54321", allowed).host, "localhost:54321")
  assert.throws(() => assertSafeTarget("https://unlisted.example.test", allowed), /not in FNC_E2E_ALLOWED_HOSTS/)
})

test("known and operator-declared production hosts are refused even if allowed", () => {
  assert.throws(
    () => assertSafeTarget("https://fund-now-capital-2026.vercel.app", new Set(["fund-now-capital-2026.vercel.app"])),
    /Refusing production host/,
  )
  assert.throws(
    () => assertSafeTarget("https://crm.example.test", new Set(["crm.example.test"]), new Set(["crm.example.test"])),
    /Refusing production host/,
  )
})

test("cleanup runs for the generated namespace even when fixture setup fails", async () => {
  const cleanupCalls = []
  const namespace = "fnc-e2e-20260824170000-deadbeef"
  await assert.rejects(
    runAuthenticatedCrossRoleSmoke({
      appTarget: "http://app.example.test",
      supabaseTarget: "http://db.example.test",
      anonKey: "test-anon-key",
      allowedHosts: new Set(["app.example.test", "db.example.test"]),
      productionHosts: new Set(),
      namespace,
      adapterModule: {
        async setup() { throw new Error("setup failed") },
        async cleanup(context) {
          cleanupCalls.push(context)
          return { namespace: context.namespace, removed: true }
        },
      },
    }),
    /setup failed/,
  )
  assert.equal(cleanupCalls.length, 1)
  assert.equal(cleanupCalls[0].namespace, namespace)
  assert.equal(cleanupCalls[0].plan, undefined)
})
