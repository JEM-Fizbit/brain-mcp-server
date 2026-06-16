import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { loadLocalEnv } from "./lib/load-local-env.mjs";

loadLocalEnv();

const exec = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..");
const args = new Set(process.argv.slice(2));
const readOnly = args.has("--read-only");
const skipConflict = args.has("--skip-conflict") || readOnly;

const steps = [];

function formatDuration(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value)) return "-";
  if (value < 1000) return `${Math.round(value)}ms`;
  return `${(value / 1000).toFixed(value < 10000 ? 1 : 0)}s`;
}

function localDateTime(iso) {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

function checkByName(doctor, name) {
  return doctor?.checks?.find((check) => check.name === name);
}

function selectedLines(output) {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) =>
      /PASS|FAIL|Reused cached|Hosted write|Hosted sync|Local sync|Conflict lifecycle|latency snapshot|Falling back|Complete the browser login/.test(line)
    );
}

async function runNodeStep(label, script, scriptArgs = [], options = {}) {
  const startedAt = Date.now();
  console.log(`\n== ${label}`);
  try {
    const result = await exec(process.execPath, [path.join(repoRoot, script), ...scriptArgs], {
      cwd: repoRoot,
      env: process.env,
      timeout: options.timeoutMs || 5 * 60 * 1000,
      maxBuffer: 1024 * 1024 * 8,
    });
    const durationMs = Date.now() - startedAt;
    const step = {
      label,
      status: "pass",
      durationMs,
      stdout: result.stdout,
      stderr: result.stderr,
    };
    steps.push(step);
    console.log(`OK ${label} (${formatDuration(durationMs)})`);
    for (const line of selectedLines(result.stdout)) {
      console.log(`   ${line}`);
    }
    return step;
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const step = {
      label,
      status: "fail",
      durationMs,
      stdout: error.stdout || "",
      stderr: error.stderr || "",
      error: error.message,
    };
    steps.push(step);
    console.log(`FAIL ${label} (${formatDuration(durationMs)})`);
    for (const line of selectedLines(step.stdout)) {
      console.log(`   ${line}`);
    }
    const failureText = `${step.stderr || ""}\n${step.error || ""}`.trim();
    if (failureText) console.log(`   ${failureText.split("\n").slice(0, 8).join("\n   ")}`);
    return step;
  }
}

function parseDoctorStep(step) {
  if (!step?.stdout) return null;
  try {
    return JSON.parse(step.stdout);
  } catch {
    return null;
  }
}

function buildSmokeArgs() {
  if (readOnly) return [];
  const smokeArgs = ["--write", "--verify-local", "--local-write", "--verify-hosted"];
  if (!skipConflict) smokeArgs.push("--conflict");
  return smokeArgs;
}

function summariseDoctor(label, doctor) {
  if (!doctor) {
    console.log(`- ${label}: unavailable`);
    return;
  }
  const postgres = checkByName(doctor, "postgres_summary")?.details || {};
  const sync = checkByName(doctor, "sync_health")?.details || {};
  const userLatency = checkByName(doctor, "user_operation_latency")?.details || {};
  console.log(`- ${label}: ${doctor.status} (${formatDuration(doctor.latencyMs)})`);
  console.log(`  Hosted files: ${postgres.hostedFiles ?? "-"}; open conflicts: ${postgres.openConflicts ?? "-"}`);
  console.log(`  Sync: cycle ${sync.cycle ?? "-"}, pushed ${sync.pushed ?? "-"}, pulled ${sync.pulled ?? "-"}, conflicts ${sync.conflicts ?? "-"}`);
  console.log(
    `  User-facing latency: read ${formatDuration(userLatency.latestReadLatencyMs)}, write ${formatDuration(userLatency.latestWriteLatencyMs)}, sync wait ${formatDuration(userLatency.latestSyncWaitLatencyMs)}`
  );
  if (postgres.latestHostedUpdate) {
    console.log(`  Latest hosted update: ${localDateTime(postgres.latestHostedUpdate)}`);
  }
}

function nextActions(finalDoctor, failedSteps) {
  const actions = [];
  const postgres = checkByName(finalDoctor, "postgres_summary")?.details || {};
  const sync = checkByName(finalDoctor, "sync_health");
  const launchd = checkByName(finalDoctor, "launchd");

  if (failedSteps.length > 0) {
    actions.push("Inspect the failed step output above before using hosted Brain as the normal path.");
  }
  if ((postgres.openConflicts || 0) > 0) {
    actions.push("Resolve open conflicts with docs/conflict-resolution.md and brain_resolve_conflict.");
  }
  if (sync?.status === "warn") {
    actions.push("Sync health is stale or incomplete; check the local sync daemon and rerun hosted:test-drive.");
  }
  if (sync?.status === "fail") {
    actions.push("Sync health failed; run npm run sync -- summary and inspect the reported error.");
  }
  if (launchd?.status === "warn") {
    actions.push("Launchd is not confidently running; restart the local sync agent before cutover.");
  }
  if (actions.length === 0) {
    actions.push("No operator action required. Hosted Brain is ready for a real client rehearsal.");
  }
  return actions;
}

async function main() {
  console.log("Hosted Brain Test Drive");
  console.log(`Mode: ${readOnly ? "read-only" : skipConflict ? "write parity, conflict skipped" : "full parity and conflict lifecycle"}`);

  const preflight = await runNodeStep("Preflight hosted doctor", "scripts/hosted-doctor.mjs", [], {
    timeoutMs: 60 * 1000,
  });
  const preflightDoctor = parseDoctorStep(preflight);

  if (preflight.status === "fail" || preflightDoctor?.status === "fail") {
    console.log("\nPreflight failed; skipping hosted MCP mutation smoke.");
  } else {
    await runNodeStep("Hosted MCP client smoke", "scripts/smoke-hosted-oauth.mjs", buildSmokeArgs());
  }

  const final = await runNodeStep("Final hosted doctor", "scripts/hosted-doctor.mjs", [], {
    timeoutMs: 60 * 1000,
  });
  const finalDoctor = parseDoctorStep(final);
  const failedSteps = steps.filter((step) => step.status === "fail");
  const warnings = finalDoctor?.checks?.filter((check) => check.status === "warn") || [];
  const finalStatus =
    failedSteps.length || finalDoctor?.status === "fail"
      ? "FAIL"
      : warnings.length || finalDoctor?.status === "warn"
        ? "WARN"
        : "PASS";

  console.log("\n== Summary");
  summariseDoctor("Preflight", preflightDoctor);
  summariseDoctor("Final", finalDoctor);

  console.log("\n== Result");
  console.log(`${finalStatus}: Hosted Brain test drive completed in ${formatDuration(steps.reduce((total, step) => total + step.durationMs, 0))}.`);

  console.log("\n== Next Action");
  for (const action of nextActions(finalDoctor, failedSteps)) {
    console.log(`- ${action}`);
  }

  if (finalStatus === "FAIL") process.exitCode = 1;
}

main().catch((error) => {
  console.error(`FAIL Hosted Brain test drive crashed: ${error.message}`);
  process.exitCode = 1;
});
