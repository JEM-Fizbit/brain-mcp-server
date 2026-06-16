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
const launchdLabel = process.env.BRAIN_SYNC_LAUNCHD_LABEL || "com.jem.brain-sync";
const databaseUrl = process.env.BRAIN_REVISION_DATABASE_URL;

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
  checkLocalState(),
  checkSyncLock(),
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
