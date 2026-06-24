import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appendLatencyHistory,
  buildLatencySnapshot,
  diagnoseLatencyPerformance,
  evaluateLatencySlo,
  latencyHistoryFromSnapshot,
  latencyHistoryFromSyncEventRows,
  normalizeLatencySloThresholds,
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

test("auth failure summaries report trends, reasons, targets, and recent metadata", async () => {
  const { authFailureSummaryFromSyncEventRows } = await import(
    "../scripts/lib/latency-summary.mjs"
  );
  const now = "2026-06-24T09:00:00.000Z";
  const rows = [
    {
      event_type: "hosted_mcp_auth",
      duration_ms: 91,
      created_at: "2026-06-24T08:58:00.000Z",
      metadata: {
        ok: false,
        error: "unknown_client_id",
        name: "oauth_token",
        target: "chatgpt",
        source: "hosted_mcp_server",
        httpStatus: 401,
      },
    },
    {
      event_type: "hosted_mcp_auth",
      duration_ms: 45,
      created_at: "2026-06-24T08:44:00.000Z",
      metadata: {
        ok: false,
        error: "missing_bearer",
        name: "mcp_request",
        target: "claude",
        source: "hosted_mcp_server",
        httpStatus: 401,
      },
    },
    {
      event_type: "hosted_mcp_auth",
      duration_ms: 38,
      created_at: "2026-06-24T08:36:00.000Z",
      metadata: {
        ok: true,
        name: "oauth_token",
        target: "claude",
        source: "hosted_mcp_server",
        httpStatus: 200,
      },
    },
    {
      event_type: "hosted_mcp_auth",
      duration_ms: 88,
      created_at: "2026-06-24T08:08:00.000Z",
      metadata: {
        ok: false,
        error: "unknown_client_id",
        name: "oauth_token",
        target: "chatgpt",
        source: "hosted_mcp_server",
        httpStatus: 401,
      },
    },
    {
      event_type: "hosted_mcp_auth",
      duration_ms: 75,
      created_at: "2026-06-24T07:30:00.000Z",
      metadata: {
        ok: false,
        error: "token_expired",
        name: "oauth_token",
        target: "chatgpt",
        source: "hosted_mcp_server",
        httpStatus: 401,
      },
    },
  ];

  const summary = authFailureSummaryFromSyncEventRows(rows, {
    now,
    windowMinutes: 60,
    warnThreshold: 3,
    failThreshold: 10,
    bucketCount: 4,
    recentLimit: 2,
  });

  assert.equal(summary.windowMinutes, 60);
  assert.equal(summary.failureCount, 3);
  assert.equal(summary.successCount, 1);
  assert.equal(summary.totalAuthEvents, 4);
  assert.equal(summary.failureRate, 0.75);
  assert.equal(summary.previousFailureCount, 1);
  assert.equal(summary.failureDelta, 2);
  assert.equal(summary.lastFailureAt, "2026-06-24T08:58:00.000Z");
  assert.equal(summary.firstFailureAt, "2026-06-24T08:08:00.000Z");
  assert.equal(summary.minutesSinceLastFailure, 2);
  assert.equal(summary.active, true);
  assert.equal(summary.reasons[0].reason, "unknown_client_id");
  assert.equal(summary.reasons[0].count, 2);
  assert.equal(summary.reasons[0].share, 0.667);
  assert.equal(summary.targets[0].target, "chatgpt");
  assert.equal(summary.targets[0].count, 2);
  assert.deepEqual(
    summary.trend.map((bucket) => bucket.failureCount),
    [1, 0, 1, 1]
  );
  assert.equal(summary.recentFailures.length, 2);
  assert.deepEqual(Object.keys(summary.recentFailures[0]).sort(), [
    "at",
    "clientId",
    "durationMs",
    "grantType",
    "httpStatus",
    "name",
    "reason",
    "source",
    "target",
  ]);
});

test("auth summary flags a sustained single unregistered client as a stale connector", async () => {
  const { authFailureSummaryFromSyncEventRows } = await import(
    "../scripts/lib/latency-summary.mjs"
  );
  const now = "2026-06-24T09:00:00.000Z";
  // Same zombie client id, unknown_client_id on refresh_token, spanning > grace.
  const zombie = (createdAt) => ({
    event_type: "hosted_mcp_auth",
    duration_ms: 4,
    created_at: createdAt,
    metadata: {
      ok: false,
      error: "unknown_client_id",
      name: "oauth_token",
      source: "hosted_mcp_server",
      httpStatus: 401,
      clientId: "mcp_client_zombie",
      grantType: "refresh_token",
    },
  });
  const rows = [
    zombie("2026-06-24T08:20:00.000Z"),
    zombie("2026-06-24T08:40:00.000Z"),
    zombie("2026-06-24T08:58:00.000Z"),
  ];
  const summary = authFailureSummaryFromSyncEventRows(rows, {
    now,
    windowMinutes: 60,
    warnThreshold: 3,
    failThreshold: 3,
    staleGraceMinutes: 10,
    registeredClientIds: ["mcp_client_real_chatgpt", "mcp_client_real_claude"],
  });
  assert.equal(summary.status, "fail");
  assert.equal(summary.connectorState, "stale_connector");
  assert.equal(summary.staleClientId, "mcp_client_zombie");
  assert.equal(summary.effectiveStatus, "warn");
  assert.equal(summary.clients[0].clientId, "mcp_client_zombie");
  assert.equal(summary.grantTypes[0].grantType, "refresh_token");
});

test("auth summary keeps full severity when the stale pattern is ambiguous", async () => {
  const { authFailureSummaryFromSyncEventRows } = await import(
    "../scripts/lib/latency-summary.mjs"
  );
  const now = "2026-06-24T09:00:00.000Z";
  const base = (extra, createdAt) => ({
    event_type: "hosted_mcp_auth",
    duration_ms: 4,
    created_at: createdAt,
    metadata: {
      ok: false,
      name: "oauth_token",
      source: "hosted_mcp_server",
      httpStatus: 401,
      ...extra,
    },
  });
  const opts = {
    now,
    windowMinutes: 60,
    warnThreshold: 3,
    failThreshold: 3,
    staleGraceMinutes: 10,
  };

  // (a) registered set unknown -> cannot confirm stale -> full severity
  const unknownReg = authFailureSummaryFromSyncEventRows(
    [
      base({ error: "unknown_client_id", clientId: "z", grantType: "refresh_token" }, "2026-06-24T08:20:00.000Z"),
      base({ error: "unknown_client_id", clientId: "z", grantType: "refresh_token" }, "2026-06-24T08:40:00.000Z"),
      base({ error: "unknown_client_id", clientId: "z", grantType: "refresh_token" }, "2026-06-24T08:58:00.000Z"),
    ],
    opts
  );
  assert.equal(unknownReg.connectorState, "incident");
  assert.equal(unknownReg.effectiveStatus, "fail");

  // (b) two distinct client ids -> not single -> full severity
  const multiClient = authFailureSummaryFromSyncEventRows(
    [
      base({ error: "unknown_client_id", clientId: "z1", grantType: "refresh_token" }, "2026-06-24T08:20:00.000Z"),
      base({ error: "unknown_client_id", clientId: "z2", grantType: "refresh_token" }, "2026-06-24T08:40:00.000Z"),
      base({ error: "unknown_client_id", clientId: "z1", grantType: "refresh_token" }, "2026-06-24T08:58:00.000Z"),
    ],
    { ...opts, registeredClientIds: [] }
  );
  assert.equal(multiClient.connectorState, "incident");
  assert.equal(multiClient.effectiveStatus, "fail");

  // (c) within grace window (short burst) -> not yet stale -> full severity
  const shortBurst = authFailureSummaryFromSyncEventRows(
    [
      base({ error: "unknown_client_id", clientId: "z", grantType: "refresh_token" }, "2026-06-24T08:58:30.000Z"),
      base({ error: "unknown_client_id", clientId: "z", grantType: "refresh_token" }, "2026-06-24T08:59:00.000Z"),
      base({ error: "unknown_client_id", clientId: "z", grantType: "refresh_token" }, "2026-06-24T08:59:40.000Z"),
    ],
    { ...opts, registeredClientIds: [], staleGraceMinutes: 30 }
  );
  assert.equal(shortBurst.connectorState, "incident");
  assert.equal(shortBurst.effectiveStatus, "fail");

  // (d) mixed reasons (missing_bearer) -> ambiguous -> full severity
  const multiReason = authFailureSummaryFromSyncEventRows(
    [
      base({ error: "unknown_client_id", clientId: "z", grantType: "refresh_token" }, "2026-06-24T08:20:00.000Z"),
      base({ error: "missing_bearer", name: "mcp_authorization" }, "2026-06-24T08:40:00.000Z"),
      base({ error: "unknown_client_id", clientId: "z", grantType: "refresh_token" }, "2026-06-24T08:58:00.000Z"),
    ],
    { ...opts, registeredClientIds: [] }
  );
  assert.equal(multiReason.connectorState, "incident");
  assert.equal(multiReason.effectiveStatus, "fail");
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

test("operation event log includes auth events without requiring latency duration", () => {
  const events = operationEventLogFromSyncEventRows([
    {
      event_type: "hosted_mcp_auth",
      filename: null,
      duration_ms: null,
      created_at: "2026-06-18T10:04:00.000Z",
      metadata: {
        source: "hosted_mcp_server",
        timingLayer: "auth",
        durationType: "auth_failure",
        name: "oauth_token",
        kind: "auth",
        target: "invalid_grant",
        ok: false,
        error: "invalid_grant",
      },
    },
  ]);
  const history = latencyHistoryFromSyncEventRows([
    {
      event_type: "hosted_mcp_auth",
      filename: null,
      duration_ms: null,
      created_at: "2026-06-18T10:04:00.000Z",
      metadata: {
        source: "hosted_mcp_server",
        timingLayer: "auth",
        durationType: "auth_failure",
        name: "oauth_token",
        kind: "auth",
        target: "invalid_grant",
        ok: false,
        error: "invalid_grant",
      },
    },
  ]);

  assert.equal(events.length, 1);
  assert.equal(events[0].eventType, "hosted_mcp_auth");
  assert.equal(events[0].kind, "auth");
  assert.equal(events[0].target, "invalid_grant");
  assert.equal(events[0].latencyMs, 0);
  assert.equal(history.length, 0);
});

test("latency SLOs warn on slow reads and identify DB hotspots", () => {
  const history = latencyHistoryFromSyncEventRows([
    {
      event_type: "hosted_mcp_latency",
      filename: "NOW.md",
      duration_ms: "800",
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
          totalMs: 80,
          averageMs: 80,
          maxMs: 80,
          rowCount: 1,
          failedCount: 0,
          truncatedCount: 0,
          spans: [
            {
              operation: "select",
              target: "brain.brain_files+brain.brain_file_revisions",
              durationMs: 80,
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
      duration_ms: "1200",
      created_at: "2026-06-18T10:04:00.000Z",
      metadata: {
        source: "hosted_mcp_server",
        timingLayer: "server_tool",
        name: "brain_sync_status",
        kind: "read",
        target: "ai-brain-jem",
        ok: true,
        db: {
          queryCount: 2,
          totalMs: 980,
          averageMs: 490,
          maxMs: 900,
          rowCount: 0,
          failedCount: 0,
          truncatedCount: 0,
          spans: [
            {
              operation: "select",
              target: "brain.sync_conflicts",
              durationMs: 900,
              ok: true,
              rowCount: 0,
            },
            {
              operation: "select",
              target: "brain.brain_files+brain.brain_file_revisions",
              durationMs: 80,
              ok: true,
              rowCount: 50,
            },
          ],
        },
      },
    },
    {
      event_type: "hosted_mcp_latency",
      filename: null,
      duration_ms: "1800",
      created_at: "2026-06-18T10:05:00.000Z",
      metadata: {
        source: "hosted_mcp_server",
        timingLayer: "server_tool",
        name: "brain_list_files",
        kind: "read",
        target: "ai-brain-jem",
        ok: true,
        db: {
          queryCount: 1,
          totalMs: 700,
          averageMs: 700,
          maxMs: 700,
          rowCount: 50,
          failedCount: 0,
          truncatedCount: 0,
          spans: [
            {
              operation: "select",
              target: "brain.brain_files+brain.brain_file_revisions",
              durationMs: 700,
              ok: true,
              rowCount: 50,
            },
          ],
        },
      },
    },
  ]);
  const clientHistory = latencyHistoryFromSyncEventRows([
    {
      event_type: "hosted_mcp_latency",
      filename: "NOW.md",
      duration_ms: "2600",
      created_at: "2026-06-18T10:06:00.000Z",
      metadata: {
        source: "hosted_mcp_client_e2e",
        timingLayer: "client_e2e",
        name: "brain_read_file",
        kind: "read",
        target: "NOW.md",
        ok: true,
      },
    },
  ]);
  const thresholds = normalizeLatencySloThresholds({
    serverReadP95WarnMs: 1000,
    serverReadP95FailMs: 3000,
    clientReadP95WarnMs: 2000,
    clientReadP95FailMs: 5000,
    dbMaxSpanWarnMs: 500,
    dbMaxSpanFailMs: 2500,
  });

  const slo = evaluateLatencySlo({ history, clientHistory, thresholds });
  assert.equal(slo.status, "warn");
  assert.equal(
    slo.evaluations.find((evaluation) => evaluation.id === "server_read_p95").status,
    "warn"
  );
  assert.equal(
    slo.evaluations.find((evaluation) => evaluation.id === "client_read_p95").status,
    "warn"
  );
  assert.equal(
    slo.evaluations.find((evaluation) => evaluation.id === "db_max_span").status,
    "warn"
  );

  const diagnosis = diagnoseLatencyPerformance({ history, clientHistory, thresholds });
  assert.equal(diagnosis.status, "warn");
  assert.equal(diagnosis.dbSpanTargets[0].target, "brain.sync_conflicts");
  assert.ok(
    diagnosis.findings.some((finding) => finding.metricId === "server_read_p95")
  );
});
