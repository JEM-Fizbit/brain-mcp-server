#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compileSourceReference } from "../dist/source-references/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..");
const argv = process.argv.slice(2);

function flagValue(name) {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
}

function usage() {
  console.error(
    "Usage: npm run sources:compile-reference -- --manifest <manifest.json> --brain-root <path> [--apply] [--print]"
  );
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function atomicWriteWithin(root, relativePath, content) {
  const canonicalRoot = await fs.realpath(root);
  const target = path.resolve(canonicalRoot, relativePath);
  if (!isWithin(canonicalRoot, target)) {
    throw new Error(`Refusing to write outside Brain root: ${relativePath}`);
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  const canonicalParent = await fs.realpath(path.dirname(target));
  if (!isWithin(canonicalRoot, canonicalParent)) {
    throw new Error(`Refusing to follow a directory outside Brain root: ${relativePath}`);
  }
  const safeTarget = path.join(canonicalParent, path.basename(target));
  const temp = path.join(canonicalParent, `.${path.basename(target)}.${process.pid}.next`);
  try {
    await fs.writeFile(temp, content, { encoding: "utf-8", flag: "wx" });
    await fs.rename(temp, safeTarget);
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
  return safeTarget;
}

const manifestPath = flagValue("--manifest");
const brainRoot = path.resolve(
  flagValue("--brain-root") || process.env.BRAIN_REPO_ROOT || repoRoot
);
const apply = argv.includes("--apply");
const printMarkdown = argv.includes("--print");

if (!manifestPath) {
  usage();
  process.exit(2);
}

try {
  const input = JSON.parse(await fs.readFile(path.resolve(manifestPath), "utf-8"));
  const compiled = compileSourceReference(input);
  const receiptPath = path.posix.join(
    ".brain-sync",
    "source-references",
    `${compiled.manifest.sourceId}.json`
  );

  if (apply) {
    const outputPath = await atomicWriteWithin(
      brainRoot,
      compiled.manifest.companionPath,
      compiled.markdown
    );
    await atomicWriteWithin(
      brainRoot,
      receiptPath,
      `${JSON.stringify(compiled.receipt, null, 2)}\n`
    );
    console.log(`APPLIED ${compiled.manifest.sourceId}`);
    console.log(`  companion: ${outputPath}`);
    console.log(`  receipt: ${path.join(brainRoot, receiptPath)}`);
  } else {
    console.log(`DRY RUN ${compiled.manifest.sourceId} (nothing written)`);
    console.log(`  companion: ${path.join(brainRoot, compiled.manifest.companionPath)}`);
    console.log(`  sha256: ${compiled.receipt.contentSha256}`);
    console.log(`  artifacts: ${compiled.receipt.artifactIds.length}`);
    console.log(`  Brain links: ${compiled.receipt.brainFiles.length}`);
    console.log("  re-run with --apply to write the companion and receipt");
  }
  if (printMarkdown) process.stdout.write(`\n${compiled.markdown}`);
} catch (error) {
  console.error(`source-reference compile failed: ${String(error?.message || error)}`);
  process.exitCode = 1;
}
