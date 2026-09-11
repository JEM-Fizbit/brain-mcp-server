const FLY_AUTH_UNAVAILABLE_PATTERN =
  /no access token available|please login with ['"]?flyctl auth login|not logged in|authentication required|access token[^\n]*(?:missing|expired|invalid)|(?:401|403)[^\n]*(?:unauthorized|forbidden)/i;

export const OPERATOR_ALARM_CHECKS = new Set([
  "hosted_health",
  "postgres_summary",
  "local_sync_state",
  "sync_lock",
  "sync_health",
  "sync_heartbeat",
  "lint_nudge",
  "lint_findings",
  "inbox",
  "launchd",
  "fly_status",
  "hosted_mcp_auth_failures",
  "user_operation_latency",
  "pooler_config",
]);

export function classifyLintFindings({
  issueCount = 0,
  automaticFixCount = 0,
  operatorDecisionCount = 0,
  diagnosticCount = 0,
} = {}) {
  const findings = Math.max(0, Number(issueCount) || 0);
  const automaticFixes = Math.max(0, Number(automaticFixCount) || 0);
  if (automaticFixes > 0) {
    return { status: "warn", state: "actionable_fixes" };
  }
  const operatorDecisions = Math.max(0, Number(operatorDecisionCount) || 0);
  if (operatorDecisions > 0) {
    return { status: "warn", state: "operator_decisions" };
  }
  const diagnostics = Math.max(0, Number(diagnosticCount) || 0);
  if (findings > 0 || diagnostics > 0) {
    return { status: "info", state: "maintainer_only" };
  }
  return { status: "pass", state: "clear" };
}

export function enforceOperatorAlarmContract(checks) {
  for (const check of checks) {
    if (!check || (check.status !== "warn" && check.status !== "fail")) continue;
    if (OPERATOR_ALARM_CHECKS.has(check.name)) continue;

    const originalStatus = check.status;
    check.status = "info";
    check.details = {
      ...check.details,
      state: "action_contract_missing",
      originalStatus,
      message:
        "This diagnostic is visible for context but was suppressed from operator alarms because no safe operator action is defined.",
    };
  }
  return checks;
}

// Watcher restarts reset cycle numbers. Count distinct timestamped source
// observations, never doctor polls. Keep the count when history rolls over.
export function evaluateSyncHealth(health, previous, { now = Date.now(), maxAgeMs } = {}) {
  const observedMs = Date.parse(health.checkedAt);
  const ageMs = Number.isFinite(observedMs) ? now - observedMs : null;
  const stale = ageMs === null || ageMs < 0 || ageMs > maxAgeMs;
  const error = health.status === "error";
  const previousMs = Date.parse(previous?.checkedAt);
  const previousCount = Number.isSafeInteger(previous?.failedObservations)
    ? Math.max(0, previous.failedObservations) : 0;
  const same = error && previous?.status === "error" &&
    Number.isFinite(observedMs) && observedMs === previousMs;
  const adjacent = error && previous?.status === "error" &&
    observedMs > previousMs && observedMs - previousMs <= maxAgeMs &&
    // A watch process exits at its first error; cycle > 1 proves a recovery
    // happened in that process even if the doctor missed the successful file.
    !(health.command === "watch" && health.cycle > 1);
  const failedObservations = error ? (same ? Math.max(1, previousCount)
    : adjacent ? previousCount + 1 : 1) : 0;
  const classification = error ? classifyPostgresError({
    message: health.error, code: health.errorCode,
  }) : null;
  const status = error
    ? classification.durable ? "fail"
      : !stale && failedObservations >= TRANSIENT_FAILURE_ESCALATION_CYCLES ? "fail" : "warn"
    : health.status === "ok" && !stale && !health.report?.guardTripped ? "pass" : "warn";
  return {
    status,
    details: {
      state: stale ? "stale" : health.status || "unknown",
      observedAt: health.checkedAt || null, ageMs, maxAgeMs,
      ...(classification ? {
        errorClass: classification.class, transient: !classification.durable,
        failedObservations,
      } : {}),
    },
    observation: { checkedAt: health.checkedAt || null, status: health.status || "unknown", failedObservations },
  };
}

export function syncHealthAction(sync) {
  if (!sync || (sync.status !== "warn" && sync.status !== "fail")) return null;
  const details = sync.details || {};
  if (details.guardTripped) return { level: "warn", reason: "sync_guard",
    title: "Review protected local sync state.", detail: String(details.guardTripped) };
  if (details.errorClass) return {
    level: sync.status,
    reason: sync.status === "fail" ? "sync_health_failed" : "sync_health_degraded",
    title: sync.status === "fail" ? "Restore local sync." : "Watch local sync recovery.",
    detail: [
      `Last sync error: ${details.errorClass}.`,
      details.observedAt ? `Observed ${details.observedAt}.` : "Observation time unavailable.",
      `${details.failedObservations || 1} distinct failed attempt(s) observed since the last observed recovery or gap.`,
      details.state === "stale" ? "This observation is stale; current sync health is unknown." : "",
      details.transient && sync.status === "warn"
        ? "Monitor supervises retry; check connectivity and the profile sync log if recovery does not follow."
        : "Inspect this profile's sync log and resolve the reported error, then restart its local stack in Brain Monitor.",
    ].filter(Boolean).join(" "),
  };
  return { level: sync.status, reason: "sync_health_stale",
    title: "Refresh stale or incomplete sync health.",
    detail: "Check the local supervisor and recent sync logs before relying on hosted state." };
}

function boundedText(value, maxLength = 240) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

export function flyCliErrorText(error) {
  return boundedText(error?.stderr || error?.message || error);
}

export function classifyFlyStatusError(error, app) {
  const errorText = flyCliErrorText(error);
  if (FLY_AUTH_UNAVAILABLE_PATTERN.test(errorText)) {
    return {
      status: "info",
      details: {
        app,
        state: "auth_required",
        optional: true,
        message:
          "Optional Fly control-plane check skipped because the local Fly CLI is not signed in. Hosted health and sync are checked separately.",
        resolution:
          "Optional: run `fly auth login`, then reload Brain Monitor to enable Machine and release diagnostics.",
      },
    };
  }

  if (error?.code === "ENOENT" || /(?:flyctl|fly): (?:command )?not found/i.test(errorText)) {
    return {
      status: "info",
      details: {
        app,
        state: "cli_unavailable",
        optional: true,
        message:
          "Optional Fly control-plane check skipped because flyctl is not installed or not available to Brain Monitor.",
        resolution:
          "Optional: install flyctl and reload Brain Monitor to enable Machine and release diagnostics.",
      },
    };
  }

  return {
    status: "warn",
    details: {
      app,
      state: "check_failed",
      error: errorText || "Fly status check failed without an error message.",
      resolution:
        `Run \`flyctl status --app ${app}\` in Terminal, resolve the reported control-plane or network error, then reload Brain Monitor.`,
    },
  };
}

export function classifyFlyStatusOutput(stdout, app) {
  const lines = String(stdout || "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.includes(app) || /started|passing|deployment-/.test(line))
    .slice(0, 8);
  const passing = /\b[1-9]\d* passing\b/.test(String(stdout || ""));
  return {
    status: passing ? "pass" : "warn",
    details: {
      app,
      state: passing ? "healthy" : "no_passing_machines",
      summary: lines,
      ...(passing
        ? {}
        : {
            resolution:
              `Open the Fly dashboard or run \`flyctl status --app ${app}\`; restore a passing Machine or roll back the faulty release, then reload Brain Monitor.`,
          }),
    },
  };
}

// --- Spec 019 phase 1: Postgres error classification and transient tolerance ---

/**
 * Postgres failure classes, worst-first. Durable classes name a fault an
 * operator must act on; transient classes describe a condition that commonly
 * self-heals — a laptop sleep/darkwake cycle, a resolver blip, a pooler
 * restart. Collapsing the two is why a `getaddrinfo ENOTFOUND` during a
 * darkwake once rendered as `fail / urgency now` while hosted MCP calls were
 * succeeding throughout (ers-brain, 2026-08-20).
 */
const POSTGRES_ERROR_CLASSES = [
  {
    class: "authentication",
    durable: true,
    test: (text, code) =>
      code === "28P01" ||
      code === "28000" ||
      /password authentication failed|no pg_hba\.conf entry|role .* does not exist|tenant or user not found/i.test(text),
    summary: "Postgres rejected the credentials.",
    resolution:
      "Verify the profile database URL, user and password, then reload Brain Monitor.",
  },
  {
    class: "permission",
    durable: true,
    test: (text, code) => code === "42501" || /permission denied/i.test(text),
    summary: "The database user lacks permission for the diagnostic query.",
    resolution:
      "Grant the Monitor role read access to the `brain` schema, then reload Brain Monitor.",
  },
  {
    class: "schema",
    durable: true,
    test: (text, code) =>
      code === "42P01" ||
      code === "3F000" ||
      /relation .* does not exist|schema .* does not exist|column .* does not exist/i.test(text),
    summary: "The expected Brain schema is missing or has drifted.",
    resolution:
      "Check that migrations have been applied to this project, then reload Brain Monitor.",
  },
  {
    class: "resolution",
    durable: false,
    test: (text, code) =>
      code === "ENOTFOUND" || code === "EAI_AGAIN" || /getaddrinfo/i.test(text),
    summary: "The database hostname did not resolve.",
    resolution:
      "Usually a transient local network or DNS condition, including a laptop sleep/wake cycle. Confirm connectivity if it persists across cycles.",
  },
  {
    class: "connectivity",
    durable: false,
    test: (text, code) =>
      code === "ECONNREFUSED" ||
      code === "ECONNRESET" ||
      code === "EHOSTUNREACH" ||
      code === "ENETUNREACH" ||
      code === "EPIPE" ||
      /connection terminated|connection refused|socket hang up/i.test(text),
    summary: "The database connection was refused or dropped.",
    resolution:
      "Usually transient. If it persists across cycles, check Supabase status and the pooler host and port.",
  },
  {
    class: "timeout",
    durable: false,
    test: (text, code) =>
      code === "ETIMEDOUT" ||
      /timeout exceeded when trying to connect|query read timeout|statement timeout|timed? ?out/i.test(text),
    summary: "The diagnostic query timed out.",
    resolution:
      "Usually transient load or a cold pooler connection. If it persists across cycles, check pooler saturation.",
  },
];

/**
 * Classify a Postgres error into a durable or transient class. Unknown errors
 * are treated as durable: an unrecognised fault should not be quietly softened.
 */
export function classifyPostgresError(error) {
  const text = String(error?.message || error || "").slice(0, 400);
  const code = String(error?.code || "");
  const matched = POSTGRES_ERROR_CLASSES.find((candidate) =>
    candidate.test(text, code)
  );
  if (!matched) {
    return {
      class: "unknown",
      durable: true,
      summary: "The Postgres summary query failed for an unrecognised reason.",
      resolution:
        "Verify the profile database URL and Supabase reachability, then reload Brain Monitor.",
      error: text,
      code: code || null,
    };
  }
  return {
    class: matched.class,
    durable: matched.durable,
    summary: matched.summary,
    resolution: matched.resolution,
    error: text,
    code: code || null,
  };
}

/**
 * Map a classified Postgres failure to a check status. Durable classes keep
 * `fail`. A transient class degrades to `warn` until it has recurred across
 * enough consecutive doctor cycles to stop being plausibly momentary — at
 * which point it is no longer transient in any useful sense and earns `fail`.
 */
export function postgresFailureStatus(classification, consecutiveFailures = 1) {
  if (classification.durable) return "fail";
  return consecutiveFailures >= TRANSIENT_FAILURE_ESCALATION_CYCLES ? "fail" : "warn";
}

export const TRANSIENT_FAILURE_ESCALATION_CYCLES = 3;

/**
 * Length of the current run of non-passing cycles for one check, walking back
 * from the newest entry. Stops at the first pass, so a check that recovered and
 * broke again reports the current streak rather than a lifetime total. Entries
 * that never recorded the check are skipped, not treated as a pass, so adding a
 * check does not reset the streaks of the ones beside it.
 */
export function consecutiveFailureStreak(entries, checkName) {
  const history = Array.isArray(entries) ? entries : [];
  let streak = 0;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const status = history[index]?.checks?.[checkName];
    if (status === "fail" || status === "warn") {
      streak += 1;
      continue;
    }
    if (status === undefined) continue;
    break;
  }
  return streak;
}

/**
 * Operator-facing detail for a failed Postgres check: what class of fault,
 * when it was seen, how long it has persisted, and how many retries it
 * survived — so a reader can tell a live incident from one that self-healed
 * without opening the raw snapshot.
 */
export function postgresFailureDetail(details = {}) {
  const parts = [details.summary || "The Postgres summary query failed."];
  if (details.error) parts.push(`Reported: ${String(details.error).slice(0, 160)}`);
  if (details.observedAt) parts.push(`Observed ${details.observedAt}`);
  if (Number(details.attempts) > 1) parts.push(`after ${details.attempts} attempts`);
  if (Number(details.consecutiveFailures) > 1) {
    parts.push(`${details.consecutiveFailures} consecutive cycles`);
  } else if (details.transient) {
    parts.push("first cycle — not yet treated as a durable fault");
  }
  if (details.resolution) parts.push(details.resolution);
  return parts.join(". ");
}
