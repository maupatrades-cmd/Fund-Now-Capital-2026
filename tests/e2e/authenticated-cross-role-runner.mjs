import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { pathToFileURL } from "node:url"

export const requiredRoles = ["owner", "client", "partner", "contractor", "lead_referrer", "partner_sub_agent"]
const defaultProductionHosts = new Set(["fund-now-capital-2026.vercel.app"])

export function createRunNamespace() {
  return `fnc-e2e-${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14)}-${randomUUID().slice(0, 8)}`
}

export function parseHostList(value = "") {
  return new Set(value.split(",").map((host) => host.trim().toLowerCase()).filter(Boolean))
}

export function assertSafeTarget(rawUrl, allowedHosts, productionHosts = new Set()) {
  assert.ok(rawUrl, "A target URL is required")
  const target = new URL(rawUrl)
  assert.ok(["http:", "https:"].includes(target.protocol), "Only HTTP(S) targets are supported")
  const host = target.host.toLowerCase()
  const denied = new Set([...defaultProductionHosts, ...productionHosts])
  assert.ok(allowedHosts.size > 0, "FNC_E2E_ALLOWED_HOSTS must explicitly allow every disposable target")
  assert.ok(allowedHosts.has(host), `Target host ${host} is not in FNC_E2E_ALLOWED_HOSTS`)
  assert.ok(!denied.has(host), `Refusing production host ${host}`)
  return target
}

function assertFixturePlan(plan, namespace) {
  assert.equal(plan?.disposable, true, "Fixture adapter must mark the environment disposable")
  assert.equal(plan?.namespace, namespace, "Fixture adapter must preserve the generated run namespace")
  for (const role of requiredRoles) {
    assert.ok(plan.roles?.[role]?.email, `Missing ${role} email`)
    assert.ok(plan.roles?.[role]?.password, `Missing ${role} password`)
    assert.ok(Array.isArray(plan.checks?.[role]) && plan.checks[role].length > 0, `Missing ${role} checks`)
    if (role !== "owner") {
      assert.ok(plan.checks[role].some(({ kind }) => kind === "denial"), `${role} requires a cross-role denial assertion`)
    }
  }
}

async function signIn(supabaseUrl, anonKey, credentials, fetchImpl) {
  const response = await fetchImpl(new URL("/auth/v1/token?grant_type=password", supabaseUrl), {
    method: "POST",
    headers: { apikey: anonKey, "content-type": "application/json" },
    body: JSON.stringify(credentials),
  })
  assert.equal(response.status, 200, `Authentication failed for ${credentials.email}`)
  const payload = await response.json()
  assert.ok(payload.access_token, `Authentication returned no access token for ${credentials.email}`)
  return payload.access_token
}

async function executeCheck(target, anonKey, token, check, fetchImpl) {
  assert.ok(check?.name, "Every journey check needs a name")
  assert.ok(["allow", "denial"].includes(check.kind), `${check.name}: invalid check kind`)
  assert.ok(check.request?.path?.startsWith("/"), `${check.name}: request path must be relative`)
  const response = await fetchImpl(new URL(check.request.path, target), {
    method: check.request.method ?? "GET",
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(check.request.headers ?? {}),
    },
    body: check.request.body === undefined ? undefined : JSON.stringify(check.request.body),
  })
  const body = response.status === 204 ? null : await response.json().catch(() => null)
  if (check.kind === "allow") {
    assert.ok((check.expectedStatuses ?? [200]).includes(response.status), `${check.name}: unexpected ${response.status}`)
    if (check.minimumRows !== undefined) {
      assert.ok(Array.isArray(body) && body.length >= check.minimumRows, `${check.name}: insufficient visible rows`)
    }
    return
  }
  const deniedByStatus = [401, 403, 404].includes(response.status)
  const deniedByRls = response.status === 200 && Array.isArray(body) && body.length === 0
  assert.ok(deniedByStatus || deniedByRls, `${check.name}: cross-role data was visible`)
}

export async function runAuthenticatedCrossRoleSmoke({
  appTarget,
  supabaseTarget,
  anonKey,
  allowedHosts,
  productionHosts,
  adapterPath,
  adapterModule,
  fetchImpl = fetch,
  namespace = createRunNamespace(),
}) {
  const appUrl = assertSafeTarget(appTarget, allowedHosts, productionHosts)
  const supabaseUrl = assertSafeTarget(supabaseTarget, allowedHosts, productionHosts)
  assert.ok(anonKey, "FNC_E2E_SUPABASE_ANON_KEY is required")
  assert.ok(adapterModule || adapterPath, "FNC_E2E_FIXTURE_ADAPTER is required")
  const adapter = adapterModule ?? await import(pathToFileURL(adapterPath).href)
  assert.equal(typeof adapter.setup, "function", "Fixture adapter must export setup(context)")
  assert.equal(typeof adapter.cleanup, "function", "Fixture adapter must export cleanup(context)")

  let plan
  let runError
  try {
    plan = await adapter.setup({ namespace, appUrl, supabaseUrl })
    assertFixturePlan(plan, namespace)
    for (const role of requiredRoles) {
      const token = await signIn(supabaseUrl, anonKey, plan.roles[role], fetchImpl)
      for (const check of plan.checks[role]) {
        await executeCheck(supabaseUrl, anonKey, token, check, fetchImpl)
      }
    }
  } catch (error) {
    runError = error
  } finally {
    const cleanup = await adapter.cleanup({ namespace, appUrl, supabaseUrl, plan, runError })
    assert.equal(cleanup?.namespace, namespace, "Cleanup must report the same run namespace")
    assert.equal(cleanup?.removed, true, "Cleanup must confirm removal of all namespaced fixtures")
  }
  if (runError) throw runError
  return { namespace, roles: [...requiredRoles] }
}
