// Hosted auth-failure alerting.
//
// When the hosted server records a `hosted_mcp_auth` failure it evaluates,
// best-effort and non-blocking, whether to post a Slack alert. The decision
// logic is pure and shared with the cockpit doctor's auth-failure check, so the
// cockpit verdict and the Slack alert always agree.
//
// Anonymous rejections remain information until the existing higher count
// threshold warrants channel security review. Credential counts independently
// warn/page. Persisted category state suppresses unchanged reminders while
// retaining new incidents, material growth and immediate credential escalation.
//
// Sanitization: alerts and dispatch rows carry only reason codes, HTTP status,
// and counts — never tokens, headers, bodies, SQL, or payloads.

import pg from "pg";
import { classifyAuthReasons } from "./auth-reason-policy.js";
import { postSlackMessage } from "./slack.js";
import { runtimeBrainId } from "./runtime-env.js";
import { attachPoolErrorLogger } from "./pg-pool.js";

const { Pool } = pg;

export type AuthAlertSeverity = "warn" | "fail";

export interface AuthAlertThresholds {
  windowMinutes: number;
  warnThreshold: number;
  failThreshold: number;
  cooldownMinutes: number;
  staleGraceMinutes: number;
}

export function severityForCount(
  count: number,
  thresholds: { warnThreshold: number; failThreshold: number }
): AuthAlertSeverity | null {
  if (count >= thresholds.failThreshold) return "fail";
  if (count >= thresholds.warnThreshold) return "warn";
  return null;
}

// Conservative stale-connector test, shared in spirit with the cockpit summary's
// connectorState (scripts/lib/latency-summary.mjs, spec 005). Both must encode
// the same rule so the doctor verdict and the Slack alert agree. Returns true
// only when a SINGLE unregistered client id has been looping unknown_client_id
// on a refresh-token grant past the grace window; any ambiguity returns false
// (full severity).
export function computeStaleConnector(input: {
  failingClientIds: string[];
  allUnknownClientRefresh: boolean;
  registeredClientIds: string[] | null;
  firstFailureAt: Date | null;
  lastFailureAt: Date | null;
  now: Date;
  graceMinutes: number;
}): boolean {
  if (!input.registeredClientIds) return false; // unknown registered set -> conservative
  if (!input.allUnknownClientRefresh) return false;
  const ids = input.failingClientIds.filter(Boolean);
  if (ids.length !== 1) return false; // single client only
  if (new Set(input.registeredClientIds).has(ids[0])) return false; // must be unregistered
  if (!input.firstFailureAt || !input.lastFailureAt) return false;
  const graceMs = Math.max(1, input.graceMinutes) * 60 * 1000;
  const spanMs = input.lastFailureAt.getTime() - input.firstFailureAt.getTime();
  const firstAgeMs = input.now.getTime() - input.firstFailureAt.getTime();
  return Math.max(spanMs, 0) >= graceMs || firstAgeMs >= graceMs;
}

export interface AuthAlertDecisionInput {
  failureCount: number;
  warnThreshold: number;
  failThreshold: number;
  cooldownMinutes: number;
  lastWarnAt: Date | null;
  lastFailAt: Date | null;
  now: Date;
  // When true, a benign stale-connector loop (an unrecognized client id retrying
  // a refresh-token grant) is capped at `warn` so it never pages the operator DM.
  staleConnector?: boolean;
}

export type AuthAlertDecision =
  | { fire: false; reason: "below_threshold" | "cooldown" }
  | { fire: true; severity: AuthAlertSeverity };

export function decideAuthAlert(input: AuthAlertDecisionInput): AuthAlertDecision {
  const raw = severityForCount(input.failureCount, {
    warnThreshold: input.warnThreshold,
    failThreshold: input.failThreshold,
  });
  if (!raw) return { fire: false, reason: "below_threshold" };
  // Stale-connector downgrade: never page `fail` for a benign loop. This mirrors
  // the doctor's effectiveStatus rule (spec 005) so the cockpit verdict and the
  // Slack alert agree. Criteria are computed in computeStaleConnector below.
  const severity: AuthAlertSeverity =
    input.staleConnector && raw === "fail" ? "warn" : raw;

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
    // Shares the doctor's grace knob so both sides classify identically.
    staleGraceMinutes: intEnv(env, "BRAIN_HOSTED_MCP_AUTH_STALE_GRACE_MINUTES", 10),
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
  brainId?: string;
  category?: "anonymous" | "credentials";
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
  const label = input.category === "anonymous" ? "anonymous requests rejected" : "credential/authentication rejections";
  const guidance = input.category === "anonymous"
    ? "Authentication was enforced; caller origin is unknown. Review unusual anonymous activity; this does not demonstrate a broken connector."
    : "Inspect the recorded reasons and affected client; reconnect only when authenticated calls fail.";
  return `${prefix} [${input.brainId || "unobserved-brain"}] ${input.isoDate} — ${icon} ${input.failureCount} ${label} in last ${input.windowMinutes}m${paren}. ${guidance} Cockpit: ${input.cockpitUrl}`;
}

export interface AuthFailureState {
  failureCount: number;
  reasons: Array<{ reason: string; n: number }>;
  httpStatus: string | null;
  lastWarnAt: Date | null;
  lastFailAt: Date | null;
  staleConnector: boolean;
  firstFailureAt?: Date | null;
  lastFailureAt?: Date | null;
  categoryTimes?: Record<"anonymous" | "credentials", { first: Date | null; last: Date | null; episodeStartedAt?: Date | null }>;
  recentDispatches?: AuthAlertPreviousDispatch[];
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
  const channel = env.BRAIN_SLACK_ALERT_CHANNEL?.trim() || "";
  const dm = env.BRAIN_SLACK_ALERT_DM?.trim() || "";
  return {
    enabled:
      Boolean(botToken) &&
      Boolean(channel) &&
      Boolean(dm) &&
      env.BRAIN_AUTH_ALERT_ENABLED !== "0",
    botToken,
    channel,
    dm,
    thresholds: readAuthAlertThresholds(env),
    brainId: runtimeBrainId(env),
    cockpitUrl: env.BRAIN_HOSTED_COCKPIT_URL || "http://127.0.0.1:8787/",
  };
}

export interface AuthAlertPreviousDispatch {
  at: Date;
  severity: AuthAlertSeverity;
  count: number;
  category: "anonymous" | "credentials";
  lastFailureAt: Date | null;
  reasonCodes?: string;
}

export function shouldRepeatAuthAlert(input: {
  previous?: AuthAlertPreviousDispatch;
  severity: AuthAlertSeverity;
  count: number;
  firstFailureAt: Date | null;
  lastFailureAt: Date | null;
  now: Date;
  windowMinutes: number;
  cooldownMinutes: number;
  reasonCodes?: string;
  episodeStartedAt?: Date | null;
}): boolean {
  const p = input.previous;
  if (!p) return true;
  const priorEvent = p.lastFailureAt || p.at;
  const newEpisode = input.episodeStartedAt && input.episodeStartedAt.getTime() > priorEvent.getTime();
  if (input.severity === "fail" && p.severity === "warn") return true;
  if (!newEpisode && p.severity === "fail" && input.severity === "warn") return false;
  const changedReasons = Boolean(input.reasonCodes && p.reasonCodes && input.reasonCodes !== p.reasonCodes);
  const cooled = input.now.getTime() - p.at.getTime() >= input.cooldownMinutes * 60000;
  const newEvent = input.lastFailureAt && input.lastFailureAt.getTime() > priorEvent.getTime();
  // No unchanged rolling-window reminders. Continued activity must at least
  // double the prior notified count and contain a newly observed event.
  return Boolean(cooled && newEvent && (newEpisode || changedReasons || input.count >= Math.max(1, p.count) * 2));
}

export interface AuthAlertDispatchRow {
  severity: AuthAlertSeverity;
  count: number;
  windowMinutes: number;
  reasons: Array<{ reason: string; n: number }>;
  httpStatus: string | null;
  channel: string;
  ok: boolean;
  category?: "anonymous" | "credentials";
  lastFailureAt?: Date | null;
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
    pool: attachPoolErrorLogger(
      new Pool({
        connectionString,
        allowExitOnIdle: true,
        connectionTimeoutMillis: 3000,
        max: 1,
        query_timeout: 5000,
        statement_timeout: 5000,
      }),
      "auth_alert"
    ),
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
    staleConnector: false,
  };
  const connectionString = process.env.BRAIN_REVISION_DATABASE_URL;
  if (!connectionString) return empty;

  const pool = alertPool(connectionString);
  const result = await pool.query(
    `
      with failures as (
        select
          metadata->>'error' as reason,
          metadata->>'httpStatus' as http_status,
          metadata->>'clientId' as client_id,
          metadata->>'grantType' as grant_type,
          created_at
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
      ), activity as (
        select created_at, case when metadata->>'error' = 'missing_bearer' then 'anonymous' else 'credentials' end as category
        from brain.sync_events where brain_id = $1 and event_type = 'hosted_mcp_auth'
          and metadata->>'ok' = 'false' and created_at >= now() - make_interval(mins => ($2::int * 2))
        union all
        select max(created_at), case when metadata->>'error' = 'missing_bearer' then 'anonymous' else 'credentials' end
        from brain.sync_events where brain_id = $1 and event_type = 'hosted_mcp_auth'
          and metadata->>'ok' = 'false' and created_at < now() - make_interval(mins => ($2::int * 2))
        group by 2
      ), gaps as (
        select category, created_at, lag(created_at) over (partition by category order by created_at) as previous_at
        from activity where created_at is not null
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
        (select coalesce(jsonb_agg(distinct client_id), '[]'::jsonb)
            from failures where client_id is not null) as failing_client_ids,
        (select coalesce(bool_and(reason = 'unknown_client_id' and grant_type = 'refresh_token'), false)
            from failures) as all_unknown_refresh,
        (select min(created_at) from failures) as first_failure_at,
        (select max(created_at) from failures) as last_failure_at,
        (select min(created_at) from failures where reason = 'missing_bearer') as anonymous_first_at,
        (select max(created_at) from failures where reason = 'missing_bearer') as anonymous_last_at,
        (select min(created_at) from failures where reason is distinct from 'missing_bearer') as credentials_first_at,
        (select max(created_at) from failures where reason is distinct from 'missing_bearer') as credentials_last_at,
        (select max(created_at) from gaps where category = 'anonymous' and created_at - previous_at > make_interval(mins => $2::int)) as anonymous_episode_at,
        (select max(created_at) from gaps where category = 'credentials' and created_at - previous_at > make_interval(mins => $2::int)) as credentials_episode_at,
        (select coalesce(jsonb_agg(state_key), '[]'::jsonb)
            from brain.oauth_state where store = 'clients') as registered_client_ids,
        (select last_at from alerts where severity = 'warn') as last_warn_at,
        (select last_at from alerts where severity = 'fail') as last_fail_at,
        (select coalesce(jsonb_agg(a order by created_at desc), '[]'::jsonb) from (
          select created_at, metadata from brain.sync_events
          where brain_id = $1 and event_type = 'hosted_mcp_auth_alert'
            and metadata->>'ok' = 'true'
          order by created_at desc limit 100
        ) a) as recent_dispatches
    `,
    [config.brainId, windowMinutes]
  );
  const row = result.rows[0] || {};
  const reasonsRaw = Array.isArray(row.reasons) ? row.reasons : [];
  const staleConnector = computeStaleConnector({
    failingClientIds: Array.isArray(row.failing_client_ids)
      ? row.failing_client_ids.map(String)
      : [],
    allUnknownClientRefresh: row.all_unknown_refresh === true,
    registeredClientIds: Array.isArray(row.registered_client_ids)
      ? row.registered_client_ids.map(String)
      : null,
    firstFailureAt: row.first_failure_at ? new Date(row.first_failure_at) : null,
    lastFailureAt: row.last_failure_at ? new Date(row.last_failure_at) : null,
    now: new Date(),
    graceMinutes: config.thresholds.staleGraceMinutes,
  });
  return {
    failureCount: Number(row.failure_count || 0),
    reasons: reasonsRaw.map((entry: { reason: string; n: number }) => ({
      reason: String(entry.reason),
      n: Number(entry.n || 0),
    })),
    httpStatus: row.http_status ? String(row.http_status) : null,
    lastWarnAt: row.last_warn_at ? new Date(row.last_warn_at) : null,
    lastFailAt: row.last_fail_at ? new Date(row.last_fail_at) : null,
    staleConnector,
    firstFailureAt: row.first_failure_at ? new Date(row.first_failure_at) : null,
    lastFailureAt: row.last_failure_at ? new Date(row.last_failure_at) : null,
    categoryTimes: {
      anonymous: { episodeStartedAt: row.anonymous_episode_at ? new Date(row.anonymous_episode_at) : null, first: row.anonymous_first_at ? new Date(row.anonymous_first_at) : null, last: row.anonymous_last_at ? new Date(row.anonymous_last_at) : null },
      credentials: { episodeStartedAt: row.credentials_episode_at ? new Date(row.credentials_episode_at) : null, first: row.credentials_first_at ? new Date(row.credentials_first_at) : null, last: row.credentials_last_at ? new Date(row.credentials_last_at) : null },
    },
    recentDispatches: (Array.isArray(row.recent_dispatches) ? row.recent_dispatches : []).map((a: { created_at: string; metadata: Record<string, unknown> }) => {
      const m = a.metadata;
      const count = Number(m.count || 0);
      const reasons = Array.isArray(m.reasons) ? m.reasons : [];
      const legacyAnonymous = reasons.length === 1 && reasons[0].reason === "missing_bearer" && Number(reasons[0].n) === count;
      const category = m.category === "anonymous" || (!m.category && legacyAnonymous) ? "anonymous" : "credentials";
      return { at: new Date(a.created_at), severity: category === "anonymous" ? "warn" : m.severity as AuthAlertSeverity,
        count, category, reasonCodes: reasons.map(r => String(r.reason)).sort().join(","), lastFailureAt: m.lastFailureAt ? new Date(String(m.lastFailureAt)) : null };
    }),
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
    version: 2,
    source: "hosted_mcp_server",
    kind: "auth_alert",
    category: row.category,
    lastFailureAt: row.lastFailureAt?.toISOString() || null,
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

// Auth failures arrive concurrently and each fires a fire-and-forget alert
// evaluation, so the cooldown's read-then-write is a race: without
// serialization, every evaluation in a burst reads "no recent alert" before any
// of them records a dispatch, and they all post. This in-process mutex
// serializes evaluations so each sees the prior dispatch before deciding. The
// hosted server runs a single machine; the DB cooldown query still throttles
// across restarts (and, coarsely, across machines if ever scaled).
let alertLock: Promise<unknown> = Promise.resolve();

function withAlertLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = alertLock.then(fn, fn);
  alertLock = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

export async function maybeAlertOnAuthFailure(
  deps?: Partial<AuthAlertDeps>
): Promise<AuthAlertOutcome> {
  const resolved = resolveDeps(deps);
  if (!resolved.config.enabled || !resolved.config.botToken) {
    return { fired: false, reason: "disabled" };
  }
  return withAlertLock(() => evaluateAndAlert(resolved));
}

async function evaluateAndAlert(resolved: AuthAlertDeps): Promise<AuthAlertOutcome> {
  let state: AuthFailureState;
  try {
    state = await resolved.loadState(resolved.config.thresholds.windowMinutes);
  } catch {
    return { fired: false, reason: "state_error" };
  }

  const classification = classifyAuthReasons({ ...resolved.config.thresholds,
    failureCount: state.failureCount, reasons: state.reasons, staleConnector: state.staleConnector });
  // Credential failures take precedence; anonymous traffic cannot raise their
  // severity or consume their independent notification cooldown.
  const category = classification.credentialStatus === "warn" || classification.credentialStatus === "fail"
    ? "credentials" : "anonymous";
  const status = category === "credentials" ? classification.credentialStatus : classification.anonymousStatus;
  if (status !== "warn" && status !== "fail") return { fired: false, reason: "below_threshold" };
  const severity: AuthAlertSeverity = status;
  const count = category === "credentials" ? classification.credentialCount : classification.anonymousCount;
  const reasons = state.reasons.filter(r => category === "anonymous" ? r.reason === "missing_bearer" : r.reason !== "missing_bearer");
  const previous = state.recentDispatches?.find(d => d.category === category);
  const times = state.categoryTimes?.[category] || { first: state.firstFailureAt || null, last: state.lastFailureAt || null };
  const reasonCodes = reasons.map(r => r.reason).sort().join(",");
  if (state.recentDispatches) {
    if (!shouldRepeatAuthAlert({ previous, severity, count,
      firstFailureAt: times.first, lastFailureAt: times.last, reasonCodes,
      episodeStartedAt: state.categoryTimes?.[category].episodeStartedAt,
      now: resolved.now(), ...resolved.config.thresholds })) return { fired: false, reason: "unchanged_incident" };
  } else {
    // Injected/legacy state fallback retains existing cooldown behavior.
    const decision = decideAuthAlert({ failureCount: count, ...resolved.config.thresholds,
      warnThreshold: category === "anonymous" ? resolved.config.thresholds.failThreshold : resolved.config.thresholds.warnThreshold,
      failThreshold: category === "anonymous" ? Number.MAX_SAFE_INTEGER : resolved.config.thresholds.failThreshold,
      lastWarnAt: state.lastWarnAt, lastFailAt: state.lastFailAt, now: resolved.now(), staleConnector: state.staleConnector });
    if (!decision.fire) return { fired: false, reason: decision.reason };
  }
  const channel = severity === "fail" ? resolved.config.dm : resolved.config.channel;
  const text = buildAuthAlertMessage({ severity, category, brainId: resolved.config.brainId,
    failureCount: count, windowMinutes: resolved.config.thresholds.windowMinutes,
    reasonSummary: formatReasonSummary(reasons), httpStatus: state.httpStatus,
    isoDate: resolved.isoDate(), cockpitUrl: resolved.config.cockpitUrl });

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
      count,
      category,
      lastFailureAt: times.last,
      windowMinutes: resolved.config.thresholds.windowMinutes,
      reasons,
      httpStatus: state.httpStatus,
      channel,
      ok: posted,
    });
  } catch {
    // best-effort
  }

  return { fired: true, severity, posted };
}
