import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { evaluateSyncHeartbeat } from "../scripts/lib/sync-heartbeat.mjs";
import { LocalSyncAgent } from "../dist/sync/local-sync-agent.js";
import { MemoryRevisionStore } from "../dist/sync/memory-revision-store.js";
import { PostgresRevisionStore } from "../dist/sync/postgres-revision-store.js";

test("each sync cycle emits one metadata-only heartbeat", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "brain-heartbeat-"));
  const brainDir = path.join(root, "brain");
  await fs.mkdir(brainDir, { recursive: true });
  await fs.writeFile(path.join(brainDir, "00_loader.md"), "# loader\n", "utf8");
  await fs.writeFile(path.join(brainDir, "NOW.md"), "# now\n", "utf8");

  const store = new MemoryRevisionStore();
  const heartbeats = [];
  store.recordSyncHeartbeat = async (input) => heartbeats.push(input);
  const agent = new LocalSyncAgent({
    brainId: "example-brain",
    brainDir,
    stateFile: path.join(root, "state.json"),
    store,
  });

  const report = await agent.syncOnce();
  assert.equal(heartbeats.length, 1);
  assert.equal(heartbeats[0].brainId, "example-brain");
  assert.equal(heartbeats[0].report, report);
});

test("Postgres heartbeat upserts bounded state and coalesces rapid cycles", async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [] };
    },
  };
  const store = new PostgresRevisionStore(pool, { heartbeatIntervalMs: 60_000 });
  const heartbeat = {
    brainId: "example-brain",
    report: {
      pushed: ["secret.md"],
      pulled: [],
      unchanged: ["NOW.md"],
      conflicts: [],
      timings: [{ operation: "sync", phase: "total", ms: 12.5 }],
      deleted: [],
      deletionsSkipped: [],
    },
    completedAt: "2026-07-16T12:00:00.000Z",
  };
  await store.recordSyncHeartbeat(heartbeat);
  await store.recordSyncHeartbeat(heartbeat);

  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /insert into brain\.sync_heartbeats/);
  assert.match(calls[0].sql, /on conflict \(brain_id\) do update/);
  const heartbeatMetadata = JSON.parse(calls[0].params[2]);
  assert.equal(heartbeatMetadata.counts.pushed, 1);
  const serialized = JSON.stringify(heartbeatMetadata);
  assert.doesNotMatch(serialized, /secret\.md|NOW\.md|content/);
});

test("Postgres heartbeat falls back safely before the state-table migration", async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (calls.length === 1) {
        const error = new Error('relation "brain.sync_heartbeats" does not exist');
        error.code = "42P01";
        throw error;
      }
      return { rows: [] };
    },
  };
  const store = new PostgresRevisionStore(pool);
  await store.recordSyncHeartbeat({
    brainId: "example-brain",
    report: {
      pushed: [],
      pulled: [],
      unchanged: [],
      conflicts: [],
      timings: [],
      deleted: [],
      deletionsSkipped: [],
    },
  });

  assert.equal(calls.length, 2);
  assert.match(calls[1].sql, /insert into brain\.sync_events/);
  assert.equal(calls[1].params[1], "sync_heartbeat");
});

test("heartbeat evaluation warns when missing or stale", () => {
  const now = Date.parse("2026-07-16T12:10:00.000Z");
  assert.equal(evaluateSyncHeartbeat(null, now, 300_000).status, "warn");
  assert.equal(
    evaluateSyncHeartbeat({ created_at: "2026-07-16T12:00:00.000Z" }, now, 300_000).status,
    "warn"
  );
  assert.equal(
    evaluateSyncHeartbeat({ created_at: "2026-07-16T12:09:00.000Z" }, now, 300_000).status,
    "pass"
  );
});
