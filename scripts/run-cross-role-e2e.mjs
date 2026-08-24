import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import process from "node:process"
import { contractSuites, transactionalSqlSuites } from "../tests/e2e/cross-role-journeys.mjs"

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

console.log("Cross-role E2E foundation: running zero-write source contracts.")
console.log("Transactional SQL suites were safety-checked but are not executed automatically.")

const result = spawnSync(process.execPath, ["--test", ...contractSuites], {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit",
})

process.exit(result.status ?? 1)
