#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import {
  auditSemanticDestinations,
  isStrictBrainSemanticContent,
} from "../dist/semantic-destinations/index.js";

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
  const report = auditSemanticDestinations({ brainFiles, sourceFiles });
  const strictBareUrls = report.bareExternalUrls.filter(
    (item) => item.scope === "brain" && isStrictBrainSemanticContent(item.source)
  );
  if (json) {
    console.log(JSON.stringify({ brainRoot, strictBareUrls, ...report }, null, 2));
  } else {
    console.log(`Semantic-destination audit — ${brainRoot}`);
    console.log(`Brain Markdown files: ${report.brainMarkdownFiles}`);
    console.log(`Source companions: ${report.sourceCompanions}`);
    printList(
      "Entity hubs",
      report.entityHubs,
      (item) => `${item.source} (${item.status}; ${item.urls.length} destination URL(s))`
    );
    printList(
      "Missing canonical-destination sections",
      report.missingCanonicalDestinationSections
    );
    printList(
      "Incomplete canonical-destination sections",
      report.incompleteCanonicalDestinationSections
    );
    printList(
      "Bare external URLs in strict Brain content",
      strictBareUrls,
      (item) => `${item.source}:${item.line} → ${item.target}`
    );
    printList(
      "Bare external URLs in source companions (advisory)",
      report.bareExternalUrls.filter((item) => item.scope === "sources"),
      (item) => `${item.source}:${item.line} → ${item.target}`
    );
    printList("Domains present only in source companions (review candidates)", report.sourceOnlyDomains);
  }
  if (
    strict &&
    (report.missingCanonicalDestinationSections.length > 0 ||
      report.incompleteCanonicalDestinationSections.length > 0 ||
      strictBareUrls.length > 0)
  ) {
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`semantic-destination audit failed: ${String(error?.message || error)}`);
  process.exitCode = 1;
}
