import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appendLatencyHistory,
  buildLatencySnapshot,
  latencyHistoryFromSnapshot,
  latencyHistoryFromSyncEventRows,
  operationEventLogFromSyncEventRows,
  slowestLatencyOperations,
  summarizeOperationUsage,
  summarizeLatencyHistory,
  summarizeLatencyHistoryByTimingLayer,
  summarizeLatencyHistoryByTool,
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

  assert.equal(snapshot.version, 3);
  assert.equal(snapshot.latestReadLatencyMs, 500);
  assert.equal(snapshot.latestWriteLatencyMs, 1200);
  assert.equal(snapshot.latestSyncWaitLatencyMs, 6400);
  assert.equal(snapshot.historyCount, 4);
  assert.equal(snapshot.operations.length, 2);
  assert.ok(snapshot.operationSummaries.some((summary) => summary.kind === "sync_wait"));
  assert.ok(snapshot.timingLayerSummaries.some((summary) => summary.timingLayer === "unknown"));
  assert.ok(snapshot.toolSummaries.some((summary) => summary.name === "brain_list_conflicts"));
  assert.ok(snapshot.slowestOperations.some((operation) => operation.name === "hosted_to_local_sync"));
});

test("latency history can be built from Postgres sync_events rows", () => {
  const history = latencyHistoryFromSyncEventRows([
    {
      event_type: "hosted_mcp_latency",
      filename: "NOW.md",
      duration_ms: "510",
      created_at: new Date("2026-06-18T10:03:00.000Z"),
      metadata: {
        source: "hosted_mcp_server",
        timingLayer: "server_tool",
        name: "brain_read_file",
        kind: "read",
        target: "NOW.md",
        ok: true,
        db: {
          queryCount: 1,
          totalMs: 12.5,
          averageMs: 12.5,
          maxMs: 12.5,
          rowCount: 1,
          failedCount: 0,
          truncatedCount: 0,
          spans: [
            {
              name: "brain_runtime.select:brain.brain_files+brain.brain_file_revisions",
              operation: "select",
              target: "brain.brain_files+brain.brain_file_revisions",
              durationMs: 12.5,
              ok: true,
              rowCount: 1,
            },
          ],
        },
      },
    },
    {
      event_type: "hosted_mcp_latency",
      filename: null,
      duration_ms: "1500",
      created_at: "2026-06-18T10:03:05.000Z",
      metadata: {
        name: "brain_update_file",
        kind: "write",
        target: "HOSTED_OAUTH_WRITE_SMOKE.md",
        ok: false,
        error: "conflict",
      },
    },
  ]);

  assert.equal(history.length, 2);
  assert.equal(history[0].latencyMs, 510);
  assert.equal(history[0].target, "NOW.md");
  assert.equal(history[0].source, "hosted_mcp_server");
  assert.equal(history[0].timingLayer, "server_tool");
  assert.equal(history[0].db.queryCount, 1);
  assert.equal(history[0].db.spans[0].operation, "select");
  assert.equal(history[1].ok, false);
  assert.equal(history[1].error, "conflict");
});

test("latency summaries separate timing layers, exact tools, slowest operations, and DB contribution", () => {
  const history = latencyHistoryFromSyncEventRows([
    {
      event_type: "hosted_mcp_latency",
      filename: "NOW.md",
      duration_ms: "220",
      created_at: "2026-06-18T10:03:00.000Z",
      metadata: {
        source: "hosted_mcp_server",
        timingLayer: "server_tool",
        name: "brain_read_file",
        kind: "read",
        target: "NOW.md",
        ok: true,
        db: {
          queryCount: 1,
          totalMs: 25,
          averageMs: 25,
          maxMs: 25,
          rowCount: 1,
          failedCount: 0,
          truncatedCount: 0,
          spans: [],
        },
      },
    },
    {
      event_type: "hosted_mcp_latency",
      filename: "NOW.md",
      duration_ms: "360",
      created_at: "2026-06-18T10:03:01.000Z",
      metadata: {
        source: "hosted_mcp_client_e2e",
        timingLayer: "client_e2e",
        durationType: "client_observed_tool_call",
        name: "brain_read_file",
        kind: "read",
        target: "NOW.md",
        ok: true,
      },
    },
  ]);

  const layerSummaries = summarizeLatencyHistoryByTimingLayer(history);
  const toolSummaries = summarizeLatencyHistoryByTool(history);
  const slowest = slowestLatencyOperations(history);

  assert.deepEqual(
    layerSummaries.map((summary) => summary.timingLayer),
    ["server_tool", "client_e2e"]
  );
  assert.equal(
    toolSummaries.find((summary) => summary.timingLayer === "server_tool").db.queryCount,
    1
  );
  assert.equal(slowest[0].timingLayer, "client_e2e");
  assert.equal(slowest[0].latencyMs, 360);
});

test("operation usage summarizes all-time and fixed-window counts", () => {
  const usage = summarizeOperationUsage(
    [
      {
        name: "brain_read_file",
        kind: "read",
        target: "NOW.md",
        ok: true,
        latencyMs: 300,
        at: "2026-06-18T12:30:00.000Z",
      },
      {
        name: "brain_update_file",
        kind: "write",
        target: "TASKS.md",
        ok: false,
        latencyMs: 1100,
        at: "2026-06-18T11:00:00.000Z",
        error: "conflict",
      },
      {
        name: "brain_search",
        kind: "read",
        target: "query",
        ok: true,
        latencyMs: 450,
        at: "2026-06-12T12:00:00.000Z",
      },
    ],
    { now: "2026-06-18T13:00:00.000Z" }
  );

  assert.equal(usage.allTime.totalCount, 3);
  assert.equal(usage.allTime.failedCount, 1);
  assert.equal(usage.windows.find((window) => window.key === "24h").totalCount, 2);
  assert.equal(usage.windows.find((window) => window.key === "7d").totalCount, 3);
  assert.equal(
    usage.windows
      .find((window) => window.key === "24h")
      .byKind.find((row) => row.kind === "write").failedCount,
    1
  );
});

test("operation event log preserves safe metadata from sync_events rows", () => {
  const events = operationEventLogFromSyncEventRows([
    {
      event_type: "hosted_mcp_latency",
      filename: "NOW.md",
      duration_ms: "510",
      created_at: "2026-06-18T10:03:00.000Z",
      metadata: {
        source: "hosted_mcp_server",
        name: "brain_read_file",
        kind: "read",
        target: "NOW.md",
        ok: true,
      },
    },
    {
      event_type: "hosted_mcp_latency",
      filename: null,
      duration_ms: "1500",
      created_at: "2026-06-18T10:03:05.000Z",
      metadata: {
        source: "hosted_mcp_server",
        name: "brain_update_file",
        kind: "write",
        target: "TASKS.md",
        ok: false,
        error: "conflict",
      },
    },
  ]);

  assert.equal(events.length, 2);
  assert.equal(events[0].name, "brain_update_file");
  assert.equal(events[0].source, "hosted_mcp_server");
  assert.equal(events[0].error, "conflict");
  assert.equal(events[1].filename, "NOW.md");
});
