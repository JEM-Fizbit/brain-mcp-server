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
