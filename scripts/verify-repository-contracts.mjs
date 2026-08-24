#!/usr/bin/env node

import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(SCRIPT_DIR, "..");
const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".ts", ".tsx"]);

async function walk(directory, predicate) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(target, predicate)));
    else if (predicate(target)) files.push(target);
  }
  return files;
}

function stripSqlComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\r\n]*/g, " ");
}

function location(source, offset, root) {
  const line = source.text.slice(0, offset).split(/\r?\n/).length;
  return `${path.relative(root, source.file).replaceAll("\\", "/")}:${line}`;
}

function collectLiteralCalls(source, root, kind) {
  const method = kind === "rpc" ? "rpc" : "functions\\s*\\.\\s*invoke";
  const regex = new RegExp(`\\.\\s*${method}\\s*(?:<[^;()]*?>\\s*)?\\(\\s*([\\'\\\"\\x60])([^\\'\\\"\\x60]+)\\1`, "g");
  const calls = [];
  for (const match of source.text.matchAll(regex)) {
    if (match[2].includes("${")) continue;
    calls.push({ name: match[2], location: location(source, match.index, root) });
  }
  return calls;
}

function collectDynamicCalls(source, root, kind) {
  const method = kind === "rpc" ? "rpc" : "functions\\s*\\.\\s*invoke";
  const regex = new RegExp(`\\.\\s*${method}\\s*(?:<[^;()]*?>\\s*)?\\(\\s*([^\\s\\'\\\"\\x60][^,\\n)]*)`, "g");
  return [...source.text.matchAll(regex)].map((match) => ({
    expression: match[1].trim(),
    location: location(source, match.index, root),
  }));
}

export async function inspectRepository(root = DEFAULT_ROOT) {
  const sourceDirectory = path.join(root, "src");
  const migrationDirectory = path.join(root, "supabase", "migrations");
  const functionsDirectory = path.join(root, "supabase", "functions");

  const sourceFiles = await walk(sourceDirectory, (file) => SOURCE_EXTENSIONS.has(path.extname(file)));
  const sources = await Promise.all(sourceFiles.map(async (file) => ({ file, text: await readFile(file, "utf8") })));
  const migrationFiles = (await walk(migrationDirectory, (file) => file.endsWith(".sql"))).sort();

  const rpcDefinitions = new Set();
  for (const file of migrationFiles) {
    const sql = stripSqlComments(await readFile(file, "utf8"));
    const createPattern = /\bcreate\s+(?:or\s+replace\s+)?function\s+(?:(?:"?public"?)\s*\.\s*)?"?([a-zA-Z_][\w$]*)"?\s*\(/gi;
    for (const match of sql.matchAll(createPattern)) rpcDefinitions.add(match[1].toLowerCase());
  }

  const rpcCalls = sources.flatMap((source) => collectLiteralCalls(source, root, "rpc"));
  const edgeCalls = sources.flatMap((source) => collectLiteralCalls(source, root, "edge"));
  const dynamicCalls = [
    ...sources.flatMap((source) => collectDynamicCalls(source, root, "rpc")).map((call) => ({ kind: "RPC", ...call })),
    ...sources.flatMap((source) => collectDynamicCalls(source, root, "edge")).map((call) => ({ kind: "Edge Function", ...call })),
  ];

  const missingRpcs = rpcCalls.filter((call) => !rpcDefinitions.has(call.name.toLowerCase()));
  const missingEdgeFunctions = edgeCalls.filter(
    (call) => !existsSync(path.join(functionsDirectory, call.name, "index.ts")),
  );

  return {
    root,
    sourceFileCount: sourceFiles.length,
    migrationFileCount: migrationFiles.length,
    rpcCalls,
    edgeCalls,
    rpcDefinitions,
    missingRpcs,
    missingEdgeFunctions,
    dynamicCalls,
  };
}

function uniqueNames(calls) {
  return new Set(calls.map((call) => call.name)).size;
}

function printFindings(title, findings) {
  if (findings.length === 0) return;
  console.error(`\n${title}:`);
  for (const finding of findings) console.error(`- ${finding.name} (${finding.location})`);
}

async function main() {
  const requestedRoot = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_ROOT;
  const result = await inspectRepository(requestedRoot);

  console.log("Repository contract preflight");
  console.log(`- Source files scanned: ${result.sourceFileCount}`);
  console.log(`- Migration files scanned: ${result.migrationFileCount}`);
  console.log(`- Literal RPC contracts: ${uniqueNames(result.rpcCalls)}`);
  console.log(`- Literal Edge Function contracts: ${uniqueNames(result.edgeCalls)}`);
  console.log(`- Dynamic call sites requiring manual review: ${result.dynamicCalls.length}`);

  if (result.dynamicCalls.length > 0) {
    console.log("\nManual-review call sites:");
    for (const call of result.dynamicCalls) {
      console.log(`- ${call.kind}: ${call.expression} (${call.location})`);
    }
  }

  printFindings("RPCs missing from repository migrations", result.missingRpcs);
  printFindings("Edge Functions missing from repository source", result.missingEdgeFunctions);

  if (result.missingRpcs.length || result.missingEdgeFunctions.length) process.exitCode = 1;
  else console.log("\nPASS: every literal frontend contract has repository source.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
