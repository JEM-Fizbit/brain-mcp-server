#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import {
  compileSourceReference,
  persistSourceReference,
} from "../dist/source-references/index.js";
import { loadLocalEnv } from "./lib/load-local-env.mjs";

loadLocalEnv();
const argv = process.argv.slice(2);

function flagValue(name) {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
}

function projectRefFromDatabaseUrl(databaseUrl) {
  const url = new URL(databaseUrl);
  const suffix = decodeURIComponent(url.username).split(".").at(-1);
  if (suffix && suffix !== "postgres" && /^[a-z0-9]{12,32}$/.test(suffix)) return suffix;
  return url.hostname.match(/^db\.([a-z0-9]{12,32})\.supabase\.co$/)?.[1] || null;
}

const manifestPath = flagValue("--manifest");
const brainRoot = path.resolve(
  flagValue("--brain-root") || process.env.BRAIN_REPO_ROOT || process.cwd()
);
const expectedProjectRef = flagValue("--expected-project-ref");
const apply = argv.includes("--apply");

if (!manifestPath) {
  console.error(
    "Usage: npm run sources:persist-reference:postgres -- --manifest <manifest.json> --brain-root <path> [--expected-project-ref <ref>] [--apply]"
  );
  process.exit(2);
}

let pool;
try {
  const input = JSON.parse(await fs.readFile(path.resolve(manifestPath), "utf-8"));
  const compiled = compileSourceReference(input);
  if (compiled.manifest.brainId !== "ai-brain-jem") {
    throw new Error("Source-reference persistence pilot is JEM-only; refusing a different Brain id");
  }
  const companionPath = path.resolve(brainRoot, compiled.manifest.companionPath);
  const companion = await fs.readFile(companionPath, "utf-8");
  if (companion !== compiled.markdown) {
    throw new Error("Compiled companion does not match the manifest; compile and review it first");
  }
  if (!apply) {
    console.log(`DRY RUN ${compiled.manifest.sourceId} (database unchanged)`);
    console.log(`  brain: ${compiled.manifest.brainId}`);
    console.log(`  companion hash: ${compiled.receipt.contentSha256}`);
    console.log(`  artifacts: ${compiled.manifest.artifacts.length}`);
    console.log(`  Brain links: ${compiled.manifest.brainLinks.length}`);
    console.log("  re-run with --apply and --expected-project-ref to persist transactionally");
    process.exit(0);
  }
  const databaseUrl =
    process.env.BRAIN_SOURCE_REFERENCE_DATABASE_URL || process.env.BRAIN_REVISION_DATABASE_URL;
  if (!databaseUrl) throw new Error("A source-reference Postgres database URL is required");
  if (!expectedProjectRef) {
    throw new Error("--expected-project-ref is required in apply mode to prevent cross-deployment writes");
  }
  const actualProjectRef = projectRefFromDatabaseUrl(databaseUrl);
  if (!actualProjectRef || actualProjectRef !== expectedProjectRef) {
    throw new Error("Database URL does not match --expected-project-ref");
  }
  pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  try {
    await client.query("begin");
    const receipt = await persistSourceReference(client, compiled.manifest);
    await client.query("commit");
    console.log(`APPLIED ${receipt.sourceId} to ${receipt.brainId}`);
    console.log(`  artifacts: ${receipt.artifactIds.length}`);
    console.log(`  Brain links: ${receipt.brainFiles.length}`);
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
} catch (error) {
  console.error(`source-reference persistence failed: ${String(error?.message || error)}`);
  process.exitCode = 1;
} finally {
  await pool?.end().catch(() => undefined);
}
