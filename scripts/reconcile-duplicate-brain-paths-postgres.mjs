#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const { Pool } = pg;
const BRAIN_LOADER_FILENAME = "00_loader.md";
const NESTED_BRAIN_DIRNAME = "brain";

function loadLocalEnv() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;

  for (const line of fs.readFileSync(envPath, "utf-8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const assignment = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
    const equalsIndex = assignment.indexOf("=");
    if (equalsIndex === -1) continue;
    const key = assignment.slice(0, equalsIndex).trim();
    let value = assignment.slice(equalsIndex + 1).trim();
    if (!key || process.env[key]) continue;
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));
    if (quoted) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function usage() {
  return `
Usage:
  node scripts/reconcile-duplicate-brain-paths-postgres.mjs --brain-id <id> [--brain-id <id>] [--prefix brain/] [--apply]
  node scripts/reconcile-duplicate-brain-paths-postgres.mjs --brain-id <id> --local-brain-dir <path> --prune-missing-local [--apply]

Dry-run by default. With --apply, this script:
  - marks open sync conflicts whose filename starts with the prefix as superseded;
  - deletes matching rows from brain.sync_file_states;
  - deletes matching hosted heads from brain.brain_files;
  - with --prune-missing-local, does the same for hosted heads absent from the local Brain root;
  - keeps brain.brain_file_revisions intact as history.
`.trim();
}

function parseArgs(argv) {
  const brainIds = [];
  let prefix = "brain/";
  let apply = false;
  let help = false;
  let localBrainDir = null;
  let pruneMissingLocal = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--brain-id") {
      const value = argv[index + 1];
      if (!value) throw new Error("--brain-id requires a value");
      brainIds.push(value);
      index += 1;
    } else if (arg === "--prefix") {
      const value = argv[index + 1];
      if (!value) throw new Error("--prefix requires a value");
      prefix = value;
      index += 1;
    } else if (arg === "--apply") {
      apply = true;
    } else if (arg === "--local-brain-dir") {
      const value = argv[index + 1];
      if (!value) throw new Error("--local-brain-dir requires a value");
      localBrainDir = value;
      index += 1;
    } else if (arg === "--prune-missing-local") {
      pruneMissingLocal = true;
    } else if (arg === "--help" || arg === "-h") {
      help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (process.env.BRAIN_ID && brainIds.length === 0) {
    brainIds.push(process.env.BRAIN_ID);
  }

  if (!prefix || prefix.startsWith("/") || prefix.includes("..")) {
    throw new Error(`Unsafe duplicate prefix: ${prefix}`);
  }
  if (!prefix.endsWith("/")) {
    throw new Error(`Duplicate prefix must end with "/": ${prefix}`);
  }
  if (pruneMissingLocal && !localBrainDir) {
    throw new Error("--prune-missing-local requires --local-brain-dir");
  }
  if (localBrainDir && !path.isAbsolute(localBrainDir)) {
    throw new Error(`--local-brain-dir must be absolute: ${localBrainDir}`);
  }
  if (pruneMissingLocal && brainIds.length !== 1) {
    throw new Error("--prune-missing-local supports exactly one --brain-id per run");
  }

  return {
    apply,
    brainIds: Array.from(new Set(brainIds)),
    help,
    localBrainDir,
    prefix,
    pruneMissingLocal,
  };
}

async function queryOne(client, text, values) {
  const result = await client.query(text, values);
  return result.rows[0] || {};
}

async function summarize(client, brainId, likePrefix) {
  const heads = await queryOne(
    client,
    `
      select
        count(*)::int as total,
        count(*) filter (where filename like $2)::int as duplicate_prefix,
        count(*) filter (where filename not like $2)::int as non_duplicate
      from brain.brain_files
      where brain_id = $1
    `,
    [brainId, likePrefix]
  );
  const openConflicts = await queryOne(
    client,
    `
      select
        count(*)::int as total,
        count(*) filter (where filename like $2)::int as duplicate_prefix,
        count(distinct filename)::int as distinct_files
      from brain.sync_conflicts
      where brain_id = $1 and status = 'open'
    `,
    [brainId, likePrefix]
  );
  const duplicateConflictStatus = await client.query(
    `
      select status, count(*)::int as count
      from brain.sync_conflicts
      where brain_id = $1 and filename like $2
      group by status
      order by status
    `,
    [brainId, likePrefix]
  );
  const syncFileStates = await queryOne(
    client,
    `
      select
        count(*)::int as total,
        count(*) filter (where filename like $2)::int as duplicate_prefix
      from brain.sync_file_states
      where brain_id = $1
    `,
    [brainId, likePrefix]
  );
  const sampleDuplicateHeads = await client.query(
    `
      select filename
      from brain.brain_files
      where brain_id = $1 and filename like $2
      order by filename
      limit 25
    `,
    [brainId, likePrefix]
  );
  const topOpenConflicts = await client.query(
    `
      select filename, count(*)::int as count
      from brain.sync_conflicts
      where brain_id = $1 and status = 'open'
      group by filename
      order by count(*) desc, filename
      limit 25
    `,
    [brainId]
  );

  return {
    heads,
    openConflicts,
    duplicateConflictStatus: duplicateConflictStatus.rows,
    syncFileStates,
    sampleDuplicateHeads: sampleDuplicateHeads.rows.map((row) => row.filename),
    topOpenConflicts: topOpenConflicts.rows,
  };
}

async function isFile(filePath) {
  try {
    return (await fs.promises.stat(filePath)).isFile();
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return false;
    throw error;
  }
}

async function scanLocalMarkdownFiles(root) {
  const rootLoaderPath = path.join(root, BRAIN_LOADER_FILENAME);
  const nestedBrainDir = path.join(root, NESTED_BRAIN_DIRNAME);
  const nestedLoaderPath = path.join(nestedBrainDir, BRAIN_LOADER_FILENAME);
  const rootHasLoader = await isFile(rootLoaderPath);
  const nestedHasLoader = await isFile(nestedLoaderPath);
  if (!rootHasLoader && nestedHasLoader) {
    throw new Error(
      `Local Brain dir appears to point at a parent container, not the Brain root. ` +
        `Use ${nestedBrainDir}.`
    );
  }

  const skipNestedBrainDir = rootHasLoader && nestedHasLoader ? nestedBrainDir : null;
  const files = [];

  async function walk(dir) {
    const entries = await fs.promises
      .readdir(dir, { withFileTypes: true })
      .catch(() => []);
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (fullPath === skipNestedBrainDir) continue;
        await walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        files.push(path.relative(root, fullPath).split(path.sep).join("/"));
      }
    }
  }

  await walk(root);
  return files.sort();
}

async function summarizeMissingLocal(client, brainId, localBrainDir) {
  if (!localBrainDir) return null;
  const localFiles = await scanLocalMarkdownFiles(localBrainDir);
  const localFileSet = new Set(localFiles);
  const heads = await client.query(
    `
      select filename
      from brain.brain_files
      where brain_id = $1
      order by filename
    `,
    [brainId]
  );
  const hostedFilenames = heads.rows.map((row) => row.filename);
  const hostedFileSet = new Set(hostedFilenames);
  const missingHostedHeads = hostedFilenames
    .filter((filename) => !localFileSet.has(filename));
  const localOnlyFiles = localFiles.filter(
    (filename) => !hostedFileSet.has(filename)
  );

  return {
    localBrainDir,
    localFileCount: localFiles.length,
    hostedHeadCount: heads.rows.length,
    missingHostedHeadsCount: missingHostedHeads.length,
    missingHostedHeadsSample: missingHostedHeads.slice(0, 25),
    localOnlyFileCount: localOnlyFiles.length,
    localOnlyFileSample: localOnlyFiles.slice(0, 25),
    missingHostedHeads,
  };
}

async function applyReconciliation(pool, brainId, likePrefix) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const conflicts = await client.query(
      `
        update brain.sync_conflicts
        set
          status = 'superseded',
          resolved_at = now(),
          metadata = metadata || jsonb_build_object(
            'repair', 'duplicate_brain_path_reconciliation',
            'duplicatePrefix', $2
          )
        where brain_id = $1 and status = 'open' and filename like $2
        returning id
      `,
      [brainId, likePrefix]
    );
    const states = await client.query(
      `
        delete from brain.sync_file_states
        where brain_id = $1 and filename like $2
        returning filename
      `,
      [brainId, likePrefix]
    );
    const heads = await client.query(
      `
        delete from brain.brain_files
        where brain_id = $1 and filename like $2
        returning filename
      `,
      [brainId, likePrefix]
    );
    await client.query("commit");
    return {
      supersededOpenConflicts: conflicts.rowCount,
      deletedSyncFileStates: states.rowCount,
      deletedHostedHeads: heads.rowCount,
    };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function applyMissingLocalReconciliation(pool, brainId, filenames) {
  if (filenames.length === 0) {
    return {
      supersededOpenConflicts: 0,
      deletedSyncFileStates: 0,
      deletedHostedHeads: 0,
    };
  }

  const client = await pool.connect();
  try {
    await client.query("begin");
    const conflicts = await client.query(
      `
        update brain.sync_conflicts
        set
          status = 'superseded',
          resolved_at = now(),
          metadata = metadata || jsonb_build_object(
            'repair', 'missing_local_path_reconciliation'
          )
        where brain_id = $1 and status = 'open' and filename = any($2::text[])
        returning id
      `,
      [brainId, filenames]
    );
    const states = await client.query(
      `
        delete from brain.sync_file_states
        where brain_id = $1 and filename = any($2::text[])
        returning filename
      `,
      [brainId, filenames]
    );
    const heads = await client.query(
      `
        delete from brain.brain_files
        where brain_id = $1 and filename = any($2::text[])
        returning filename
      `,
      [brainId, filenames]
    );
    await client.query("commit");
    return {
      supersededOpenConflicts: conflicts.rowCount,
      deletedSyncFileStates: states.rowCount,
      deletedHostedHeads: heads.rowCount,
    };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  loadLocalEnv();
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  if (options.brainIds.length === 0) {
    throw new Error("At least one --brain-id is required.");
  }
  if (!process.env.BRAIN_REVISION_DATABASE_URL) {
    throw new Error(
      "BRAIN_REVISION_DATABASE_URL is required. Export it or set it in .env.local."
    );
  }

  const likePrefix = `${options.prefix}%`;
  const pool = new Pool({
    connectionString: process.env.BRAIN_REVISION_DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: Number(process.env.BRAIN_PG_CONNECTION_TIMEOUT_MS) || 5000,
    idleTimeoutMillis: Number(process.env.BRAIN_PG_IDLE_TIMEOUT_MS) || 1000,
    query_timeout: Number(process.env.BRAIN_PG_QUERY_TIMEOUT_MS) || 30000,
    statement_timeout: Number(process.env.BRAIN_PG_STATEMENT_TIMEOUT_MS) || 30000,
  });

  try {
    const results = [];
    for (const brainId of options.brainIds) {
      const before = await summarize(pool, brainId, likePrefix);
      const missingLocalBefore = await summarizeMissingLocal(
        pool,
        brainId,
        options.localBrainDir
      );
      const applied = options.apply
        ? await applyReconciliation(pool, brainId, likePrefix)
        : null;
      const appliedMissingLocal =
        options.apply && options.pruneMissingLocal
          ? await applyMissingLocalReconciliation(
              pool,
              brainId,
              missingLocalBefore?.missingHostedHeads || []
            )
          : null;
      const after = options.apply ? await summarize(pool, brainId, likePrefix) : null;
      const missingLocalAfter =
        options.apply && options.localBrainDir
          ? await summarizeMissingLocal(pool, brainId, options.localBrainDir)
          : null;
      results.push({
        brainId,
        before,
        missingLocalBefore: missingLocalBefore
          ? { ...missingLocalBefore, missingHostedHeads: undefined }
          : null,
        applied,
        appliedMissingLocal,
        after,
        missingLocalAfter: missingLocalAfter
          ? { ...missingLocalAfter, missingHostedHeads: undefined }
          : null,
      });
    }
    console.log(
      JSON.stringify(
        {
          mode: options.apply ? "apply" : "dry-run",
          duplicatePrefix: options.prefix,
          results,
        },
        null,
        2
      )
    );
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
