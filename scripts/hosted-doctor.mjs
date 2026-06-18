import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import pg from "pg";
import { loadLocalEnv } from "./lib/load-local-env.mjs";
import {
  HOSTED_MCP_LATENCY_EVENT_TYPE,
  latencyHistoryFromSnapshot,
  latencyHistoryFromSyncEventRows,
  latestSuccessfulLatency,
  summarizeLatencyHistory,
} from "./lib/latency-summary.mjs";

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
const launchdLabel = process.env.BRAIN_SYNC_LAUNCHD_LABEL || "com.jem.brain-sync";
const databaseUrl = process.env.BRAIN_REVISION_DATABASE_URL;
const maxSyncHealthAgeMs = Number(
  process.env.BRAIN_SYNC_HEALTH_MAX_AGE_MS || 2 * 60 * 1000
);
const lintNudgeDays = Number(process.env.BRAIN_LINT_NUDGE_DAYS || 30);

const checks = [];

function addCheck(name, status, details = {}) {
  checks.push({ name, status, details });
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
      runtime.gitHotPath === "disabled" &&
      runtime.autoSyncEnabled === false;
    addCheck("hosted_health", ok ? "pass" : "fail", {
      baseUrl,
      httpStatus: response.status,
      transport: body.transport,
      revisionStore: runtime.revisionStore,
      artifactStore: runtime.artifactStore,
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

  const pool = new Pool({ connectionString: databaseUrl });
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

  const pool = new Pool({ connectionString: databaseUrl });
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
      const pool = new Pool({ connectionString: databaseUrl });
      try {
        const serverResult = await pool.query(
          latencyRowsQuery(
            "and (metadata->>'source' = 'hosted_mcp_server' or metadata->>'kind' = 'sync_wait')"
          ),
          [brainId, HOSTED_MCP_LATENCY_EVENT_TYPE, userOperationLatencyHistoryLimit]
        );
        const history = latencyHistoryFromSyncEventRows(serverResult.rows);
        if (history.length > 0) {
          addUserOperationLatencyCheck({
            source: "postgres",
            telemetrySource: "hosted_mcp_server_plus_sync_wait",
            checkedAt: history.at(-1)?.at || null,
            history,
            operationCount: history.length,
          });
          return;
        }

        const legacyResult = await pool.query(
          latencyRowsQuery(""),
          [brainId, HOSTED_MCP_LATENCY_EVENT_TYPE, userOperationLatencyHistoryLimit]
        );
        const legacyHistory = latencyHistoryFromSyncEventRows(legacyResult.rows);
        if (legacyHistory.length > 0) {
          addUserOperationLatencyCheck({
            source: "postgres",
            telemetrySource: "legacy_client_or_unspecified",
            postgresState: "server_empty",
            checkedAt: legacyHistory.at(-1)?.at || null,
            history: legacyHistory,
            operationCount: legacyHistory.length,
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
  postgresState,
  postgresError,
}) {
  const operationSummaries = summarizeLatencyHistory(history);
  const operations = history.slice(-12).reverse();

  addCheck("user_operation_latency", status, {
    source,
    telemetrySource,
    latencyFile,
    state: "recorded",
    postgresState,
    postgresError,
    checkedAt,
    latestOperationAt: latestOperationAt || history.at(-1)?.at || null,
    latestReadLatencyMs: latestReadLatencyMs ?? latestSuccessfulLatency(history, "read"),
    latestWriteLatencyMs: latestWriteLatencyMs ?? latestSuccessfulLatency(history, "write"),
    latestSyncWaitLatencyMs:
      latestSyncWaitLatencyMs ?? latestSuccessfulLatency(history, "sync_wait"),
    operationCount: operationCount ?? operations.length,
    historyCount: history.length,
    operationSummaries,
    operations,
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

  const handledWarnings = new Set([
    "sync_health",
    "launchd",
    "lint_nudge",
    "inbox",
  ]);
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
