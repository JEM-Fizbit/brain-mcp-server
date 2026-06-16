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
const staleFilename = "HOSTED_SYNC_STALE_LOCAL_SMOKE.md";
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
const staleBrainDir = path.join(root, "stale", "brain");
const pushStateFile = path.join(root, "push", ".brain-sync", "state.json");
const pullStateFile = path.join(root, "pull", ".brain-sync", "state.json");
const staleStateFile = path.join(root, "stale", ".brain-sync", "state.json");

const pool = new pg.Pool({ connectionString: databaseUrl });
const store = new PostgresRevisionStore(pool);

async function accept(result) {
  assert.equal(result.ok, true);
  return result.head;
}

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

  console.log("[smoke] Verifying hosted update does not overwrite dirty local Markdown");
  const base = await store.readFile(brainId, filename);
  const dirtyLocal = `${content}\nLocal dirty edit before hosted update.\n`;
  await fs.writeFile(path.join(pullBrainDir, filename), dirtyLocal, "utf-8");
  await accept(
    await store.proposeRevision({
      brainId,
      filename,
      baseRevisionId: base.revisionId,
      content: `${content}\nHosted update while local is dirty.\n`,
      origin: "hosted_mcp",
      actor: { provider: "postgres_smoke_test", id: "hosted" },
    })
  );
  const dirtyPullReport = await agent(pullBrainDir, pullStateFile).pullHostedChanges();
  assert.equal(dirtyPullReport.pulled.length, 0);
  assert.equal(dirtyPullReport.conflicts.length, 1);
  assert.equal(dirtyPullReport.conflicts[0].filename, filename);
  assert.equal(await fs.readFile(path.join(pullBrainDir, filename), "utf-8"), dirtyLocal);

  console.log("[smoke] Verifying stale local edit does not overwrite hosted head");
  const staleBaseContent = [
    "# Hosted Sync Stale Local Smoke",
    "",
    `Brain: ${brainId}`,
    "",
  ].join("\n");
  const staleBase = await accept(
    await store.proposeRevision({
      brainId,
      filename: staleFilename,
      baseRevisionId: null,
      content: staleBaseContent,
      origin: "hosted_mcp",
      actor: { provider: "postgres_smoke_test", id: "hosted" },
    })
  );
  await fs.mkdir(staleBrainDir, { recursive: true });
  const staleAgent = agent(staleBrainDir, staleStateFile);
  const stalePullReport = await staleAgent.pullHostedChanges();
  assert.ok(
    stalePullReport.pulled.includes(staleFilename),
    "stale smoke base should be pulled"
  );
  const hostedUpdate = `${staleBaseContent}\nHosted update wins.\n`;
  await accept(
    await store.proposeRevision({
      brainId,
      filename: staleFilename,
      baseRevisionId: staleBase.revisionId,
      content: hostedUpdate,
      origin: "hosted_mcp",
      actor: { provider: "postgres_smoke_test", id: "hosted" },
    })
  );
  const staleLocalEdit = `${staleBaseContent}\nLocal stale edit.\n`;
  await fs.writeFile(path.join(staleBrainDir, staleFilename), staleLocalEdit, "utf-8");
  const stalePushReport = await staleAgent.pushLocalChanges();
  assert.equal(stalePushReport.pushed.length, 0);
  assert.equal(stalePushReport.conflicts.length, 1);
  assert.equal(stalePushReport.conflicts[0].filename, staleFilename);
  assert.equal((await store.readFile(brainId, staleFilename)).content, hostedUpdate);
  assert.equal(
    await fs.readFile(path.join(staleBrainDir, staleFilename), "utf-8"),
    staleLocalEdit
  );

  const conflicts = await store.listConflicts(brainId, "open");
  assert.equal(conflicts.length, 2);

  console.log(
    "[smoke] PASS: Postgres revision sync push/pull and conflict-blocking verified"
  );
} finally {
  await cleanupBrain();
  await store.close();
}
