import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import process from "node:process"
import { contractSuites, transactionalSqlSuites } from "../tests/e2e/cross-role-journeys.mjs"
import { parseHostList, runAuthenticatedCrossRoleSmoke } from "../tests/e2e/authenticated-cross-role-runner.mjs"

const forbiddenTargets = ["fund-now-capital-2026.vercel.app", "supabase.co"]
const configuredTarget = `${process.env.FNC_E2E_TARGET_URL ?? ""}`.toLowerCase()

if (configuredTarget && forbiddenTargets.some((target) => configuredTarget.includes(target))) {
  console.error("Refusing to run the cross-role harness against a production target.")
  process.exit(2)
}

for (const file of transactionalSqlSuites) {
  const sql = readFileSync(resolve(file), "utf8")
  if (!/\bbegin\s*;/i.test(sql) || !/\brollback\s*;/i.test(sql)) {
    console.error(`Unsafe SQL smoke fixture: ${file} must be transaction-wrapped.`)
    process.exit(2)
  }
}

if (process.env.FNC_E2E_AUTHENTICATED === "1") {
  if (process.env.FNC_E2E_ARMED !== "I_UNDERSTAND_THIS_CREATES_DISPOSABLE_FIXTURES") {
    console.error("Authenticated mode is not armed. Set FNC_E2E_ARMED to the documented acknowledgement.")
    process.exit(2)
  }
  try {
    const result = await runAuthenticatedCrossRoleSmoke({
      appTarget: process.env.FNC_E2E_TARGET_URL,
      supabaseTarget: process.env.FNC_E2E_SUPABASE_URL,
      anonKey: process.env.FNC_E2E_SUPABASE_ANON_KEY,
      allowedHosts: parseHostList(process.env.FNC_E2E_ALLOWED_HOSTS),
      productionHosts: parseHostList(process.env.FNC_E2E_PRODUCTION_HOSTS),
      adapterPath: resolve(process.env.FNC_E2E_FIXTURE_ADAPTER ?? ""),
    })
    console.log(`Authenticated cross-role smoke passed for ${result.namespace}. Fixtures removed.`)
    process.exit(0)
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}

console.log("Cross-role E2E foundation: running zero-write source contracts.")
console.log("Transactional SQL suites were safety-checked but are not executed automatically.")

const result = spawnSync(process.execPath, ["--test", ...contractSuites], {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit",
})

process.exit(result.status ?? 1)
