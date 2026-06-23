import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import pg from "pg";
import { loadLocalEnv } from "./lib/load-local-env.mjs";
import {
  diagnoseLatencyPerformance,
  HOSTED_MCP_AUTH_EVENT_TYPE,
  HOSTED_MCP_LATENCY_EVENT_TYPE,
  latencyHistoryFromSnapshot,
  latencyHistoryFromSyncEventRows,
  latestSuccessfulLatency,
  normalizeLatencySloThresholds,
  operationEventLogFromSyncEventRows,
  operationKindLabel,
  slowestLatencyOperations,
  summarizeOperationUsage,
  summarizeLatencyHistory,
  summarizeLatencyHistoryByTimingLayer,
  summarizeLatencyHistoryByTool,
} from "./lib/latency-summary.mjs";
import { classifyPoolerUrl } from "../dist/services/pooler.js";

loadLocalEnv();

const exec = promisify(execFile);
const { Pool } = pg;

const baseUrl = (process.env.BRAIN_HOSTED_BASE_URL || "https://jem-brain-mcp.fly.dev")
  .replace(/\/$/, "");
const brainId = process.env.BRAIN_ID || "ai-brain-jem";
const brainDir =
  process.env.BRAIN_DIR || path.join(os.homedir(), "Projects", "ai-brain-jem", "brain");
const inboxDir =
  process.env.BRAIN_INBOX_DIR || path.resolve(brainDir, "..", "inbox");
const stateFile =
  process.env.BRAIN_SYNC_STATE_FILE ||
  path.resolve(brainDir, "..", ".brain-sync", "state.json");
const lockFile = process.env.BRAIN_SYNC_LOCK_FILE || `${stateFile}.lock`;
const healthFile =
  process.env.BRAIN_SYNC_HEALTH_FILE || `${stateFile}.health.json`;
const userOperationLatencyFile =
  process.env.BRAIN_HOSTED_MCP_LATENCY_FILE ||
  path.resolve(brainDir, "..", ".brain-sync", "hosted-mcp-latency.json");
const userOperationLatencyHistoryLimit = Math.max(
  1,
  Number(process.env.BRAIN_HOSTED_MCP_LATENCY_HISTORY_LIMIT || 240)
);
const userOperationEventLogLimit = Math.max(
  1,
  Number(process.env.BRAIN_HOSTED_MCP_EVENT_LOG_LIMIT || 60)
);
const userOperationEventLogWindowDays = Math.max(
  1,
  Number(process.env.BRAIN_HOSTED_MCP_EVENT_LOG_DAYS || 30)
);
const launchdLabel = process.env.BRAIN_SYNC_LAUNCHD_LABEL || "com.jem.brain-sync";
const databaseUrl = process.env.BRAIN_REVISION_DATABASE_URL;
const maxSyncHealthAgeMs = Number(
  process.env.BRAIN_SYNC_HEALTH_MAX_AGE_MS || 2 * 60 * 1000
);
const lintNudgeDays = Number(process.env.BRAIN_LINT_NUDGE_DAYS || 30);
const latencySloThresholds = normalizeLatencySloThresholds({
  serverReadP95WarnMs: numericEnv("BRAIN_SLO_SERVER_READ_P95_WARN_MS"),
  serverReadP95FailMs: numericEnv("BRAIN_SLO_SERVER_READ_P95_FAIL_MS"),
  serverWriteP95WarnMs: numericEnv("BRAIN_SLO_SERVER_WRITE_P95_WARN_MS"),
  serverWriteP95FailMs: numericEnv("BRAIN_SLO_SERVER_WRITE_P95_FAIL_MS"),
  clientReadP95WarnMs: numericEnv("BRAIN_SLO_CLIENT_READ_P95_WARN_MS"),
  clientReadP95FailMs: numericEnv("BRAIN_SLO_CLIENT_READ_P95_FAIL_MS"),
  clientWriteP95WarnMs: numericEnv("BRAIN_SLO_CLIENT_WRITE_P95_WARN_MS"),
  clientWriteP95FailMs: numericEnv("BRAIN_SLO_CLIENT_WRITE_P95_FAIL_MS"),
  syncWaitP95WarnMs: numericEnv("BRAIN_SLO_SYNC_WAIT_P95_WARN_MS"),
  syncWaitP95FailMs: numericEnv("BRAIN_SLO_SYNC_WAIT_P95_FAIL_MS"),
  dbMaxSpanWarnMs: numericEnv("BRAIN_SLO_DB_MAX_SPAN_WARN_MS"),
  dbMaxSpanFailMs: numericEnv("BRAIN_SLO_DB_MAX_SPAN_FAIL_MS"),
  dbFailedQueryWarnCount: numericEnv("BRAIN_SLO_DB_FAILED_QUERY_WARN_COUNT"),
});
const CHECK_STATUS_RANK = {
  pass: 0,
  warn: 1,
  fail: 2,
};

const checks = [];

function addCheck(name, status, details = {}) {
  checks.push({ name, status, details });
}

function numericEnv(name) {
  if (process.env[name] === undefined || process.env[name] === "") return undefined;
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

function combineCheckStatuses(...statuses) {
  return statuses
    .flat()
    .filter(Boolean)
    .reduce(
      (current, next) =>
        (CHECK_STATUS_RANK[next] ?? 0) > (CHECK_STATUS_RANK[current] ?? 0)
          ? next
          : current,
      "pass"
    );
}

function lastCheckByName(name) {
  for (let index = checks.length - 1; index >= 0; index -= 1) {
    if (checks[index]?.name === name) return checks[index];
  }
  return null;
}

async function timedCheck(name, fn) {
  const startedAt = Date.now();
  try {
    await fn();
  } finally {
    const check = lastCheckByName(name);
    if (check) {
      check.details.latencyMs = Date.now() - startedAt;
    }
  }
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    return true;
  }
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf-8"));
}

async function checkHostedHealth() {
  try {
    const response = await fetch(`${baseUrl}/health`, {
      signal: AbortSignal.timeout(10000),
    });
    const body = await response.json();
    const runtime = body.runtime || {};
    const ok =
      response.ok &&
      body.ok === true &&
      runtime.revisionStore === "postgres" &&
      runtime.artifactStore === "supabase" &&
      runtime.oauthStateStore === "postgres" &&
      runtime.gitHotPath === "disabled" &&
      runtime.autoSyncEnabled === false;
    addCheck("hosted_health", ok ? "pass" : "fail", {
      baseUrl,
      httpStatus: response.status,
      transport: body.transport,
      revisionStore: runtime.revisionStore,
      artifactStore: runtime.artifactStore,
      oauthStateStore: runtime.oauthStateStore,
      artifactByteAccess: runtime.artifactByteAccess,
      gitHotPath: runtime.gitHotPath,
      autoSyncEnabled: runtime.autoSyncEnabled,
    });
  } catch (error) {
    addCheck("hosted_health", "fail", { baseUrl, error: error.message });
  }
}

async function checkPostgresSummary() {
  if (!databaseUrl) {
    addCheck("postgres_summary", "warn", {
      brainId,
      databaseUrl: "missing",
    });
    return;
  }

  const pool = new Pool({ max: 2, connectionString: databaseUrl });
  try {
    const result = await pool.query(
      `
        select
          (select count(*)::int from brain.brain_files where brain_id = $1) as hosted_files,
          (select count(*)::int from brain.sync_conflicts where brain_id = $1 and status = 'open') as open_conflicts,
          (select max(updated_at) from brain.brain_files where brain_id = $1) as latest_hosted_update
      `,
      [brainId]
    );
    const row = result.rows[0];
    addCheck("postgres_summary", "pass", {
      brainId,
      databaseUrl: "set",
      hostedFiles: row.hosted_files,
      openConflicts: row.open_conflicts,
      latestHostedUpdate: row.latest_hosted_update
        ? row.latest_hosted_update.toISOString()
        : null,
    });
  } catch (error) {
    addCheck("postgres_summary", "fail", {
      brainId,
      databaseUrl: "set",
      error: error.message,
    });
  } finally {
    await pool.end().catch(() => undefined);
  }
}

async function checkRecentActivity() {
  if (!databaseUrl) {
    addCheck("recent_activity", "warn", {
      brainId,
      databaseUrl: "missing",
      events: [],
    });
    return;
  }

  const pool = new Pool({ max: 2, connectionString: databaseUrl });
  try {
    const result = await pool.query(
      `
        with revision_events as (
          select
            created_at as occurred_at,
            'file_revision' as event_type,
            filename,
            origin,
            actor_name,
            actor_email,
            content_sha256,
            id::text as reference_id
          from brain.brain_file_revisions
          where brain_id = $1
        ),
        conflict_events as (
          select
            created_at as occurred_at,
            'conflict_opened' as event_type,
            filename,
            local_origin as origin,
            null::text as actor_name,
            null::text as actor_email,
            local_content_sha256 as content_sha256,
            id::text as reference_id
          from brain.sync_conflicts
          where brain_id = $1

          union all

          select
            resolved_at as occurred_at,
            'conflict_resolved' as event_type,
            filename,
            remote_origin as origin,
            null::text as actor_name,
            null::text as actor_email,
            remote_content_sha256 as content_sha256,
            id::text as reference_id
          from brain.sync_conflicts
          where brain_id = $1 and resolved_at is not null
        )
        select *
        from (
          select * from revision_events
          union all
          select * from conflict_events
        ) events
        where occurred_at is not null
        order by occurred_at desc
        limit 12
      `,
      [brainId]
    );
    addCheck("recent_activity", "pass", {
      brainId,
      events: result.rows.map((row) => ({
        occurredAt: row.occurred_at.toISOString(),
        eventType: row.event_type,
        filename: row.filename,
        origin: row.origin,
        actorName: row.actor_name,
        actorEmail: row.actor_email,
        contentSha256: row.content_sha256,
        referenceId: row.reference_id,
      })),
    });
  } catch (error) {
    addCheck("recent_activity", "warn", {
      brainId,
      databaseUrl: "set",
      error: error.message,
      events: [],
    });
  } finally {
    await pool.end().catch(() => undefined);
  }
}

async function checkLocalState() {
  try {
    const state = await readJson(stateFile);
    const stat = await fs.stat(stateFile);
    addCheck("local_sync_state", "pass", {
      brainDir,
      stateFile,
      modifiedAt: stat.mtime.toISOString(),
      clientId: state.clientId || null,
      cursor: state.cursor || null,
      trackedFiles: state.files ? Object.keys(state.files).length : 0,
    });
  } catch (error) {
    addCheck("local_sync_state", "warn", {
      brainDir,
      stateFile,
      error: error.message,
    });
  }
}

async function checkSyncLock() {
  try {
    const raw = await fs.readFile(lockFile, "utf-8");
    let payload = null;
    try {
      payload = JSON.parse(raw);
    } catch {
      addCheck("sync_lock", "warn", {
        lockFile,
        state: "malformed",
      });
      return;
    }

    const pid = Number(payload.pid);
    const alive = Number.isInteger(pid) && pid > 0 ? isProcessAlive(pid) : false;
    addCheck("sync_lock", alive ? "pass" : "warn", {
      lockFile,
      state: alive ? "active" : "stale_or_dead_owner",
      pid: Number.isInteger(pid) ? pid : null,
      startedAt: payload.startedAt || null,
    });
  } catch (error) {
    if (error?.code === "ENOENT") {
      addCheck("sync_lock", "pass", {
        lockFile,
        state: "absent",
      });
      return;
    }
    addCheck("sync_lock", "warn", {
      lockFile,
      error: error.message,
    });
  }
}

async function checkSyncHealth() {
  try {
    const health = await readJson(healthFile);
    const checkedAt = health.checkedAt ? Date.parse(health.checkedAt) : NaN;
    const ageMs = Number.isNaN(checkedAt) ? null : Date.now() - checkedAt;
    const stale = ageMs === null || ageMs > maxSyncHealthAgeMs;
    const status =
      health.status === "ok" && !stale
        ? "pass"
        : health.status === "error"
          ? "fail"
          : "warn";

    addCheck("sync_health", status, {
      healthFile,
      state: stale ? "stale" : health.status || "unknown",
      checkedAt: health.checkedAt || null,
      ageMs,
      maxAgeMs: maxSyncHealthAgeMs,
      cycle: health.cycle ?? null,
      pushed: health.report?.pushed ?? null,
      pulled: health.report?.pulled ?? null,
      unchanged: health.report?.unchanged ?? null,
      conflicts: health.report?.conflicts ?? null,
      conflictFiles: health.report?.conflictFiles ?? [],
      totalMs: health.report?.totalMs ?? null,
      error: health.error || null,
    });
  } catch (error) {
    addCheck("sync_health", "warn", {
      healthFile,
      error: error.message,
    });
  }
}

async function checkUserOperationLatency() {
  let postgresFallback = null;
  if (databaseUrl) {
    try {
      const pool = new Pool({ max: 2, connectionString: databaseUrl });
      try {
        const primarySourceFilter =
          "and (metadata->>'source' = 'hosted_mcp_server' or metadata->>'kind' = 'sync_wait')";
        const clientSourceFilter =
          "and metadata->>'source' in ('hosted_mcp_client_e2e', 'smoke-hosted-oauth')";
        const serverTelemetry = await readPostgresOperationTelemetry(
          pool,
          primarySourceFilter
        );
        const clientTelemetry = await readPostgresOperationTelemetry(pool, clientSourceFilter);
        const history = serverTelemetry.history;
        const clientHistory = clientTelemetry.history;
        if (history.length > 0 || clientHistory.length > 0) {
          addUserOperationLatencyCheck({
            source: "postgres",
            telemetrySource: "hosted_mcp_server_plus_sync_wait_plus_client_e2e",
            checkedAt: latestAt([history, clientHistory]),
            history,
            clientHistory,
            operationCount: history.length,
            usageStats: serverTelemetry.usageStats,
            eventLog: mergeEventLogs(serverTelemetry.eventLog, clientTelemetry.eventLog),
          });
          return;
        }

        const legacyTelemetry = await readPostgresOperationTelemetry(pool, "");
        const legacyHistory = legacyTelemetry.history;
        if (legacyHistory.length > 0) {
          addUserOperationLatencyCheck({
            source: "postgres",
            telemetrySource: "legacy_client_or_unspecified",
            postgresState: "server_empty",
            checkedAt: legacyHistory.at(-1)?.at || null,
            history: legacyHistory,
            operationCount: legacyHistory.length,
            usageStats: legacyTelemetry.usageStats,
            eventLog: legacyTelemetry.eventLog,
          });
          return;
        }

        postgresFallback = { postgresState: "empty" };
      } finally {
        await pool.end().catch(() => undefined);
      }
    } catch (error) {
      postgresFallback = {
        postgresState: "unreadable",
        postgresError: error.message,
      };
    }
  }

  try {
    const snapshot = await readJson(userOperationLatencyFile);
    const history = latencyHistoryFromSnapshot(snapshot);
    addUserOperationLatencyCheck({
      status: postgresFallback?.postgresState === "unreadable" ? "warn" : "pass",
      source: "local_json_cache",
      latencyFile: userOperationLatencyFile,
      checkedAt: snapshot.checkedAt || null,
      latestOperationAt: snapshot.latestOperationAt || null,
      latestReadLatencyMs: snapshot.latestReadLatencyMs ?? null,
      latestWriteLatencyMs: snapshot.latestWriteLatencyMs ?? null,
      latestSyncWaitLatencyMs: snapshot.latestSyncWaitLatencyMs ?? null,
      operationCount: snapshot.operationCount ?? history.length,
      history,
      usageStats: summarizeOperationUsage(history),
      eventLog: eventLogFromHistory(history, "local_json_cache"),
      ...postgresFallback,
    });
  } catch (error) {
    if (error?.code === "ENOENT") {
      if (postgresFallback?.postgresState === "unreadable") {
        addCheck("user_operation_latency", "warn", {
          source: "postgres",
          latencyFile: userOperationLatencyFile,
          state: "unreadable",
          operations: [],
          ...postgresFallback,
        });
      } else {
        addCheck("user_operation_latency", "pass", {
          latencyFile: userOperationLatencyFile,
          state: "not_recorded",
          operations: [],
          ...postgresFallback,
        });
      }
      return;
    }
    addCheck("user_operation_latency", "warn", {
      latencyFile: userOperationLatencyFile,
      state: "unreadable",
      error: error.message,
      operations: [],
      ...postgresFallback,
    });
  }
}

function latencyRowsQuery(sourceFilter) {
  return `
    select event_type, filename, duration_ms, metadata, created_at
    from brain.sync_events
    where brain_id = $1
      and event_type = $2
      ${sourceFilter}
    order by created_at desc
    limit $3
  `;
}

function operationUsageRowsQuery(sourceFilter) {
  return `
    select
      coalesce(nullif(metadata->>'kind', ''), 'operation') as kind,
      count(*)::int as total_count,
      count(*) filter (where metadata->>'ok' = 'false')::int as failed_total,
      count(*) filter (where created_at >= now() - interval '24 hours')::int as count_24h,
      count(*) filter (
        where created_at >= now() - interval '24 hours'
          and metadata->>'ok' = 'false'
      )::int as failed_24h,
      count(*) filter (where created_at >= now() - interval '7 days')::int as count_7d,
      count(*) filter (
        where created_at >= now() - interval '7 days'
          and metadata->>'ok' = 'false'
      )::int as failed_7d
    from brain.sync_events
    where brain_id = $1
      and event_type = any($2::text[])
      ${sourceFilter}
    group by kind
    order by kind
  `;
}

function operationLogRowsQuery(sourceFilter) {
  return `
    select event_type, filename, duration_ms, metadata, created_at
    from brain.sync_events
    where brain_id = $1
      and event_type = any($2::text[])
      ${sourceFilter}
      and created_at >= $3::timestamptz
    order by created_at desc
    limit $4
  `;
}

function latestAt(histories) {
  return histories
    .flat()
    .map((operation) => operation.at)
    .filter(Boolean)
    .sort()
    .at(-1) || null;
}

function mergeEventLogs(...logs) {
  return logs
    .flat()
    .filter(Boolean)
    .sort((left, right) => Date.parse(right.at) - Date.parse(left.at))
    .slice(0, userOperationEventLogLimit);
}

async function readPostgresOperationTelemetry(pool, sourceFilter) {
  const eventLogCutoff = new Date(
    Date.now() - userOperationEventLogWindowDays * 24 * 60 * 60 * 1000
  ).toISOString();
  const [latencyResult, usageResult, eventLogResult] = await Promise.all([
    pool.query(latencyRowsQuery(sourceFilter), [
      brainId,
      HOSTED_MCP_LATENCY_EVENT_TYPE,
      userOperationLatencyHistoryLimit,
    ]),
    pool.query(operationUsageRowsQuery(sourceFilter), [
      brainId,
      [HOSTED_MCP_LATENCY_EVENT_TYPE, HOSTED_MCP_AUTH_EVENT_TYPE],
    ]),
    pool.query(operationLogRowsQuery(sourceFilter), [
      brainId,
      [HOSTED_MCP_LATENCY_EVENT_TYPE, HOSTED_MCP_AUTH_EVENT_TYPE],
      eventLogCutoff,
      userOperationEventLogLimit,
    ]),
  ]);

  return {
    history: latencyHistoryFromSyncEventRows(latencyResult.rows),
    usageStats: usageStatsFromAggregateRows(usageResult.rows),
    eventLog: operationEventLogFromSyncEventRows(eventLogResult.rows),
  };
}

function usageStatsFromAggregateRows(rows) {
  const now = Date.now();
  const kindOrder = new Map([
    ["read", 0],
    ["write", 1],
    ["sync_wait", 2],
    ["operation", 3],
  ]);
  const normalizedRows = (Array.isArray(rows) ? rows : []).map((row) => ({
    kind: String(row.kind || "operation"),
    label: operationKindLabel(String(row.kind || "operation")),
    totalCount: Number(row.total_count || 0),
    failedTotal: Number(row.failed_total || 0),
    count24h: Number(row.count_24h || 0),
    failed24h: Number(row.failed_24h || 0),
    count7d: Number(row.count_7d || 0),
    failed7d: Number(row.failed_7d || 0),
  })).sort((left, right) => {
    const leftRank = kindOrder.get(left.kind) ?? Number.MAX_SAFE_INTEGER;
    const rightRank = kindOrder.get(right.kind) ?? Number.MAX_SAFE_INTEGER;
    return leftRank === rightRank ? left.kind.localeCompare(right.kind) : leftRank - rightRank;
  });

  function bucket(key, label, countKey, failedKey, durationMs) {
    const byKind = normalizedRows
      .map((row) => ({
        kind: row.kind,
        label: row.label,
        totalCount: row[countKey],
        failedCount: row[failedKey],
      }))
      .filter((row) => row.totalCount > 0 || row.failedCount > 0);
    const bucketDetails = {
      key,
      label,
      totalCount: byKind.reduce((total, row) => total + row.totalCount, 0),
      failedCount: byKind.reduce((total, row) => total + row.failedCount, 0),
      byKind,
    };
    if (durationMs) {
      bucketDetails.durationMs = durationMs;
      bucketDetails.windowStartedAt = new Date(now - durationMs).toISOString();
      bucketDetails.windowEndedAt = new Date(now).toISOString();
    }
    return bucketDetails;
  }

  return {
    allTime: bucket("all", "All Recorded", "totalCount", "failedTotal"),
    windows: [
      bucket("24h", "24H", "count24h", "failed24h", 24 * 60 * 60 * 1000),
      bucket("7d", "7D", "count7d", "failed7d", 7 * 24 * 60 * 60 * 1000),
    ],
  };
}

function eventLogFromHistory(history, source) {
  return [...history]
    .slice(-userOperationEventLogLimit)
    .reverse()
    .map((operation) => ({
      eventType: HOSTED_MCP_LATENCY_EVENT_TYPE,
      filename: operation.target?.endsWith(".md") ? operation.target : null,
      ...operation,
      source: operation.source || source,
    }));
}

function addUserOperationLatencyCheck({
  status = "pass",
  source,
  telemetrySource,
  latencyFile,
  checkedAt,
  latestOperationAt,
  latestReadLatencyMs,
  latestWriteLatencyMs,
  latestSyncWaitLatencyMs,
  operationCount,
  history,
  clientHistory = [],
  usageStats,
  eventLog,
  postgresState,
  postgresError,
}) {
  const operationSummaries = summarizeLatencyHistory(history);
  const clientOperationSummaries = summarizeLatencyHistory(clientHistory);
  const timingLayerSummaries = summarizeLatencyHistoryByTimingLayer([
    ...history,
    ...clientHistory,
  ]);
  const toolSummaries = summarizeLatencyHistoryByTool([...history, ...clientHistory]);
  const slowestOperations = slowestLatencyOperations([...history, ...clientHistory]);
  const operations = history.slice(-12).reverse();
  const clientOperations = clientHistory.slice(-12).reverse();
  const performance = diagnoseLatencyPerformance({
    history,
    clientHistory,
    thresholds: latencySloThresholds,
  });

  addCheck("user_operation_latency", combineCheckStatuses(status, performance.status), {
    source,
    telemetrySource,
    latencyFile,
    state: "recorded",
    postgresState,
    postgresError,
    checkedAt,
    latestOperationAt: latestOperationAt || latestAt([history, clientHistory]),
    latestReadLatencyMs: latestReadLatencyMs ?? latestSuccessfulLatency(history, "read"),
    latestWriteLatencyMs: latestWriteLatencyMs ?? latestSuccessfulLatency(history, "write"),
    latestSyncWaitLatencyMs:
      latestSyncWaitLatencyMs ?? latestSuccessfulLatency(history, "sync_wait"),
    operationCount: operationCount ?? operations.length,
    historyCount: history.length,
    clientHistoryCount: clientHistory.length,
    usageStats: usageStats || summarizeOperationUsage(history),
    eventLogWindowDays: userOperationEventLogWindowDays,
    eventLogLimit: userOperationEventLogLimit,
    eventLog: eventLog || eventLogFromHistory(history, source),
    operationSummaries,
    clientOperationSummaries,
    timingLayerSummaries,
    toolSummaries,
    slowestOperations,
    performanceStatus: performance.status,
    slo: performance.slo,
    performanceFindings: performance.findings,
    dbSpanTargets: performance.dbSpanTargets,
    operations,
    clientOperations,
  });
}

async function checkLintNudge() {
  const logFile = path.join(brainDir, "LOG.md");
  try {
    const content = await fs.readFile(logFile, "utf-8");
    const match = content.match(/^## \[(\d{4}-\d{2}-\d{2})\] LINT/m);
    if (!match) {
      addCheck("lint_nudge", "warn", {
        logFile,
        state: "never_run",
        lastLintAt: null,
        maxAgeDays: lintNudgeDays,
      });
      return;
    }

    const lastLintAt = new Date(`${match[1]}T00:00:00.000Z`);
    const ageDays = Math.floor((Date.now() - lastLintAt.getTime()) / 86400000);
    addCheck("lint_nudge", ageDays > lintNudgeDays ? "warn" : "pass", {
      logFile,
      state: ageDays > lintNudgeDays ? "stale" : "fresh",
      lastLintAt: match[1],
      ageDays,
      maxAgeDays: lintNudgeDays,
    });
  } catch (error) {
    addCheck("lint_nudge", "warn", {
      logFile,
      state: "unreadable",
      error: error.message,
      maxAgeDays: lintNudgeDays,
    });
  }
}

async function checkInbox() {
  try {
    const entries = await fs.readdir(inboxDir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      if (entry.isDirectory()) continue;
      if (entry.name.startsWith(".") || entry.name === ".gitkeep") continue;
      const stat = await fs.stat(path.join(inboxDir, entry.name));
      files.push({
        name: entry.name,
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
      });
    }
    files.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
    addCheck("inbox", files.length > 0 ? "warn" : "pass", {
      inboxDir,
      pendingFiles: files.length,
      files: files.slice(0, 8),
    });
  } catch (error) {
    if (error?.code === "ENOENT") {
      addCheck("inbox", "pass", {
        inboxDir,
        pendingFiles: 0,
        state: "missing_empty",
      });
      return;
    }
    addCheck("inbox", "warn", {
      inboxDir,
      state: "unreadable",
      error: error.message,
    });
  }
}

function parseLaunchdOutput(stdout) {
  const state = stdout.match(/state = ([^\n]+)/)?.[1]?.trim() || null;
  const activeCount = stdout.match(/active count = ([^\n]+)/)?.[1]?.trim() || null;
  const lastExitCode = stdout.match(/last exit code = ([^\n]+)/)?.[1]?.trim() || null;
  return { state, activeCount, lastExitCode };
}

async function checkLaunchd() {
  if (process.platform !== "darwin") {
    addCheck("launchd", "warn", {
      label: launchdLabel,
      state: "unsupported_platform",
      platform: process.platform,
    });
    return;
  }

  try {
    const uid = String(process.getuid?.() || "");
    const { stdout } = await exec("launchctl", [
      "print",
      `gui/${uid}/${launchdLabel}`,
    ], {
      timeout: 10000,
      maxBuffer: 1024 * 1024,
    });
    const parsed = parseLaunchdOutput(stdout);
    const ok =
      parsed.state === "running" ||
      parsed.state === "spawn scheduled" ||
      parsed.activeCount === "1";
    addCheck("launchd", ok ? "pass" : "warn", {
      label: launchdLabel,
      ...parsed,
    });
  } catch (error) {
    addCheck("launchd", "warn", {
      label: launchdLabel,
      error: error.stderr?.trim() || error.message,
    });
  }
}

async function checkFlyStatus() {
  try {
    const { stdout } = await exec("flyctl", ["status", "--app", "jem-brain-mcp"], {
      timeout: 20000,
      maxBuffer: 1024 * 1024,
    });
    addCheck("fly_status", /1 passing/.test(stdout) ? "pass" : "warn", {
      app: "jem-brain-mcp",
      summary: stdout
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => /jem-brain-mcp|started|passing|deployment-/.test(line))
        .slice(0, 8),
    });
  } catch (error) {
    addCheck("fly_status", "warn", {
      app: "jem-brain-mcp",
      error: error.stderr?.trim() || error.message,
    });
  }
}

function checkByName(name) {
  return checks.find((check) => check.name === name);
}

function buildOperatorActions(status) {
  const actions = [];
  const postgres = checkByName("postgres_summary");
  const sync = checkByName("sync_health");
  const launchd = checkByName("launchd");
  const lint = checkByName("lint_nudge");
  const inbox = checkByName("inbox");
  const latency = checkByName("user_operation_latency");

  const openConflicts = postgres?.details?.openConflicts || 0;
  if (openConflicts > 0) {
    actions.push({
      level: "fail",
      title: "Resolve open sync conflicts before hosted writes.",
      detail: "Follow docs/conflict-resolution.md and resolve with reviewed Markdown content.",
    });
  }

  if (sync?.status === "fail") {
    actions.push({
      level: "fail",
      title: "Fix failing local sync health.",
      detail: "Run npm run sync -- summary, inspect the reported error, then rerun hosted:doctor.",
    });
  } else if (sync?.status === "warn") {
    actions.push({
      level: "warn",
      title: "Refresh stale or incomplete sync health.",
      detail: "Check the local launchd loop and recent sync logs before relying on hosted state.",
    });
  }

  if (launchd?.status === "warn") {
    actions.push({
      level: "warn",
      title: "Confirm the local sync LaunchAgent is running.",
      detail: "Restart the local sync agent if the state is stale, missing, or not confidently active.",
    });
  }

  if (lint?.status === "warn") {
    actions.push({
      level: "warn",
      title: "Run brain_lint before accuracy-sensitive Brain work.",
      detail: "The last lint pass is missing, stale, or unreadable from the local Brain log.",
    });
  }

  if ((inbox?.details?.pendingFiles || 0) > 0) {
    actions.push({
      level: "warn",
      title: "Review pending Brain inbox files.",
      detail: "Run brain_scan_inbox and process or intentionally defer the pending source files.",
    });
  }

  const latencyFinding = (latency?.details?.performanceFindings || [])
    .find((finding) => finding.level === "fail") ||
    (latency?.details?.performanceFindings || [])
      .find((finding) => finding.level === "warn");
  if (latencyFinding) {
    actions.push({
      level: latencyFinding.level,
      title: "Investigate hosted Brain latency.",
      detail: `${latencyFinding.title}. ${latencyFinding.detail}`,
    });
  }

  const handledWarnings = new Set([
    "sync_health",
    "launchd",
    "lint_nudge",
    "inbox",
  ]);
  if (latencyFinding) handledWarnings.add("user_operation_latency");
  for (const check of checks.filter((check) => check.status === "warn")) {
    if (handledWarnings.has(check.name)) continue;
    actions.push({
      level: "warn",
      title: `${check.name} needs review.`,
      detail: "Inspect hosted:doctor details; this warning does not block hosted use unless it affects the current operation.",
    });
  }

  for (const check of checks.filter((check) => check.status === "fail")) {
    if (check.name === "sync_health") continue;
    if (check.name === "user_operation_latency" && latencyFinding) continue;
    actions.push({
      level: "fail",
      title: `${check.name} failed.`,
      detail: "Inspect hosted:doctor details and fix this before relying on hosted Brain.",
    });
  }

  if (actions.length === 0 && status === "pass") {
    actions.push({
      level: "pass",
      title: "No operator action required.",
      detail: "Hosted health, local sync, conflicts, lint freshness, inbox, daemon, and Fly checks are currently acceptable.",
    });
  }

  return actions;
}

async function checkPoolerConfig() {
  const poolMax = Number(process.env.BRAIN_PG_POOL_MAX) || 4;
  const classification = classifyPoolerUrl(databaseUrl);

  if (process.env.BRAIN_REVISION_STORE !== "postgres" || !databaseUrl) {
    addCheck("pooler_config", "pass", {
      revisionStore: process.env.BRAIN_REVISION_STORE || "filesystem",
      mode: classification.mode,
      note: "postgres revision store not active; pooler config not applicable",
    });
    return;
  }

  // Live headroom: how many backend connections the runtime role currently
  // holds across all clients. max:1 so this probe adds at most one connection.
  let activeConnections = null;
  let connectionError = null;
  const pool = new Pool({ max: 1, connectionString: databaseUrl });
  try {
    const result = await pool.query(
      "select count(*)::int as n from pg_stat_activity where usename = current_user"
    );
    activeConnections = result.rows[0]?.n ?? null;
  } catch (error) {
    connectionError = error.message;
  } finally {
    await pool.end().catch(() => undefined);
  }

  // Warn only on the deterministic session-mode config. activeConnections is
  // reported for visibility but not auto-warned: the meaningful ceiling differs
  // by pooler mode, and the count is partly confounded by this doctor run's own
  // pools. The hard, known failure mode is session mode (~15-client cap).
  const sessionRisk = classification.mode === "session";

  addCheck("pooler_config", sessionRisk ? "warn" : "pass", {
    mode: classification.mode,
    pooler: classification.label,
    host: classification.host,
    port: classification.port,
    poolMaxPerPool: poolMax,
    activeConnections,
    ...(connectionError ? { connectionError } : {}),
    ...(sessionRisk
      ? {
          warning:
            "session-mode pooler in use: hard per-project client cap (~15) is shared across the hosted runtime pool + telemetry pool + local sync daemon + operator scripts and risks EMAXCONNSESSION under concurrent load. Use the transaction pooler (:6543). See docs/deploy-fly.md.",
        }
      : {}),
  });
}

const doctorStartedAt = Date.now();

await Promise.all([
  timedCheck("hosted_health", checkHostedHealth),
  timedCheck("postgres_summary", checkPostgresSummary),
  timedCheck("recent_activity", checkRecentActivity),
  timedCheck("local_sync_state", checkLocalState),
  timedCheck("sync_lock", checkSyncLock),
  timedCheck("sync_health", checkSyncHealth),
  timedCheck("user_operation_latency", checkUserOperationLatency),
  timedCheck("lint_nudge", checkLintNudge),
  timedCheck("inbox", checkInbox),
  timedCheck("launchd", checkLaunchd),
  timedCheck("fly_status", checkFlyStatus),
  timedCheck("pooler_config", checkPoolerConfig),
]);

const failed = checks.filter((check) => check.status === "fail");
const warnings = checks.filter((check) => check.status === "warn");
const status = failed.length ? "fail" : warnings.length ? "warn" : "pass";
const summary = {
  ok: failed.length === 0,
  status,
  checkedAt: new Date().toISOString(),
  latencyMs: Date.now() - doctorStartedAt,
  checks,
  actions: buildOperatorActions(status),
};

console.log(JSON.stringify(summary, null, 2));
if (failed.length > 0) process.exitCode = 1;
