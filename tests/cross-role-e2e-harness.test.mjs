import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import { contractSuites, journeys, transactionalSqlSuites } from "./e2e/cross-role-journeys.mjs"

test("journey matrix covers every supported operational role", () => {
  assert.deepEqual(
    journeys.map(({ role }) => role),
    ["owner", "client", "partner", "contractor", "lead_referrer", "partner_sub_agent"],
  )
})

test("partner and sub-agent journeys require cross-tenant denial proof", () => {
  for (const role of ["partner", "partner_sub_agent"]) {
    assert.ok(journeys.find((journey) => journey.role === role)?.proof.includes("cross-tenant-denial"))
  }
  assert.ok(transactionalSqlSuites.includes("supabase/tests/partner_view_leak_tests.sql"))
})

test("composed contract suites and SQL fixtures exist", async () => {
  for (const file of [...contractSuites, ...transactionalSqlSuites]) {
    assert.ok((await readFile(new URL(`../${file}`, import.meta.url), "utf8")).length > 0, file)
  }
})

test("all database smoke fixtures roll back", async () => {
  for (const file of transactionalSqlSuites) {
    const sql = await readFile(new URL(`../${file}`, import.meta.url), "utf8")
    assert.match(sql, /\bbegin\s*;/i, file)
    assert.match(sql, /\brollback\s*;/i, file)
  }
})

test("runner refuses known production targets", async () => {
  const runner = await readFile(new URL("../scripts/run-cross-role-e2e.mjs", import.meta.url), "utf8")
  assert.match(runner, /fund-now-capital-2026\.vercel\.app/)
  assert.match(runner, /supabase\.co/)
  assert.match(runner, /Refusing to run the cross-role harness against a production target/)
})
