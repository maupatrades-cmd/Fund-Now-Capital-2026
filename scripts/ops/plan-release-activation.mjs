#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(SCRIPT_DIR, "../..");
const ALLOWED_INVENTORY_KEYS = new Set([
  "captured_at",
  "baseline_commit",
  "applied_migrations",
  "applied_migration_versions",
  "deployed_edge_functions",
]);

async function walk(directory, predicate) {
  if (!existsSync(directory)) return [];
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await walk(target, predicate)));
    else if (predicate(target)) result.push(target);
  }
  return result;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assertInventory(inventory) {
  const extras = Object.keys(inventory).filter((key) => !ALLOWED_INVENTORY_KEYS.has(key));
  if (extras.length) throw new Error(`Inventory contains unsupported fields: ${extras.join(", ")}. Keep secrets and project configuration out of this file.`);
  if (!inventory.captured_at || Number.isNaN(Date.parse(inventory.captured_at))) throw new Error("Inventory captured_at must be an ISO date.");
  if (!inventory.baseline_commit || !/^[0-9a-f]{7,40}$/i.test(inventory.baseline_commit)) {
    throw new Error("Inventory baseline_commit must be the 7-40 character Git commit audited for release.");
  }
  if (!Array.isArray(inventory.deployed_edge_functions) || inventory.deployed_edge_functions.some((value) => typeof value !== "string")) {
    throw new Error("Inventory deployed_edge_functions must be an array of strings.");
  }
  if (!Array.isArray(inventory.applied_migrations) && !Array.isArray(inventory.applied_migration_versions)) {
    throw new Error("Inventory must provide applied_migrations or applied_migration_versions.");
  }
  if (inventory.applied_migrations && inventory.applied_migrations.some((row) => (
    !row || typeof row !== "object" || !/^\d{14}$/.test(row.version) || typeof row.name !== "string" || !row.name.trim()
  ))) {
    throw new Error("Inventory applied_migrations must contain { version, name } rows.");
  }
  if (inventory.applied_migration_versions && inventory.applied_migration_versions.some((value) => typeof value !== "string")) {
    throw new Error("Inventory applied_migration_versions must be an array of strings.");
  }
  const badVersion = (inventory.applied_migration_versions ?? []).find((version) => !/^\d{14}$/.test(version));
  if (badVersion) throw new Error(`Invalid migration version in inventory: ${badVersion}`);
  const badFunction = inventory.deployed_edge_functions.find((name) => !/^[a-z0-9][a-z0-9-]*$/.test(name));
  if (badFunction) throw new Error(`Invalid Edge Function name in inventory: ${badFunction}`);
  if (inventory.applied_migration_versions && new Set(inventory.applied_migration_versions).size !== inventory.applied_migration_versions.length) {
    throw new Error("Inventory applied_migration_versions contains duplicate values.");
  }
  if (inventory.applied_migrations && new Set(inventory.applied_migrations.map(({ version }) => version)).size !== inventory.applied_migrations.length) {
    throw new Error("Inventory applied_migrations contains duplicate versions.");
  }
  if (new Set(inventory.deployed_edge_functions).size !== inventory.deployed_edge_functions.length) throw new Error("Inventory deployed_edge_functions contains duplicate values.");
}

export function normalizeMigrationName(name) {
  let normalized = name.trim().toLowerCase().replace(/\.sql$/, "");
  while (/^\d{14}_/.test(normalized)) normalized = normalized.slice(15);
  return normalized;
}

function smokeCommands(pendingMigrations, pendingFunctions) {
  const names = [...pendingMigrations.map(({ file }) => file), ...pendingFunctions].join("\n");
  const commands = new Set(["npm run test:repository-contracts", "npm run lint", "npm run build"]);
  const rules = [
    [/team_lead_referrer_onboarding|admin-invite-user|change-user-password/, "npm run test:role-onboarding-smoke"],
    [/calendar|booking|send-booking-confirmation/, "npm run test:calendar-booking-rules"],
    [/partner_subagent/, "npm run test:partner-subagent-operations"],
    [/lead_referrer_operational/, "node --test tests/lead-referrer-operations.test.mjs"],
    [/contractor_document_chase/, "npm run test:contractor-document-chase"],
    [/client_funding_offer/, "npm run test:client-funding-offers"],
    [/client_portal|client-invitation|client-application/, "npm run test:client-portal-smoke"],
    [/commission|invoice|payable|repayment/, "Run supabase/tests/money_lifecycle_smoke.sql in an approved non-production test transaction"],
  ];
  for (const [pattern, command] of rules) if (pattern.test(names)) commands.add(command);
  return [...commands];
}

export async function buildActivationPlan(root, inventory) {
  assertInventory(inventory);
  const migrationDirectory = path.join(root, "supabase", "migrations");
  const functionDirectory = path.join(root, "supabase", "functions");
  const migrationPaths = (await walk(migrationDirectory, (file) => file.endsWith(".sql"))).sort();
  const migrations = await Promise.all(migrationPaths.map(async (file) => {
    const match = path.basename(file).match(/^(\d{14})_(.+)\.sql$/);
    const body = await readFile(file, "utf8");
    return match ? {
      version: match[1],
      name: match[2],
      file: path.relative(root, file).replaceAll("\\", "/"),
      sha256: sha256(body),
    } : null;
  }));
  const invalidMigrationFiles = migrationPaths.filter((_, index) => migrations[index] === null).map((file) => path.basename(file));
  const validMigrations = migrations.filter(Boolean);
  const versionGroups = new Map();
  for (const migration of validMigrations) {
    const group = versionGroups.get(migration.version) ?? [];
    group.push(migration);
    versionGroups.set(migration.version, group);
  }
  const duplicateVersions = [...versionGroups].filter(([, rows]) => rows.length > 1).map(([version, rows]) => ({ version, files: rows.map(({ file }) => file) }));

  const repoFunctionNames = existsSync(functionDirectory)
    ? (await readdir(functionDirectory, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && existsSync(path.join(functionDirectory, entry.name, "index.ts")))
      .map(({ name }) => name).sort()
    : [];
  const appliedRows = inventory.applied_migrations ?? inventory.applied_migration_versions.map((version) => ({ version, name: "" }));
  const applied = new Set(appliedRows.map(({ version }) => version));
  const deployed = new Set(inventory.deployed_edge_functions);
  const localVersions = new Set(validMigrations.map(({ version }) => version));
  const repositoryByLogicalName = new Map();
  for (const migration of validMigrations) {
    const name = normalizeMigrationName(migration.name);
    const group = repositoryByLogicalName.get(name) ?? [];
    group.push(migration);
    repositoryByLogicalName.set(name, group);
  }
  const liveByLogicalName = new Map();
  for (const migration of appliedRows) {
    if (!migration.name) continue;
    const name = normalizeMigrationName(migration.name);
    const group = liveByLogicalName.get(name) ?? [];
    group.push(migration);
    liveByLogicalName.set(name, group);
  }
  const ambiguousRepositoryNames = [...repositoryByLogicalName]
    .filter(([, rows]) => rows.length > 1)
    .map(([name, rows]) => ({ name, files: rows.map(({ file }) => file) }));
  const ambiguousLiveNames = [...liveByLogicalName]
    .filter(([, rows]) => rows.length > 1)
    .map(([name, rows]) => ({ name, migrations: rows }));
  const matchedRepositoryVersions = new Set();
  const logicalNameAliases = [];
  const liveOnlyMigrations = [];
  for (const live of appliedRows) {
    if (localVersions.has(live.version)) {
      matchedRepositoryVersions.add(live.version);
      continue;
    }
    const candidates = live.name ? (repositoryByLogicalName.get(normalizeMigrationName(live.name)) ?? []) : [];
    if (candidates.length === 1) {
      matchedRepositoryVersions.add(candidates[0].version);
      logicalNameAliases.push({ live, repository: candidates[0] });
    } else {
      liveOnlyMigrations.push(live);
    }
  }
  const pendingMigrations = validMigrations.filter(({ version }) => !matchedRepositoryVersions.has(version));
  const liveOnlyMigrationVersions = liveOnlyMigrations.map(({ version }) => version).sort();
  const pendingFunctions = repoFunctionNames.filter((name) => !deployed.has(name));
  const liveOnlyFunctions = [...deployed].filter((name) => !repoFunctionNames.includes(name)).sort();

  const blockers = [];
  if (invalidMigrationFiles.length) blockers.push({ code: "INVALID_MIGRATION_FILENAME", details: invalidMigrationFiles });
  if (duplicateVersions.length) blockers.push({ code: "DUPLICATE_MIGRATION_VERSION", details: duplicateVersions });
  if (ambiguousRepositoryNames.length) blockers.push({ code: "AMBIGUOUS_REPOSITORY_MIGRATION_NAME", details: ambiguousRepositoryNames });
  if (ambiguousLiveNames.length) blockers.push({ code: "AMBIGUOUS_LIVE_MIGRATION_NAME", details: ambiguousLiveNames });
  const firstPendingIndex = validMigrations.findIndex(({ version }) => !matchedRepositoryVersions.has(version));
  const appliedAfterGap = firstPendingIndex < 0
    ? []
    : validMigrations.slice(firstPendingIndex + 1).filter(({ version }) => matchedRepositoryVersions.has(version)).map(({ version, file }) => ({ version, file }));
  if (appliedAfterGap.length) {
    blockers.push({
      code: "MIGRATION_LEDGER_GAP",
      details: {
        first_pending: validMigrations[firstPendingIndex],
        later_applied: appliedAfterGap,
      },
    });
  }
  if (liveOnlyMigrationVersions.length) blockers.push({ code: "LIVE_ONLY_MIGRATION", details: liveOnlyMigrationVersions });
  if (liveOnlyFunctions.length) blockers.push({ code: "LIVE_ONLY_EDGE_FUNCTION", details: liveOnlyFunctions });
  return {
    generated_at: new Date().toISOString(),
    inventory_captured_at: inventory.captured_at,
    baseline_commit: inventory.baseline_commit,
    safety: {
      mode: "READ_ONLY_PLAN",
      single_actor_required: true,
      live_changes_performed: false,
      instruction: "STOP if another migration/deployment actor is active. One named actor executes and verifies one step at a time.",
    },
    counts: {
      repository_migrations: validMigrations.length,
      applied_migrations: applied.size,
      pending_migrations: pendingMigrations.length,
      repository_edge_functions: repoFunctionNames.length,
      deployed_edge_functions: deployed.size,
      pending_edge_functions: pendingFunctions.length,
    },
    blockers,
    pending_migrations: pendingMigrations,
    pending_edge_functions: pendingFunctions,
    logical_name_aliases: logicalNameAliases,
    live_only_migrations: liveOnlyMigrations,
    live_only_migration_versions: liveOnlyMigrationVersions,
    live_only_edge_functions: liveOnlyFunctions,
    smoke_commands: smokeCommands(pendingMigrations, pendingFunctions),
  };
}

export function renderMarkdown(plan) {
  const lines = [
    "# FNC release activation plan", "",
    `- Generated: ${plan.generated_at}`,
    `- Sanitized live inventory captured: ${plan.inventory_captured_at}`,
    `- Baseline commit: ${plan.baseline_commit ?? "not supplied"}`,
    `- Mode: **${plan.safety.mode}**`,
    `- Live changes performed: **${plan.safety.live_changes_performed}**`, "",
    `> **SINGLE ACTOR REQUIRED.** ${plan.safety.instruction}`, "",
    "## Decision", "",
    plan.blockers.length ? "**BLOCKED. Do not apply or deploy until every drift finding below is reconciled.**" : "**PREFLIGHT CLEAR. The named single actor may execute the ordered plan with owner approval.**", "",
    "## Inventory delta", "",
    `- Repository migrations: ${plan.counts.repository_migrations}`,
    `- Applied migration versions reported: ${plan.counts.applied_migrations}`,
    `- Pending migrations: ${plan.counts.pending_migrations}`,
    `- Logical-name ledger aliases reconciled: ${plan.logical_name_aliases.length}`,
    `- Repository Edge Functions: ${plan.counts.repository_edge_functions}`,
    `- Deployed Edge Functions reported: ${plan.counts.deployed_edge_functions}`,
    `- Pending Edge Functions: ${plan.counts.pending_edge_functions}`, "",
    "## Drift blockers", "",
    ...(plan.blockers.length ? plan.blockers.map((finding) => `- **${finding.code}**: \`${JSON.stringify(finding.details)}\``) : ["None."]), "",
    "## Reconciled migration aliases", "",
    ...(plan.logical_name_aliases.length ? plan.logical_name_aliases.map(({ live, repository }) => `- Live \`${live.version}_${live.name}\` matches repository \`${repository.file}\` by normalized logical name.`) : ["None."]), "",
    "## Ordered migration activation", "",
    ...(plan.pending_migrations.length ? plan.pending_migrations.flatMap((migration, index) => [
      `${index + 1}. Apply \`${migration.file}\` (version \`${migration.version}\`, SHA-256 \`${migration.sha256}\`).`,
      "   - Verify its transaction succeeded and required objects exist before continuing.",
      "   - Re-capture the migration ledger; stop immediately if ledger and schema disagree.",
    ]) : ["No pending repository migrations reported."]), "",
    "## Ordered Edge Function deployment", "",
    ...(plan.pending_edge_functions.length ? plan.pending_edge_functions.map((name, index) => `${index + 1}. Deploy \`${name}\` from \`supabase/functions/${name}/index.ts\`; verify its deployed version, authenticated success path and unauthorized denial path.`) : ["No pending repository Edge Functions reported."]), "",
    "## Required verification", "",
    ...plan.smoke_commands.map((command) => `- \`${command}\``), "",
    "## Completion gate", "",
    "Do not mark activation complete until the repository commit, live migration ledger, live object existence, deployed Edge Function versions and exact role smoke results all agree. This report never applies migrations, deploys functions, reads secrets or links a project.", "",
  ];
  return `${lines.join("\n")}\n`;
}

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!value || !["--inventory", "--output", "--json-output", "--root"].includes(flag)) throw new Error(`Unknown or incomplete argument: ${flag}`);
    parsed[flag.slice(2)] = value;
  }
  return parsed;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.inventory) throw new Error("Provide --inventory <sanitized-live-inventory.json>. No live state is assumed.");
  const root = path.resolve(args.root ?? DEFAULT_ROOT);
  const inventory = JSON.parse(await readFile(path.resolve(args.inventory), "utf8"));
  const plan = await buildActivationPlan(root, inventory);
  const markdown = renderMarkdown(plan);
  if (args.output) await writeFile(path.resolve(args.output), markdown);
  else process.stdout.write(markdown);
  if (args["json-output"]) await writeFile(path.resolve(args["json-output"]), `${JSON.stringify(plan, null, 2)}\n`);
  if (plan.blockers.length) process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
