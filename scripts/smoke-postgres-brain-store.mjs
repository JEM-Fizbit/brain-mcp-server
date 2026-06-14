import assert from "node:assert/strict";
import pg from "pg";
import { RevisionBrainStore } from "../dist/services/revision-brain-store.js";
import { PostgresRevisionStore } from "../dist/sync/index.js";
import { loadLocalEnv } from "./lib/load-local-env.mjs";

loadLocalEnv();

const databaseUrl = process.env.BRAIN_REVISION_DATABASE_URL;

if (!databaseUrl) {
  console.error(
    "BRAIN_REVISION_DATABASE_URL is missing. Set it in your shell before running this smoke test."
  );
  process.exit(2);
}

const brainId = `smoke-brain-store-${Date.now()}-${process.pid}`;
const pool = new pg.Pool({ connectionString: databaseUrl });
const revisionStore = new PostgresRevisionStore(pool);
const brainStore = new RevisionBrainStore(revisionStore);

async function bootstrapBrain() {
  await pool.query(
    `
      insert into brain.brains (
        id,
        type,
        template_used,
        integration_mode,
        metadata
      )
      values (
        $1,
        'personal',
        'personal',
        'vertical',
        jsonb_build_object('environment', 'brain_store_smoke_test')
      )
      on conflict (id) do nothing
    `,
    [brainId]
  );
}

async function cleanupBrain() {
  await pool.query("delete from brain.brains where id = $1", [brainId]).catch(() => undefined);
}

try {
  console.log(`[brain-store-smoke] Creating temporary Brain ${brainId}`);
  await bootstrapBrain();

  await brainStore.writeFile(
    brainId,
    "NOW.md",
    "# Smoke NOW\n\nPostgres BrainStore write path.\n",
    "replace"
  );
  await brainStore.writeFile(
    brainId,
    "TASKS.md",
    "# Smoke TASKS\n\n- Verify search and list.\n",
    "replace"
  );

  const now = await brainStore.readFile(brainId, "NOW.md");
  assert.match(now, /Postgres BrainStore write path/);

  const files = await brainStore.listFiles(brainId);
  assert.ok(Array.isArray(files));
  assert.deepEqual(
    files.map((file) => file.name).sort(),
    ["NOW.md", "TASKS.md"]
  );

  const search = await brainStore.searchFiles(brainId, "BrainStore", "brain", 5);
  assert.match(search, /NOW\.md/);

  const commit = await brainStore.commit(brainId, "No-op revision store commit");
  assert.match(commit.message, /does not commit to git/);

  console.log("[brain-store-smoke] PASS: BrainStore read/write/list/search path verified");
} finally {
  await cleanupBrain();
  await revisionStore.close();
}
