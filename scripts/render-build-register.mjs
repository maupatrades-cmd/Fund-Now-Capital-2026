#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(root, "docs", "build-register.json");
const outputPath = path.join(root, "docs", "FNC-CANONICAL-OUTSTANDING-BUILD-REGISTER.md");

export function renderRegister(register) {
  const counts = Object.fromEntries(Object.keys(register.status_definitions).map((status) => [status, 0]));
  for (const item of register.items) counts[item.status] += 1;
  const lines = [
    "# FNC canonical outstanding-build register", "",
    `**Repository baseline:** \`${register.baseline.repository_commit}\` · **audited:** ${register.baseline.audited_on} · **production evidence cutoff:** ${register.baseline.production_evidence_cutoff}`, "",
    `> ${register.baseline.production_warning}`, "",
    "This register answers what remains without treating a committed file, merged PR or old planning checkbox as proof of a working production feature. Machine-readable source: `docs/build-register.json`.", "",
    "## Status summary", "", "| Status | Count | Meaning |", "|---|---:|---|",
    ...Object.entries(register.status_definitions).map(([status, meaning]) => `| ${status} | ${counts[status]} | ${meaning} |`),
    "", "## Coverage map", "", "| ID | Area | Status | PR | Outcome | What remains |", "|---|---|---|---:|---|---|",
    ...register.items.map((item) => `| ${item.id} | ${item.area} | ${item.status} | ${item.pr ? `#${item.pr}` : "—"} | ${item.outcome} | ${item.remaining} |`),
    "", "## Recommended build and verification order", "",
    ...register.recommended_order.map((id, index) => {
      const item = register.items.find((candidate) => candidate.id === id);
      return `${index + 1}. **${id}** — ${item.remaining}`;
    }),
    "", "## Evidence index", "",
    ...register.items.flatMap((item) => [
      `### ${item.id}`, "",
      `- Dependencies: ${item.depends_on.length ? item.depends_on.join(", ") : "none"}`,
      `- Repository evidence: ${item.repo_evidence.map((entry) => `\`${entry}\``).join(", ") || "none on main (PR evidence only)"}`, "",
    ]),
    "## Update rule", "",
    "Edit `docs/build-register.json`, run `npm run build-register`, and commit both files. Never promote an item to production-complete using repository evidence alone: record current live object/deployment checks and the exact role smoke result first.", "",
  ];
  return `${lines.join("\n")}\n`;
}

export async function loadRegister() {
  return JSON.parse(await readFile(sourcePath, "utf8"));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const register = await loadRegister();
  const rendered = renderRegister(register);
  if (process.argv.includes("--check")) {
    const current = await readFile(outputPath, "utf8").catch(() => "");
    if (current !== rendered) {
      console.error("FNC outstanding-build register is stale. Run: npm run build-register");
      process.exitCode = 1;
    } else console.log("PASS: generated build register matches its JSON source.");
  } else {
    await writeFile(outputPath, rendered);
    console.log(`Wrote ${path.relative(root, outputPath)}`);
  }
}
