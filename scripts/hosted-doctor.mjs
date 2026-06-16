import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import pg from "pg";
import { loadLocalEnv } from "./lib/load-local-env.mjs";

loadLocalEnv();

const exec = promisify(execFile);
const { Pool } = pg;

const baseUrl = (process.env.BRAIN_HOSTED_BASE_URL || "https://jem-brain-mcp.fly.dev")
  .replace(/\/$/, "");
const brainId = process.env.BRAIN_ID || "ai-brain-jem";
const brainDir =
  process.env.BRAIN_DIR || path.join(os.homedir(), "Projects", "ai-brain-jem", "brain");
const stateFile =
  process.env.BRAIN_SYNC_STATE_FILE ||
  path.resolve(brainDir, "..", ".brain-sync", "state.json");
const lockFile = process.env.BRAIN_SYNC_LOCK_FILE || `${stateFile}.lock`;
const healthFile =
  process.env.BRAIN_SYNC_HEALTH_FILE || `${stateFile}.health.json`;
const launchdLabel = process.env.BRAIN_SYNC_LAUNCHD_LABEL || "com.jem.brain-sync";
const databaseUrl = process.env.BRAIN_REVISION_DATABASE_URL;
const maxSyncHealthAgeMs = Number(
  process.env.BRAIN_SYNC_HEALTH_MAX_AGE_MS || 2 * 60 * 1000
);

const checks = [];

function addCheck(name, status, details = {}) {
  checks.push({ name, status, details });
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

await Promise.all([
  checkHostedHealth(),
  checkPostgresSummary(),
  checkRecentActivity(),
  checkLocalState(),
  checkSyncLock(),
  checkSyncHealth(),
  checkLaunchd(),
  checkFlyStatus(),
]);

const failed = checks.filter((check) => check.status === "fail");
const warnings = checks.filter((check) => check.status === "warn");
const summary = {
  ok: failed.length === 0,
  status: failed.length ? "fail" : warnings.length ? "warn" : "pass",
  checkedAt: new Date().toISOString(),
  checks,
};

console.log(JSON.stringify(summary, null, 2));
if (failed.length > 0) process.exitCode = 1;
