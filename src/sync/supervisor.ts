import fs from "node:fs/promises";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { pathToFileURL } from "node:url";

export interface SupervisorOptions {
  brainId: string;
  healthFile: string;
  lockFile: string;
  worker: string[];
  tickMs?: number;
  deadlineMs?: number;
  stopGraceMs?: number;
  wakeGraceMs?: number;
  stableMs?: number;
  retryDelays?: number[];
}

// Exposed for deterministic sleep/wake tests. Large scheduling gaps grant one
// grace window; old worker health is never promoted to a new observation.
export function wakeGraceUntil(lastTick: number, now: number, tickMs: number, graceMs: number, current: number) {
  return now - lastTick > Math.max(30_000, tickMs * 5) || now < lastTick
    ? Math.max(current, now + graceMs) : current;
}

export async function runSupervisor(o: SupervisorOptions): Promise<void> {
  const tickMs = o.tickMs ?? 1_000;
  const deadlineMs = o.deadlineMs ?? 330_000;
  const stopGraceMs = o.stopGraceMs ?? 10_000;
  const wakeGraceMs = o.wakeGraceMs ?? 120_000;
  const stableMs = o.stableMs ?? 60_000;
  const retryDelays = o.retryDelays ?? [3_000, 15_000, 60_000];
  const output = `${o.healthFile}.supervision.json`;
  const read = async (file: string): Promise<any> => {
    try { return JSON.parse(await fs.readFile(file, "utf8")); } catch { return null; }
  };
  const prior = await read(output);
  let attempts = prior?.brainId === o.brainId ? Math.min(retryDelays.length, Number(prior.attempts) || 0) : 0;
  let state = prior?.brainId === o.brainId && prior.state === "needs_attention" ? "needs_attention" : "starting";
  let attentionId: string | null = state === "needs_attention" ? prior.attentionId : null;
  let reason = state === "needs_attention" ? prior.reason : "startup";
  let child: ChildProcess | null = null;
  let startedAt = 0, lastCompletion = 0, lastTick = Date.now(), graceUntil = 0, nextStart = Date.now();
  let stableSince = 0, stopAt = 0, shuttingDown = false, ticking = false;
  let lastStage: string | null = null, lastSuccessAt: string | null = prior?.lastSuccessAt ?? null;
  const history: any[] = prior?.brainId === o.brainId && Array.isArray(prior.history) ? prior.history.slice(-29) : [];
  let writing = false;
  const event = (kind: string) => {
    history.push({ at: new Date().toISOString(), kind, attempt: attempts, stage: lastStage });
    if (history.length > 30) history.shift();
  };
  const publish = async () => {
    if (writing) return;
    writing = true;
    try {
      await fs.mkdir(path.dirname(output), { recursive: true });
      const value = { version: 1, brainId: o.brainId, supervisorPid: process.pid,
        workerPid: child?.pid ?? null, checkedAt: new Date().toISOString(), state, reason,
        attempts, maxRestarts: retryDelays.length, attentionId, lastStage, lastSuccessAt,
        nextRetryAt: state === "backoff" ? new Date(nextStart).toISOString() : null, history };
      const tmp = `${output}.${process.pid}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
      await fs.rename(tmp, output);
    } catch { /* Diagnostics must never block stopping a stuck worker. */ }
    finally { writing = false; }
  };
  const needsAttention = (why: string) => {
    state = "needs_attention"; reason = why;
    attentionId = `${process.pid}-${Date.now()}`;
    event("needs_attention"); void publish();
  };
  const failed = (why: string) => {
    stableSince = 0;
    if (attempts >= retryDelays.length) return needsAttention(why);
    const delay = retryDelays[attempts++];
    nextStart = Date.now() + delay;
    state = "backoff"; reason = why; event("retry_scheduled"); void publish();
  };
  const alive = (pid: number) => {
    try { process.kill(pid, 0); return true; } catch (e: any) { return e.code !== "ESRCH"; }
  };
  const start = async () => {
    // Never displace or adopt an unknown lock owner (including an orphan).
    const lock = await read(o.lockFile);
    if (Number.isInteger(lock?.pid) && lock.pid > 0 && alive(lock.pid)) {
      needsAttention("existing_worker"); return;
    }
    if (shuttingDown) return;
    startedAt = lastCompletion = Date.now(); stableSince = 0; lastStage = "sync.starting";
    state = "starting"; reason = "awaiting_progress";
    const worker = spawn(process.execPath, o.worker, { stdio: "inherit", env: process.env });
    child = worker;
    event("worker_started");
    worker.once("error", () => { reason = "launch_failed"; });
    worker.once("close", (code, signal) => {
      if (child !== worker) return;
      child = null;
      event("worker_exited");
      if (shuttingDown) return;
      failed(state === "stopping" ? reason : signal ? "worker_signal" : code === 0 ? "unexpected_exit" : "worker_error");
    });
    void publish();
  };
  const stop = (why: string) => {
    if (!child || state === "stopping") return;
    state = "stopping"; reason = why; stopAt = Date.now();
    event("stop_requested"); child.kill("SIGTERM"); void publish();
  };
  const onWake = () => { graceUntil = Date.now() + wakeGraceMs; stableSince = 0; event("wake_grace"); };
  const onRetry = () => {
    if (state !== "needs_attention") return;
    attempts = 0; attentionId = null; state = "backoff"; nextStart = Date.now();
    reason = "operator_retry"; event("operator_retry"); void publish();
  };
  const shutdown = () => { shuttingDown = true; if (child) stop("supervisor_shutdown"); };
  process.on("SIGTERM", shutdown); process.on("SIGINT", shutdown);
  process.on("SIGUSR1", onRetry); process.on("SIGUSR2", onWake);
  // Enforcement precedes asynchronous disk reads so a stalled observation write
  // or read cannot disable the independent deadline or forced termination.
  const tick = () => {
    const now = Date.now();
    graceUntil = wakeGraceUntil(lastTick, now, tickMs, wakeGraceMs, graceUntil); lastTick = now;
    if (child && state === "stopping" && now - stopAt >= stopGraceMs) {
      child.kill("SIGKILL"); // The close event, not this signal, permits replacement.
    } else if (child && now >= graceUntil && now - lastCompletion >= deadlineMs) {
      stop("progress_timeout");
    }
    if (shuttingDown && !child) { finish(); return; }
    if (ticking) return;
    ticking = true;
    void (async () => {
      if (!shuttingDown && !child && state !== "needs_attention" && now >= nextStart) await start();
      const worker = child;
      if (worker && state !== "stopping") {
        const health = await read(o.healthFile);
        const progress = await read(`${o.healthFile}.progress.json`);
        if (child !== worker || state === "stopping") return;
        if (progress?.pid === worker.pid && /^[a-z_]+\.[a-z_]+$/.test(progress.stage || "")) lastStage = progress.stage;
        const completed = Date.parse(health?.checkedAt);
        if (health?.pid === worker.pid && health.brainId === o.brainId && completed >= startedAt && completed <= Date.now() &&
            ["ok", "warn"].includes(health.status)) {
          const advanced = completed > lastCompletion;
          if (advanced) lastCompletion = completed;
          lastSuccessAt = health.checkedAt;
          if (!stableSince) { stableSince = completed; event("progress_restored"); }
          if (advanced && completed - stableSince >= stableMs && Date.now() - completed < Math.min(deadlineMs, 120_000)) {
            if (attempts) event("recovered");
            attempts = 0;
          }
          state = "running"; reason = "progress_current";
        } else stableSince = 0;
      }
      await publish();
    })().finally(() => { ticking = false; });
  };
  let finish!: () => void;
  await new Promise<void>((resolve) => {
    const timer = setInterval(tick, tickMs);
    finish = () => { clearInterval(timer); resolve(); };
    tick();
  });
  process.off("SIGTERM", shutdown); process.off("SIGINT", shutdown);
  process.off("SIGUSR1", onRetry); process.off("SIGUSR2", onWake);
  if (state !== "needs_attention") { state = "stopped"; reason = "supervisor_shutdown"; }
  await publish();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const healthFile = process.env.BRAIN_SYNC_HEALTH_FILE;
  const stateFile = process.env.BRAIN_SYNC_STATE_FILE;
  const brainId = process.env.BRAIN_ID;
  if (!brainId || !healthFile || !stateFile || !process.argv[2]) throw new Error("Supervisor requires an explicit Brain profile and worker path");
  const cycleMs = Math.min(2_147_400_000, Math.max(1, Number(process.env.BRAIN_SYNC_CYCLE_TIMEOUT_MS) || 300_000));
  await runSupervisor({ brainId, healthFile, lockFile: process.env.BRAIN_SYNC_LOCK_FILE || `${stateFile}.lock`,
    worker: process.argv.slice(2), deadlineMs: cycleMs + 30_000 });
}
