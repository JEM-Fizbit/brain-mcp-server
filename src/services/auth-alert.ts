// Hosted auth-failure alerting.
//
// When the hosted server records a `hosted_mcp_auth` failure it evaluates,
// best-effort and non-blocking, whether to post a Slack alert. The decision
// logic is pure and shared with the cockpit doctor's auth-failure check, so the
// cockpit verdict and the Slack alert always agree.
//
// Severity: warn at >= warnThreshold failures in the window, fail at
// >= failThreshold. Routing: warn -> #claude-ops, fail -> operator DM. A
// per-severity cooldown throttles a persistent condition while letting a
// worsening warn -> fail escalate immediately.
//
// Sanitization: alerts and dispatch rows carry only reason codes, HTTP status,
// and counts — never tokens, headers, bodies, SQL, or payloads.

import pg from "pg";
import { postSlackMessage } from "./slack.js";

const { Pool } = pg;

export type AuthAlertSeverity = "warn" | "fail";

export interface AuthAlertThresholds {
  windowMinutes: number;
  warnThreshold: number;
  failThreshold: number;
  cooldownMinutes: number;
}

export function severityForCount(
  count: number,
  thresholds: { warnThreshold: number; failThreshold: number }
): AuthAlertSeverity | null {
  if (count >= thresholds.failThreshold) return "fail";
  if (count >= thresholds.warnThreshold) return "warn";
  return null;
}

export interface AuthAlertDecisionInput {
  failureCount: number;
  warnThreshold: number;
  failThreshold: number;
  cooldownMinutes: number;
  lastWarnAt: Date | null;
  lastFailAt: Date | null;
  now: Date;
}

export type AuthAlertDecision =
  | { fire: false; reason: "below_threshold" | "cooldown" }
  | { fire: true; severity: AuthAlertSeverity };

export function decideAuthAlert(input: AuthAlertDecisionInput): AuthAlertDecision {
  const severity = severityForCount(input.failureCount, {
    warnThreshold: input.warnThreshold,
    failThreshold: input.failThreshold,
  });
  if (!severity) return { fire: false, reason: "below_threshold" };

  const cooldownMs = input.cooldownMinutes * 60 * 1000;
  const within = (at: Date | null): boolean =>
    at !== null && input.now.getTime() - at.getTime() < cooldownMs;

  if (severity === "fail") {
    // A fail only honors the cooldown against prior fails, so a worsening
    // warn -> fail escalation breaks through a recent warn.
    if (within(input.lastFailAt)) return { fire: false, reason: "cooldown" };
    return { fire: true, severity: "fail" };
  }

  // A warn is suppressed by any recent warn or fail.
  if (within(input.lastWarnAt) || within(input.lastFailAt)) {
    return { fire: false, reason: "cooldown" };
  }
  return { fire: true, severity: "warn" };
}

function intEnv(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 1 ? Math.floor(value) : fallback;
}

export function readAuthAlertThresholds(
  env: NodeJS.ProcessEnv = process.env
): AuthAlertThresholds {
  return {
    windowMinutes: intEnv(env, "BRAIN_AUTH_ALERT_WINDOW_MINUTES", 60),
    warnThreshold: intEnv(env, "BRAIN_AUTH_ALERT_WARN_THRESHOLD", 3),
    failThreshold: intEnv(env, "BRAIN_AUTH_ALERT_FAIL_THRESHOLD", 10),
    cooldownMinutes: intEnv(env, "BRAIN_AUTH_ALERT_COOLDOWN_MINUTES", 30),
  };
}

export function formatReasonSummary(
  reasons: Array<{ reason: string; n: number }>
): string {
  return (reasons || [])
    .filter((entry) => entry && entry.reason)
    .map((entry) => `${entry.reason} ×${entry.n}`)
    .join(", ");
}

export interface AuthAlertMessageInput {
  severity: AuthAlertSeverity;
  failureCount: number;
  windowMinutes: number;
  reasonSummary: string;
  httpStatus: string | null;
  isoDate: string;
  cockpitUrl: string;
}

export function buildAuthAlertMessage(input: AuthAlertMessageInput): string {
  const prefix =
    input.severity === "fail"
      ? "[brain-auth-alert] [Action needed]"
      : "[brain-auth-alert]";
  const icon = input.severity === "fail" ? "🚨" : "⚠️";
  const parts: string[] = [];
  if (input.reasonSummary) parts.push(input.reasonSummary);
  if (input.httpStatus) parts.push(`HTTP ${input.httpStatus}`);
  const paren = parts.length ? ` (${parts.join("; ")})` : "";
  return `${prefix} ${input.isoDate} — ${icon} ${input.failureCount} hosted MCP auth failures in last ${input.windowMinutes}m${paren}. Cockpit: ${input.cockpitUrl}`;
}

export interface AuthFailureState {
  failureCount: number;
  reasons: Array<{ reason: string; n: number }>;
  httpStatus: string | null;
  lastWarnAt: Date | null;
  lastFailAt: Date | null;
}

export interface AuthAlertConfig {
  enabled: boolean;
  botToken: string | null;
  channel: string;
  dm: string;
  thresholds: AuthAlertThresholds;
  brainId: string;
  cockpitUrl: string;
}

export function readAuthAlertConfig(env: NodeJS.ProcessEnv = process.env): AuthAlertConfig {
  const botToken =
    env.BRAIN_SLACK_BOT_TOKEN && env.BRAIN_SLACK_BOT_TOKEN.length > 0
      ? env.BRAIN_SLACK_BOT_TOKEN
      : null;
  return {
    enabled: Boolean(botToken) && env.BRAIN_AUTH_ALERT_ENABLED !== "0",
    botToken,
    channel: env.BRAIN_SLACK_ALERT_CHANNEL || "C0B27NK40H4",
    dm: env.BRAIN_SLACK_ALERT_DM || "U06SWS92Y5V",
    thresholds: readAuthAlertThresholds(env),
    brainId: env.BRAIN_ID || "ai-brain-jem",
    cockpitUrl: env.BRAIN_HOSTED_COCKPIT_URL || "http://127.0.0.1:8787/",
  };
}

export interface AuthAlertDispatchRow {
  severity: AuthAlertSeverity;
  count: number;
  windowMinutes: number;
  reasons: Array<{ reason: string; n: number }>;
  httpStatus: string | null;
  channel: string;
  ok: boolean;
}

export interface AuthAlertDeps {
  now(): Date;
  isoDate(): string;
  config: AuthAlertConfig;
  loadState(windowMinutes: number): Promise<AuthFailureState>;
  postMessage(channel: string, text: string): Promise<{ ok: boolean; error?: string }>;
  recordDispatch(row: AuthAlertDispatchRow): Promise<void>;
}

export interface AuthAlertOutcome {
  fired: boolean;
  severity?: AuthAlertSeverity;
  reason?: string;
  posted?: boolean;
}

let alertPoolCache: { key: string; pool: pg.Pool } | undefined;

function alertPool(connectionString: string): pg.Pool {
  if (alertPoolCache?.key === connectionString) return alertPoolCache.pool;
  alertPoolCache?.pool.end().catch(() => undefined);
  alertPoolCache = {
    key: connectionString,
    pool: new Pool({
      connectionString,
      allowExitOnIdle: true,
      connectionTimeoutMillis: 3000,
      max: 1,
      query_timeout: 5000,
      statement_timeout: 5000,
    }),
  };
  return alertPoolCache.pool;
}

export async function closeAuthAlertForTests(): Promise<void> {
  const pool = alertPoolCache?.pool;
  alertPoolCache = undefined;
  await pool?.end().catch(() => undefined);
}

async function defaultLoadState(
  config: AuthAlertConfig,
  windowMinutes: number
): Promise<AuthFailureState> {
  const empty: AuthFailureState = {
    failureCount: 0,
    reasons: [],
    httpStatus: null,
    lastWarnAt: null,
    lastFailAt: null,
  };
  const connectionString = process.env.BRAIN_REVISION_DATABASE_URL;
  if (!connectionString) return empty;

  const pool = alertPool(connectionString);
  const result = await pool.query(
    `
      with failures as (
        select metadata->>'error' as reason, metadata->>'httpStatus' as http_status
        from brain.sync_events
        where brain_id = $1
          and event_type = 'hosted_mcp_auth'
          and metadata->>'ok' = 'false'
          and created_at >= now() - make_interval(mins => $2::int)
      ),
      alerts as (
        select metadata->>'severity' as severity, max(created_at) as last_at
        from brain.sync_events
        where brain_id = $1
          and event_type = 'hosted_mcp_auth_alert'
          and metadata->>'ok' = 'true'
          and created_at >= now() - interval '1 day'
        group by 1
      )
      select
        (select count(*) from failures)::int as failure_count,
        (select coalesce(jsonb_agg(r), '[]'::jsonb) from (
            select reason, count(*)::int as n
            from failures
            where reason is not null
            group by reason
            order by count(*) desc
            limit 5
        ) r) as reasons,
        (select http_status from failures where http_status is not null
            group by http_status order by count(*) desc limit 1) as http_status,
        (select last_at from alerts where severity = 'warn') as last_warn_at,
        (select last_at from alerts where severity = 'fail') as last_fail_at
    `,
    [config.brainId, windowMinutes]
  );
  const row = result.rows[0] || {};
  const reasonsRaw = Array.isArray(row.reasons) ? row.reasons : [];
  return {
    failureCount: Number(row.failure_count || 0),
    reasons: reasonsRaw.map((entry: { reason: string; n: number }) => ({
      reason: String(entry.reason),
      n: Number(entry.n || 0),
    })),
    httpStatus: row.http_status ? String(row.http_status) : null,
    lastWarnAt: row.last_warn_at ? new Date(row.last_warn_at) : null,
    lastFailAt: row.last_fail_at ? new Date(row.last_fail_at) : null,
  };
}

async function defaultRecordDispatch(
  config: AuthAlertConfig,
  row: AuthAlertDispatchRow
): Promise<void> {
  const connectionString = process.env.BRAIN_REVISION_DATABASE_URL;
  if (!connectionString) return;
  const pool = alertPool(connectionString);
  const metadata = {
    version: 1,
    source: "hosted_mcp_server",
    kind: "auth_alert",
    severity: row.severity,
    count: row.count,
    window_minutes: row.windowMinutes,
    reasons: row.reasons,
    httpStatus: row.httpStatus,
    channel: row.channel,
    ok: row.ok,
  };
  await pool.query(
    `
      insert into brain.sync_events (
        brain_id, event_type, filename, duration_ms, metadata, created_at
      )
      values ($1, 'hosted_mcp_auth_alert', null, 0, $2::jsonb, now())
    `,
    [config.brainId, JSON.stringify(metadata)]
  );
}

function resolveDeps(deps?: Partial<AuthAlertDeps>): AuthAlertDeps {
  const config = deps?.config ?? readAuthAlertConfig();
  return {
    now: deps?.now ?? (() => new Date()),
    isoDate: deps?.isoDate ?? (() => new Date().toISOString().slice(0, 10)),
    config,
    loadState: deps?.loadState ?? ((windowMinutes) => defaultLoadState(config, windowMinutes)),
    postMessage:
      deps?.postMessage ??
      ((channel, text) =>
        postSlackMessage(channel, text, { token: config.botToken ?? undefined })),
    recordDispatch: deps?.recordDispatch ?? ((row) => defaultRecordDispatch(config, row)),
  };
}

export async function maybeAlertOnAuthFailure(
  deps?: Partial<AuthAlertDeps>
): Promise<AuthAlertOutcome> {
  const resolved = resolveDeps(deps);
  if (!resolved.config.enabled || !resolved.config.botToken) {
    return { fired: false, reason: "disabled" };
  }

  let state: AuthFailureState;
  try {
    state = await resolved.loadState(resolved.config.thresholds.windowMinutes);
  } catch {
    return { fired: false, reason: "state_error" };
  }

  const decision = decideAuthAlert({
    failureCount: state.failureCount,
    warnThreshold: resolved.config.thresholds.warnThreshold,
    failThreshold: resolved.config.thresholds.failThreshold,
    cooldownMinutes: resolved.config.thresholds.cooldownMinutes,
    lastWarnAt: state.lastWarnAt,
    lastFailAt: state.lastFailAt,
    now: resolved.now(),
  });
  if (!decision.fire) return { fired: false, reason: decision.reason };

  const severity = decision.severity;
  const channel = severity === "fail" ? resolved.config.dm : resolved.config.channel;
  const text = buildAuthAlertMessage({
    severity,
    failureCount: state.failureCount,
    windowMinutes: resolved.config.thresholds.windowMinutes,
    reasonSummary: formatReasonSummary(state.reasons),
    httpStatus: state.httpStatus,
    isoDate: resolved.isoDate(),
    cockpitUrl: resolved.config.cockpitUrl,
  });

  let posted = false;
  try {
    const result = await resolved.postMessage(channel, text);
    posted = result.ok;
  } catch {
    posted = false;
  }

  // Record the dispatch best-effort. The cooldown query only considers ok:true
  // rows, so a failed post does not start a cooldown and the next failure retries.
  try {
    await resolved.recordDispatch({
      severity,
      count: state.failureCount,
      windowMinutes: resolved.config.thresholds.windowMinutes,
      reasons: state.reasons,
      httpStatus: state.httpStatus,
      channel,
      ok: posted,
    });
  } catch {
    // best-effort
  }

  return { fired: true, severity, posted };
}
