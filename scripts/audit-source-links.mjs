#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { auditSourceLinks } from "../dist/source-references/index.js";

const argv = process.argv.slice(2);

function flagValue(name) {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
}

async function markdownFiles(root) {
  const files = new Map();
  async function walk(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch((error) => {
      if (error?.code === "ENOENT") return [];
      throw error;
    });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith(".")) continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(fullPath);
      if (entry.isFile() && entry.name.endsWith(".md")) {
        const name = path.relative(root, fullPath).split(path.sep).join("/");
        files.set(name, await fs.readFile(fullPath, "utf-8"));
      }
    }
  }
  await walk(root);
  return files;
}

function printList(label, items, render = (item) => item) {
  console.log(`${label}: ${items.length}`);
  for (const item of items.slice(0, 20)) console.log(`  - ${render(item)}`);
  if (items.length > 20) console.log(`  - ...and ${items.length - 20} more`);
}

const brainRoot = path.resolve(
  flagValue("--brain-root") || process.env.BRAIN_REPO_ROOT || process.cwd()
);
const json = argv.includes("--json");
const strict = argv.includes("--strict");

try {
  const [brainFiles, sourceFiles] = await Promise.all([
    markdownFiles(path.join(brainRoot, "brain")),
    markdownFiles(path.join(brainRoot, "sources")),
  ]);
  const report = auditSourceLinks({ brainFiles, sourceFiles });
  if (json) {
    console.log(JSON.stringify({ brainRoot, ...report }, null, 2));
  } else {
    console.log(`Source-link audit — ${brainRoot}`);
    console.log(`Brain Markdown files: ${report.brainMarkdownFiles}`);
    console.log(`Source companions: ${report.sourceCompanions}`);
    printList("Directly linked companions", report.directlyLinkedCompanions);
    printList("Index-only companions", report.indexOnlyCompanions);
    printList("Unlinked companions", report.unlinkedCompanions);
    printList("Companions without backlinks", report.companionsWithoutBacklinks);
    printList(
      "Broken links",
      report.brokenLinks,
      (item) => `${item.source} → ${item.target}${item.suggestion ? ` (suggest: ${item.suggestion})` : ""}`
    );
    printList(
      "Non-clickable source references",
      report.nonClickableSourceReferences,
      (item) => `${item.source} → ${item.target}${item.suggestion ? ` (suggest: ${item.suggestion})` : ""}`
    );
  }
  if (
    strict &&
    (report.brokenLinks.length > 0 || report.nonClickableSourceReferences.length > 0)
  ) {
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`source-link audit failed: ${String(error?.message || error)}`);
  process.exitCode = 1;
}
