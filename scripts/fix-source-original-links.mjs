#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { auditSourceLinks } from "../dist/source-references/index.js";
import { addOriginalArtifactSection } from "./lib/source-companion-refresh.mjs";

const argv = process.argv.slice(2);
const apply = argv.includes("--apply");

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
        files.set(path.relative(root, fullPath).split(path.sep).join("/"), await fs.readFile(fullPath, "utf8"));
      }
    }
  }
  await walk(root);
  return files;
}

async function allFiles(root) {
  const files = new Set();
  async function walk(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch((error) => {
      if (error?.code === "ENOENT") return [];
      throw error;
    });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith(".")) continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(fullPath);
      if (entry.isFile()) files.add(path.relative(root, fullPath).split(path.sep).join("/"));
    }
  }
  await walk(root);
  return files;
}

const brainRoot = path.resolve(flagValue("--brain-root") || process.env.BRAIN_REPO_ROOT || process.cwd());

try {
  const [brainFiles, sourceFiles, sourceArtifactFiles] = await Promise.all([
    markdownFiles(path.join(brainRoot, "brain")),
    markdownFiles(path.join(brainRoot, "sources")),
    allFiles(path.join(brainRoot, "sources")),
  ]);
  const audit = auditSourceLinks({ brainFiles, sourceFiles, sourceArtifactFiles });
  const byCompanion = new Map();
  for (const issue of audit.companionsWithoutOriginalLinks) {
    const companionPath = issue.source.replace(/^sources\//, "");
    const links = byCompanion.get(companionPath) || [];
    links.push(issue.suggestion);
    byCompanion.set(companionPath, links);
  }
  console.log(`${apply ? "APPLY" : "DRY RUN"}: ${byCompanion.size} companion file(s) need original-artifact links`);
  for (const [companionPath, links] of byCompanion) {
    console.log(`  ${companionPath}: ${links.join(", ")}`);
    if (!apply) continue;
    const absolutePath = path.join(brainRoot, "sources", companionPath);
    const current = sourceFiles.get(companionPath);
    const next = addOriginalArtifactSection(current, links);
    if (next !== current) await fs.writeFile(absolutePath, next, "utf8");
  }
  if (!apply && byCompanion.size > 0) {
    console.log("Files unchanged. Re-run with --apply after reviewing the same-stem pairings.");
  }
} catch (error) {
  console.error(`original-link fix failed: ${String(error?.message || error)}`);
  process.exitCode = 1;
}
