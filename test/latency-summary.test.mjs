import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appendLatencyHistory,
  buildLatencySnapshot,
  latencyHistoryFromSnapshot,
  summarizeLatencyHistory,
} from "../scripts/lib/latency-summary.mjs";

const previousSnapshot = {
  version: 1,
  operations: [
    {
      name: "brain_read_file",
      kind: "read",
      target: "NOW.md",
      ok: true,
      latencyMs: 400,
      at: "2026-06-18T10:00:00.000Z",
    },
    {
      name: "brain_update_file",
      kind: "write",
      target: "HOSTED_OAUTH_WRITE_SMOKE.md",
      ok: true,
      latencyMs: 1200,
      at: "2026-06-18T10:00:02.000Z",
    },
  ],
};

test("latency history upgrades old snapshots and appends bounded samples", () => {
  const history = appendLatencyHistory(
    previousSnapshot,
    [
      {
        name: "brain_load_context",
        kind: "read",
        target: "ai-brain-jem",
        ok: true,
        latencyMs: 600,
        at: "2026-06-18T10:01:00.000Z",
      },
      {
        name: "local_to_hosted_sync",
        kind: "sync_wait",
        target: "HOSTED_OAUTH_WRITE_SMOKE.md",
        ok: true,
        latencyMs: 6300,
        at: "2026-06-18T10:01:03.000Z",
      },
    ],
    3
  );

  assert.deepEqual(
    history.map((operation) => operation.name),
    ["brain_update_file", "brain_load_context", "local_to_hosted_sync"]
  );
  assert.equal(latencyHistoryFromSnapshot({ history }).length, 3);
});

test("latency summaries report latest, average, percentiles, trend, and failures", () => {
  const history = [
    {
      name: "brain_read_file",
      kind: "read",
      target: "NOW.md",
      ok: true,
      latencyMs: 400,
      at: "2026-06-18T10:00:00.000Z",
    },
    {
      name: "brain_load_context",
      kind: "read",
      target: "ai-brain-jem",
      ok: false,
      latencyMs: 900,
      at: "2026-06-18T10:00:10.000Z",
      error: "timeout",
    },
    {
      name: "brain_list_files",
      kind: "read",
      target: "ai-brain-jem",
      ok: true,
      latencyMs: 800,
      at: "2026-06-18T10:00:20.000Z",
    },
    {
      name: "brain_update_file",
      kind: "write",
      target: "HOSTED_OAUTH_WRITE_SMOKE.md",
      ok: true,
      latencyMs: 1600,
      at: "2026-06-18T10:00:30.000Z",
    },
  ];

  const summaries = summarizeLatencyHistory(history, 2);
  const readSummary = summaries.find((summary) => summary.kind === "read");
  const writeSummary = summaries.find((summary) => summary.kind === "write");

  assert.equal(readSummary.sampleCount, 2);
  assert.equal(readSummary.failedCount, 1);
  assert.equal(readSummary.latestLatencyMs, 800);
  assert.equal(readSummary.averageLatencyMs, 600);
  assert.equal(readSummary.p50LatencyMs, 400);
  assert.equal(readSummary.p95LatencyMs, 800);
  assert.deepEqual(
    readSummary.trend.map((point) => point.latencyMs),
    [400, 800]
  );
  assert.equal(writeSummary.averageLatencyMs, 1600);
});

test("latency snapshot preserves legacy fields while adding history summaries", () => {
  const snapshot = buildLatencySnapshot({
    previousSnapshot,
    operationLatencies: [
      {
        name: "brain_list_conflicts",
        kind: "read",
        target: "ai-brain-jem",
        ok: true,
        latencyMs: 500,
        at: "2026-06-18T10:02:00.000Z",
      },
      {
        name: "hosted_to_local_sync",
        kind: "sync_wait",
        target: "HOSTED_OAUTH_WRITE_SMOKE.md",
        ok: true,
        latencyMs: 6400,
        at: "2026-06-18T10:02:05.000Z",
      },
    ],
    baseUrl: "https://example.com",
    brainId: "ai-brain-jem",
    smokeFilename: "HOSTED_OAUTH_WRITE_SMOKE.md",
    checkedAt: "2026-06-18T10:02:06.000Z",
  });

  assert.equal(snapshot.version, 2);
  assert.equal(snapshot.latestReadLatencyMs, 500);
  assert.equal(snapshot.latestWriteLatencyMs, 1200);
  assert.equal(snapshot.latestSyncWaitLatencyMs, 6400);
  assert.equal(snapshot.historyCount, 4);
  assert.equal(snapshot.operations.length, 2);
  assert.ok(snapshot.operationSummaries.some((summary) => summary.kind === "sync_wait"));
});
