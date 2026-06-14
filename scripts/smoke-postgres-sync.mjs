import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { LocalSyncAgent, PostgresRevisionStore } from "../dist/sync/index.js";
import { loadLocalEnv } from "./lib/load-local-env.mjs";

loadLocalEnv();

const databaseUrl = process.env.BRAIN_REVISION_DATABASE_URL;

if (!databaseUrl) {
  console.error(
    "BRAIN_REVISION_DATABASE_URL is missing. Set it in your shell before running this smoke test."
  );
  process.exit(2);
}

process.env.BRAIN_REVISION_STORE = "postgres";

const brainId = `smoke-brain-${Date.now()}-${process.pid}`;
const filename = "HOSTED_SYNC_SMOKE.md";
const content = [
  "# Hosted Sync Smoke",
  "",
  `Brain: ${brainId}`,
  "Created for Postgres sync verification.",
  "",
].join("\n");
const root = await fs.mkdtemp(path.join(os.tmpdir(), "brain-postgres-smoke-"));
const pushBrainDir = path.join(root, "push", "brain");
const pullBrainDir = path.join(root, "pull", "brain");
const pushStateFile = path.join(root, "push", ".brain-sync", "state.json");
const pullStateFile = path.join(root, "pull", ".brain-sync", "state.json");

const pool = new pg.Pool({ connectionString: databaseUrl });
const store = new PostgresRevisionStore(pool);

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
        jsonb_build_object('environment', 'smoke_test')
      )
      on conflict (id) do nothing
    `,
    [brainId]
  );
}

async function cleanupBrain() {
  await pool.query("delete from brain.brains where id = $1", [brainId]).catch(() => undefined);
  await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
}

function agent(brainDir, stateFile) {
  return new LocalSyncAgent({
    brainId,
    brainDir,
    stateFile,
    store,
    actor: {
      provider: "postgres_smoke_test",
      id: process.env.USER || "local",
      name: process.env.USER || "local",
    },
  });
}

try {
  console.log(`[smoke] Creating temporary Brain ${brainId}`);
  await bootstrapBrain();

  await fs.mkdir(pushBrainDir, { recursive: true });
  await fs.writeFile(path.join(pushBrainDir, filename), content, "utf-8");

  console.log(`[smoke] Pushing ${filename} to Supabase Postgres`);
  const pushReport = await agent(pushBrainDir, pushStateFile).pushLocalChanges();
  assert.deepEqual(pushReport.conflicts, []);
  assert.ok(pushReport.pushed.includes(filename), "smoke file should be pushed");

  const hosted = await store.listFiles(brainId);
  assert.ok(
    hosted.some((head) => head.filename === filename),
    "smoke file should appear in hosted heads"
  );

  console.log("[smoke] Pulling hosted revision into a fresh local mirror");
  await fs.mkdir(pullBrainDir, { recursive: true });
  const pullReport = await agent(pullBrainDir, pullStateFile).pullHostedChanges();
  assert.deepEqual(pullReport.conflicts, []);
  assert.ok(pullReport.pulled.includes(filename), "smoke file should be pulled");

  const pulled = await fs.readFile(path.join(pullBrainDir, filename), "utf-8");
  assert.equal(pulled, content);

  console.log("[smoke] PASS: Postgres revision sync push/status/pull round trip verified");
} finally {
  await cleanupBrain();
  await store.close();
}
