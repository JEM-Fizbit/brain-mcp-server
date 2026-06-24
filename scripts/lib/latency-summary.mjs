const DEFAULT_HISTORY_LIMIT = 240;
const DEFAULT_TREND_LIMIT = 24;
export const HOSTED_MCP_LATENCY_EVENT_TYPE = "hosted_mcp_latency";
export const HOSTED_MCP_AUTH_EVENT_TYPE = "hosted_mcp_auth";
const KIND_LABELS = {
  read: "Read operations",
  write: "Write operations",
  sync_wait: "Sync wait",
  operation: "Other operations",
  auth: "Auth events",
};
const KIND_ORDER = ["read", "write", "sync_wait", "operation", "auth"];
const TIMING_LAYER_LABELS = {
  server_tool: "Server tool handler",
  client_e2e: "Client-observed E2E",
  sync_wait: "Sync wait",
  auth: "Auth",
  unknown: "Unknown timing layer",
};
const TIMING_LAYER_ORDER = ["server_tool", "client_e2e", "sync_wait", "auth", "unknown"];
const DEFAULT_USAGE_WINDOWS = [
  { key: "24h", label: "24H", durationMs: 24 * 60 * 60 * 1000 },
  { key: "7d", label: "7D", durationMs: 7 * 24 * 60 * 60 * 1000 },
];
export const DEFAULT_LATENCY_SLO_THRESHOLDS = Object.freeze({
  serverReadP95WarnMs: 1000,
  serverReadP95FailMs: 3000,
  serverWriteP95WarnMs: 2500,
  serverWriteP95FailMs: 6000,
  clientReadP95WarnMs: 2000,
  clientReadP95FailMs: 5000,
  clientWriteP95WarnMs: 3500,
  clientWriteP95FailMs: 8000,
  syncWaitP95WarnMs: 10000,
  syncWaitP95FailMs: 30000,
  dbMaxSpanWarnMs: 500,
  dbMaxSpanFailMs: 2500,
  dbFailedQueryWarnCount: 1,
});
const STATUS_RANK = {
  pass: 0,
  warn: 1,
  fail: 2,
};

function asFiniteLatency(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return number;
}

function asIso(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function asBoolean(value) {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return null;
}

function boundedText(value, fallback = null, limit = 100) {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value).replace(/\s+/g, " ").slice(0, limit) || fallback;
}

function roundedRatio(numerator, denominator) {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 1000) / 1000;
}

function normalizedTimingLayer(operation) {
  if (operation?.timingLayer) return String(operation.timingLayer);
  if (operation?.kind === "sync_wait") return "sync_wait";
  if (operation?.source === "hosted_mcp_server") return "server_tool";
  if (
    operation?.source === "hosted_mcp_client_e2e" ||
    operation?.source === "smoke-hosted-oauth"
  ) {
    return "client_e2e";
  }
  return "unknown";
}

function normalizeDbSpan(span) {
  if (!span || typeof span !== "object") return null;
  const durationMs = asFiniteLatency(span.durationMs);
  if (durationMs === null) return null;
  return {
    name: String(span.name || "db.query"),
    operation: String(span.operation || "query"),
    target: span.target ? String(span.target) : null,
    durationMs,
    ok: span.ok !== false,
    rowCount: Number.isFinite(Number(span.rowCount)) ? Number(span.rowCount) : null,
    error: span.error ? String(span.error) : null,
  };
}

function normalizeDbSummary(db) {
  if (!db || typeof db !== "object") return null;
  const queryCount = Math.max(0, Number(db.queryCount || 0));
  const totalMs = asFiniteLatency(db.totalMs) ?? 0;
  const maxMs = asFiniteLatency(db.maxMs);
  const averageMs = asFiniteLatency(db.averageMs);
  const spans = Array.isArray(db.spans)
    ? db.spans.map(normalizeDbSpan).filter(Boolean)
    : [];
  return {
    queryCount,
    totalMs,
    averageMs,
    maxMs,
    rowCount: Math.max(0, Number(db.rowCount || 0)),
    failedCount: Math.max(0, Number(db.failedCount || 0)),
    truncatedCount: Math.max(0, Number(db.truncatedCount || 0)),
    spans,
  };
}

export function normalizeLatencyOperation(operation) {
  if (!operation || typeof operation !== "object") return null;
  const latencyMs = asFiniteLatency(operation.latencyMs);
  const at = asIso(operation.at);
  if (latencyMs === null || !at) return null;

  const normalized = {
    name: String(operation.name || "operation"),
    kind: String(operation.kind || "operation"),
    target: operation.target ? String(operation.target) : null,
    source: operation.source ? String(operation.source) : null,
    timingLayer: normalizedTimingLayer(operation),
    durationType: operation.durationType ? String(operation.durationType) : null,
    ok: operation.ok !== false,
    latencyMs,
    at,
  };

  if (operation.error) normalized.error = String(operation.error);
  const db = normalizeDbSummary(operation.db);
  if (db) normalized.db = db;
  return normalized;
}

export function latencyHistoryFromSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return [];
  const source = Array.isArray(snapshot.history)
    ? snapshot.history
    : Array.isArray(snapshot.operations)
      ? snapshot.operations
      : [];
  return source
    .map(normalizeLatencyOperation)
    .filter(Boolean)
    .sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
}

export function latencyOperationFromSyncEventRow(row) {
  if (!row || typeof row !== "object") return null;
  const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
  return normalizeLatencyOperation({
    name: metadata.name || row.event_type || "operation",
    kind: metadata.kind || "operation",
    target: metadata.target || row.filename || null,
    source: metadata.source || null,
    timingLayer: metadata.timingLayer || null,
    durationType: metadata.durationType || null,
    ok: metadata.ok !== false,
    latencyMs: row.duration_ms,
    at: row.created_at,
    error: metadata.error,
    db: metadata.db,
  });
}

export function operationKindLabel(kind) {
  return KIND_LABELS[kind] || kind || "operation";
}

export function timingLayerLabel(layer) {
  return TIMING_LAYER_LABELS[layer] || layer || "unknown";
}

export function latencyHistoryFromSyncEventRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map(latencyOperationFromSyncEventRow)
    .filter(Boolean)
    .sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
}

export function operationEventFromSyncEventRow(row) {
  if (!row || typeof row !== "object") return null;
  const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const operation = latencyOperationFromSyncEventRow({
    ...row,
    duration_ms: row.duration_ms ?? 0,
  });
  if (!operation) return null;
  return {
    eventType: String(row.event_type || HOSTED_MCP_LATENCY_EVENT_TYPE),
    source: metadata.source ? String(metadata.source) : null,
    filename: row.filename ? String(row.filename) : null,
    timingLayer: metadata.timingLayer ? String(metadata.timingLayer) : operation.timingLayer,
    durationType: metadata.durationType ? String(metadata.durationType) : operation.durationType,
    db: operation.db || null,
    ...operation,
  };
}

export function operationEventLogFromSyncEventRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map(operationEventFromSyncEventRow)
    .filter(Boolean)
    .sort((left, right) => Date.parse(right.at) - Date.parse(left.at));
}

function authEventFromSyncEventRow(row) {
  if (!row || typeof row !== "object") return null;
  const at = asIso(row.created_at);
  if (!at) return null;
  const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const ok = asBoolean(metadata.ok);
  const durationMs =
    asFiniteLatency(row.duration_ms) ?? asFiniteLatency(metadata.latencyMs);
  return {
    at,
    ok,
    reason: boundedText(metadata.error || metadata.reason, "auth_failed"),
    name: boundedText(metadata.name, "auth_event"),
    target: boundedText(metadata.target || row.filename, null),
    source: boundedText(metadata.source, null),
    clientId: boundedText(metadata.clientId, null),
    grantType: boundedText(metadata.grantType, null),
    httpStatus:
      metadata.httpStatus === undefined || metadata.httpStatus === null
        ? null
        : boundedText(metadata.httpStatus, null, 20),
    durationMs,
  };
}

function countBy(events, key, fallback) {
  const counts = new Map();
  for (const event of events) {
    const value = event[key] || fallback;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  const total = events.length;
  return [...counts.entries()]
    .map(([value, count]) => ({
      [key]: value,
      count,
      n: count,
      share: roundedRatio(count, total),
    }))
    .sort((left, right) => right.count - left.count || String(left[key]).localeCompare(String(right[key])));
}

export function authFailureSummaryFromSyncEventRows(rows, options = {}) {
  const now = Date.parse(options.now || new Date().toISOString());
  const safeNow = Number.isFinite(now) ? now : Date.now();
  const windowMinutes = Math.max(1, Number(options.windowMinutes || 60));
  const warnThreshold = Math.max(0, Number(options.warnThreshold || 0));
  const failThreshold = Math.max(0, Number(options.failThreshold || 0));
  const bucketCount = Math.max(1, Math.min(24, Number(options.bucketCount || 6)));
  const recentLimit = Math.max(1, Math.min(100, Number(options.recentLimit || 20)));
  const activeThresholdMinutes = Math.max(
    1,
    Number(options.activeThresholdMinutes || Math.min(15, Math.max(5, Math.ceil(windowMinutes / 6))))
  );
  const windowMs = windowMinutes * 60 * 1000;
  const windowStartedMs = safeNow - windowMs;
  const previousWindowStartedMs = windowStartedMs - windowMs;
  const events = (Array.isArray(rows) ? rows : [])
    .filter((row) => !row.event_type || row.event_type === HOSTED_MCP_AUTH_EVENT_TYPE)
    .map(authEventFromSyncEventRow)
    .filter(Boolean)
    .sort((left, right) => Date.parse(left.at) - Date.parse(right.at));

  const currentEvents = events.filter((event) => {
    const at = Date.parse(event.at);
    return at >= windowStartedMs && at <= safeNow;
  });
  const previousEvents = events.filter((event) => {
    const at = Date.parse(event.at);
    return at >= previousWindowStartedMs && at < windowStartedMs;
  });
  const currentFailures = currentEvents.filter((event) => event.ok === false);
  const currentSuccesses = currentEvents.filter((event) => event.ok === true);
  const previousFailures = previousEvents.filter((event) => event.ok === false);
  const lastFailure = currentFailures.at(-1) || null;
  const firstFailure = currentFailures[0] || null;
  const minutesSinceLastFailure = lastFailure
    ? Math.floor((safeNow - Date.parse(lastFailure.at)) / (60 * 1000))
    : null;
  const bucketMs = windowMs / bucketCount;
  const trend = Array.from({ length: bucketCount }, (_, index) => {
    const bucketStartedMs = windowStartedMs + index * bucketMs;
    const bucketEndedMs = index === bucketCount - 1 ? safeNow : bucketStartedMs + bucketMs;
    const bucketEvents = currentEvents.filter((event) => {
      const at = Date.parse(event.at);
      return at >= bucketStartedMs && at < bucketEndedMs + (index === bucketCount - 1 ? 1 : 0);
    });
    const bucketFailures = bucketEvents.filter((event) => event.ok === false);
    return {
      bucketStartAt: new Date(bucketStartedMs).toISOString(),
      bucketEndAt: new Date(bucketEndedMs).toISOString(),
      totalAuthEvents: bucketEvents.length,
      successCount: bucketEvents.filter((event) => event.ok === true).length,
      failureCount: bucketFailures.length,
    };
  });

  const recentFailures = [...currentFailures]
    .sort((left, right) => Date.parse(right.at) - Date.parse(left.at))
    .slice(0, recentLimit)
    .map((event) => ({
      at: event.at,
      reason: event.reason,
      name: event.name,
      target: event.target,
      source: event.source,
      clientId: event.clientId,
      grantType: event.grantType,
      httpStatus: event.httpStatus,
      durationMs: event.durationMs,
    }));
  const failureCount = currentFailures.length;
  const previousFailureCount = previousFailures.length;
  const failureDelta = failureCount - previousFailureCount;
  const status =
    failThreshold > 0 && failureCount >= failThreshold
      ? "fail"
      : warnThreshold > 0 && failureCount >= warnThreshold
        ? "warn"
        : "pass";
  const active = minutesSinceLastFailure !== null && minutesSinceLastFailure <= activeThresholdMinutes;

  // Stale-connector classification (conservative). A pre-migration / half-deleted
  // connector loops `unknown_client_id` on a refresh-token grant with a client id
  // the server no longer recognizes. This is benign noise, not an auth incident
  // (see DECISIONS.md 2026-06-23). We only downgrade severity when ALL of:
  //   - the registered client-id set is known (caller passed registeredClientIds),
  //   - every current failure is unknown_client_id on a refresh_token grant,
  //   - every failure carries a client id and they are all the SAME single id,
  //   - that id is NOT currently registered, and
  //   - the failures have been sustained past the grace window (so a brand-new
  //     enrollment briefly failing before its DCR completes is not masked).
  // Any ambiguity (multi-client, multi-reason, unknown registered set, or a short
  // burst) keeps full severity.
  const staleGraceMinutes = Math.max(1, Number(options.staleGraceMinutes || 10));
  const registeredInput = options.registeredClientIds;
  const registeredKnown =
    registeredInput instanceof Set || Array.isArray(registeredInput);
  const registeredSet = registeredKnown
    ? registeredInput instanceof Set
      ? registeredInput
      : new Set(registeredInput)
    : null;
  const failingClientIds = new Set(
    currentFailures.map((event) => event.clientId).filter(Boolean)
  );
  let connectorState = failureCount === 0 ? "clear" : "incident";
  let staleClientId = null;
  if (failureCount > 0 && registeredSet) {
    const allUnknownClientRefresh = currentFailures.every(
      (event) =>
        event.reason === "unknown_client_id" && event.grantType === "refresh_token"
    );
    const everyFailureHasClientId = currentFailures.every((event) => event.clientId);
    const singleClient = failingClientIds.size === 1;
    const allUnregistered = [...failingClientIds].every((id) => !registeredSet.has(id));
    const spanMs =
      firstFailure && lastFailure
        ? Date.parse(lastFailure.at) - Date.parse(firstFailure.at)
        : 0;
    const firstAgeMs = firstFailure ? safeNow - Date.parse(firstFailure.at) : 0;
    const graceMs = staleGraceMinutes * 60 * 1000;
    const sustained = Math.max(spanMs, 0) >= graceMs || firstAgeMs >= graceMs;
    if (
      allUnknownClientRefresh &&
      everyFailureHasClientId &&
      singleClient &&
      allUnregistered &&
      sustained
    ) {
      connectorState = "stale_connector";
      staleClientId = [...failingClientIds][0];
    }
  }
  // Consumers (doctor + Slack alerter) read effectiveStatus so their verdicts
  // agree: a pure stale-connector loop is capped at `warn` instead of `fail`.
  const effectiveStatus =
    connectorState === "stale_connector" && status === "fail" ? "warn" : status;

  return {
    windowMinutes,
    warnThreshold,
    failThreshold,
    activeThresholdMinutes,
    windowStartedAt: new Date(windowStartedMs).toISOString(),
    previousWindowStartedAt: new Date(previousWindowStartedMs).toISOString(),
    status,
    failureCount,
    successCount: currentSuccesses.length,
    totalAuthEvents: currentEvents.length,
    failureRate: roundedRatio(failureCount, currentEvents.length),
    previousFailureCount,
    failureDelta,
    failureDeltaPercent:
      previousFailureCount > 0 ? roundedRatio(failureDelta, previousFailureCount) : null,
    firstFailureAt: firstFailure?.at || null,
    lastFailureAt: lastFailure?.at || null,
    minutesSinceLastFailure,
    active,
    activityState: failureCount === 0 ? "clear" : active ? "active" : "stale",
    connectorState,
    effectiveStatus,
    staleClientId,
    staleGraceMinutes,
    registeredClientIdsKnown: registeredKnown,
    reasons: countBy(currentFailures, "reason", "auth_failed").slice(0, 8),
    targets: countBy(currentFailures, "target", "unknown").slice(0, 8),
    names: countBy(currentFailures, "name", "auth_event").slice(0, 8),
    httpStatuses: countBy(currentFailures, "httpStatus", "unknown").slice(0, 8),
    clients: countBy(currentFailures, "clientId", "unknown").slice(0, 8),
    grantTypes: countBy(currentFailures, "grantType", "unknown").slice(0, 8),
    trend,
    recentFailures,
  };
}

export function filenameForLatencyOperation(operation) {
  const target = operation?.target ? String(operation.target) : "";
  return target.endsWith(".md") && !target.startsWith("/") && !target.includes("..")
    ? target
    : null;
}

export function metadataForLatencyOperation(operation, extra = {}) {
  const normalized = normalizeLatencyOperation(operation);
  if (!normalized) return null;
  return {
    ...extra,
    name: normalized.name,
    kind: normalized.kind,
    target: normalized.target,
    timingLayer: extra.timingLayer || normalized.timingLayer,
    durationType: extra.durationType || normalized.durationType,
    ok: normalized.ok,
    error: normalized.error || null,
  };
}

export function appendLatencyHistory(previousSnapshot, operations, limit = DEFAULT_HISTORY_LIMIT) {
  const boundedLimit = Math.max(1, Number(limit) || DEFAULT_HISTORY_LIMIT);
  const previous = latencyHistoryFromSnapshot(previousSnapshot);
  const current = Array.isArray(operations)
    ? operations.map(normalizeLatencyOperation).filter(Boolean)
    : [];
  const seen = new Set();
  const merged = [...previous, ...current]
    .sort((left, right) => Date.parse(left.at) - Date.parse(right.at))
    .filter((operation) => {
      const key = [
        operation.at,
        operation.name,
        operation.kind,
        operation.target || "",
        operation.source || "",
        operation.timingLayer || "",
        operation.ok ? "ok" : "fail",
        operation.latencyMs,
      ].join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  return merged.slice(-boundedLimit);
}

function percentile(sortedValues, percentileValue) {
  if (sortedValues.length === 0) return null;
  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil((percentileValue / 100) * sortedValues.length) - 1)
  );
  return sortedValues[index];
}

function rounded(value) {
  return value === null ? null : Math.round(value);
}

function statusByRank(left, right) {
  return (STATUS_RANK[right] ?? 0) > (STATUS_RANK[left] ?? 0) ? right : left;
}

function worstStatus(...statuses) {
  return statuses.flat().filter(Boolean).reduce(statusByRank, "pass");
}

function thresholdStatus(value, warnValue, failValue) {
  if (!Number.isFinite(Number(value))) return "pass";
  if (Number.isFinite(Number(failValue)) && value >= failValue) return "fail";
  if (Number.isFinite(Number(warnValue)) && value >= warnValue) return "warn";
  return "pass";
}

function normalizeThreshold(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function durationEvaluation({
  id,
  label,
  valueMs,
  warnMs,
  failMs,
  sampleCount = null,
  detail = null,
}) {
  if (!Number.isFinite(Number(valueMs))) return null;
  return {
    id,
    label,
    metric: "duration",
    valueMs: rounded(valueMs),
    warnMs: rounded(warnMs),
    failMs: rounded(failMs),
    sampleCount,
    status: thresholdStatus(valueMs, warnMs, failMs),
    detail,
  };
}

function countEvaluation({
  id,
  label,
  value,
  warnCount,
  sampleCount = null,
  detail = null,
}) {
  if (!Number.isFinite(Number(value))) return null;
  return {
    id,
    label,
    metric: "count",
    value: Math.max(0, Math.round(Number(value))),
    warnCount: Math.max(0, Math.round(Number(warnCount || 0))),
    sampleCount,
    status: Number(value) >= Number(warnCount || 0) && Number(warnCount || 0) > 0
      ? "warn"
      : "pass",
    detail,
  };
}

function summaryByKind(summaries, kind) {
  return (Array.isArray(summaries) ? summaries : [])
    .find((summary) => summary.kind === kind) || null;
}

function normalizedLatencyHistory(history) {
  return Array.isArray(history)
    ? history.map(normalizeLatencyOperation).filter(Boolean)
    : [];
}

function normalizedKind(kind) {
  return KIND_ORDER.includes(kind) ? kind : kind || "operation";
}

function kindSort(left, right) {
  const leftIndex = KIND_ORDER.indexOf(left);
  const rightIndex = KIND_ORDER.indexOf(right);
  if (leftIndex !== -1 || rightIndex !== -1) {
    return (leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex) -
      (rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex);
  }
  return left.localeCompare(right);
}

function timingLayerSort(left, right) {
  const leftIndex = TIMING_LAYER_ORDER.indexOf(left);
  const rightIndex = TIMING_LAYER_ORDER.indexOf(right);
  if (leftIndex !== -1 || rightIndex !== -1) {
    return (leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex) -
      (rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex);
  }
  return left.localeCompare(right);
}

function operationUsageBucket(operations) {
  const byKindMap = new Map();
  for (const operation of operations) {
    const kind = normalizedKind(operation.kind);
    const current = byKindMap.get(kind) || {
      kind,
      label: operationKindLabel(kind),
      totalCount: 0,
      failedCount: 0,
    };
    current.totalCount += 1;
    if (operation.ok === false) current.failedCount += 1;
    byKindMap.set(kind, current);
  }

  const byKind = [...byKindMap.values()].sort((left, right) =>
    kindSort(left.kind, right.kind)
  );
  return {
    totalCount: byKind.reduce((total, row) => total + row.totalCount, 0),
    failedCount: byKind.reduce((total, row) => total + row.failedCount, 0),
    byKind,
  };
}

export function summarizeOperationUsage(history, options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const nowMs = Number.isNaN(now.getTime()) ? Date.now() : now.getTime();
  const windowSpecs = Array.isArray(options.windows) && options.windows.length > 0
    ? options.windows
    : DEFAULT_USAGE_WINDOWS;
  const normalized = Array.isArray(history)
    ? history.map(normalizeLatencyOperation).filter(Boolean)
    : [];

  return {
    allTime: {
      key: "all",
      label: "All Recorded",
      ...operationUsageBucket(normalized),
    },
    windows: windowSpecs.map((windowSpec) => {
      const durationMs = Math.max(1, Number(windowSpec.durationMs) || 1);
      const windowStartedAt = new Date(nowMs - durationMs).toISOString();
      const operations = normalized.filter(
        (operation) => Date.parse(operation.at) >= nowMs - durationMs
      );
      return {
        key: String(windowSpec.key || windowSpec.label || "window"),
        label: String(windowSpec.label || windowSpec.key || "Window"),
        durationMs,
        windowStartedAt,
        windowEndedAt: new Date(nowMs).toISOString(),
        ...operationUsageBucket(operations),
      };
    }),
  };
}

export function summarizeLatencyHistory(history, trendLimit = DEFAULT_TREND_LIMIT) {
  const normalized = Array.isArray(history)
    ? history.map(normalizeLatencyOperation).filter(Boolean)
    : [];
  const kinds = new Set(normalized.map((operation) => operation.kind || "operation"));
  return KIND_ORDER.filter((kind) => kinds.has(kind))
    .concat([...kinds].filter((kind) => !KIND_ORDER.includes(kind)).sort())
    .map((kind) => {
      const all = normalized.filter((operation) => operation.kind === kind);
      return latencySummaryForGroup({
        kind,
        label: KIND_LABELS[kind] || kind,
        operations: all,
        trendLimit,
      });
    });
}

function aggregateDbTelemetry(operations) {
  const withDb = operations.filter((operation) => operation.db?.queryCount > 0);
  if (withDb.length === 0) return null;
  const queryCount = withDb.reduce((total, operation) => total + operation.db.queryCount, 0);
  const totalMs = withDb.reduce((total, operation) => total + operation.db.totalMs, 0);
  const failedCount = withDb.reduce((total, operation) => total + operation.db.failedCount, 0);
  const maxValues = withDb
    .map((operation) => operation.db.maxMs)
    .filter((value) => value !== null);
  const maxMs = maxValues.length ? Math.max(...maxValues) : null;
  return {
    operationCount: withDb.length,
    queryCount,
    totalMs: rounded(totalMs),
    averageMsPerOperation: rounded(totalMs / withDb.length),
    averageMsPerQuery: queryCount ? rounded(totalMs / queryCount) : null,
    maxMs: maxMs === null ? null : rounded(maxMs),
    failedCount,
    latest: withDb.at(-1)?.db || null,
  };
}

function latencySummaryForGroup({
  kind,
  label,
  operations,
  trendLimit = DEFAULT_TREND_LIMIT,
  extra = {},
}) {
  const all = [...operations].sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
  const successes = all.filter((operation) => operation.ok);
  const failures = all.length - successes.length;
  const values = successes
    .map((operation) => operation.latencyMs)
    .sort((left, right) => left - right);
  const latest = successes.at(-1) || null;
  const average = values.length
    ? values.reduce((total, value) => total + value, 0) / values.length
    : null;
  const trend = successes.slice(-Math.max(1, Number(trendLimit) || DEFAULT_TREND_LIMIT));

  return {
    kind,
    label,
    ...extra,
    sampleCount: successes.length,
    failedCount: failures,
    latestLatencyMs: latest?.latencyMs ?? null,
    latestAt: latest?.at ?? null,
    averageLatencyMs: rounded(average),
    minLatencyMs: values.length ? values[0] : null,
    maxLatencyMs: values.length ? values.at(-1) : null,
    p50LatencyMs: rounded(percentile(values, 50)),
    p95LatencyMs: rounded(percentile(values, 95)),
    windowStartedAt: all[0]?.at ?? null,
    windowEndedAt: all.at(-1)?.at ?? null,
    db: aggregateDbTelemetry(successes),
    trend: trend.map((operation) => ({
      at: operation.at,
      latencyMs: operation.latencyMs,
      name: operation.name,
      target: operation.target,
      source: operation.source,
      timingLayer: operation.timingLayer,
      db: operation.db || null,
    })),
  };
}

export function summarizeLatencyHistoryByTool(
  history,
  trendLimit = DEFAULT_TREND_LIMIT,
  limit = 16
) {
  const normalized = Array.isArray(history)
    ? history.map(normalizeLatencyOperation).filter(Boolean)
    : [];
  const groups = new Map();
  for (const operation of normalized) {
    const key = [
      operation.timingLayer || "unknown",
      operation.source || "",
      operation.kind || "operation",
      operation.name || "operation",
    ].join("|");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(operation);
  }

  return [...groups.entries()]
    .map(([key, operations]) => {
      const [timingLayer, source, kind, name] = key.split("|");
      return latencySummaryForGroup({
        kind,
        label: name,
        operations,
        trendLimit,
        extra: {
          name,
          source: source || null,
          timingLayer,
        },
      });
    })
    .sort((left, right) => {
      const leftP95 = left.p95LatencyMs ?? -1;
      const rightP95 = right.p95LatencyMs ?? -1;
      if (leftP95 !== rightP95) return rightP95 - leftP95;
      return String(left.name).localeCompare(String(right.name));
    })
    .slice(0, Math.max(1, Number(limit) || 16));
}

export function summarizeLatencyHistoryByTimingLayer(
  history,
  trendLimit = DEFAULT_TREND_LIMIT
) {
  const normalized = Array.isArray(history)
    ? history.map(normalizeLatencyOperation).filter(Boolean)
    : [];
  const layers = new Set(normalized.map((operation) => operation.timingLayer || "unknown"));
  return [...layers]
    .sort(timingLayerSort)
    .map((timingLayer) =>
      latencySummaryForGroup({
        kind: timingLayer,
        label: timingLayerLabel(timingLayer),
        operations: normalized.filter((operation) => operation.timingLayer === timingLayer),
        trendLimit,
        extra: { timingLayer },
      })
    );
}

export function slowestLatencyOperations(history, limit = 10) {
  const normalized = Array.isArray(history)
    ? history.map(normalizeLatencyOperation).filter(Boolean)
    : [];
  return normalized
    .filter((operation) => operation.ok)
    .sort((left, right) => right.latencyMs - left.latencyMs)
    .slice(0, Math.max(1, Number(limit) || 10))
    .map((operation) => ({
      name: operation.name,
      kind: operation.kind,
      target: operation.target,
      source: operation.source,
      timingLayer: operation.timingLayer,
      latencyMs: operation.latencyMs,
      at: operation.at,
      db: operation.db || null,
    }));
}

export function normalizeLatencySloThresholds(overrides = {}) {
  return Object.fromEntries(
    Object.entries(DEFAULT_LATENCY_SLO_THRESHOLDS).map(([key, value]) => [
      key,
      normalizeThreshold(overrides[key], value),
    ])
  );
}

export function evaluateLatencySlo({
  history = [],
  clientHistory = [],
  thresholds = {},
} = {}) {
  const normalizedThresholds = normalizeLatencySloThresholds(thresholds);
  const serverHistory = normalizedLatencyHistory(history);
  const clientObservedHistory = normalizedLatencyHistory(clientHistory);
  const serverSummaries = summarizeLatencyHistory(serverHistory);
  const clientSummaries = summarizeLatencyHistory(clientObservedHistory);
  const serverRead = summaryByKind(serverSummaries, "read");
  const serverWrite = summaryByKind(serverSummaries, "write");
  const syncWait = summaryByKind(serverSummaries, "sync_wait");
  const clientRead = summaryByKind(clientSummaries, "read");
  const clientWrite = summaryByKind(clientSummaries, "write");
  const dbMaxValues = serverHistory
    .map((operation) => operation.db?.maxMs)
    .filter((value) => Number.isFinite(Number(value)));
  const dbMaxSpanMs = dbMaxValues.length ? Math.max(...dbMaxValues) : null;
  const dbFailedQueryCount = serverHistory.reduce(
    (total, operation) => total + Number(operation.db?.failedCount || 0),
    0
  );
  const dbQueryCount = serverHistory.reduce(
    (total, operation) => total + Number(operation.db?.queryCount || 0),
    0
  );

  const evaluations = [
    durationEvaluation({
      id: "server_read_p95",
      label: "Server read p95",
      valueMs: serverRead?.p95LatencyMs,
      warnMs: normalizedThresholds.serverReadP95WarnMs,
      failMs: normalizedThresholds.serverReadP95FailMs,
      sampleCount: serverRead?.sampleCount ?? null,
      detail: "Hosted MCP server handler duration for read tools.",
    }),
    durationEvaluation({
      id: "server_write_p95",
      label: "Server write p95",
      valueMs: serverWrite?.p95LatencyMs,
      warnMs: normalizedThresholds.serverWriteP95WarnMs,
      failMs: normalizedThresholds.serverWriteP95FailMs,
      sampleCount: serverWrite?.sampleCount ?? null,
      detail: "Hosted MCP server handler duration for write tools.",
    }),
    durationEvaluation({
      id: "client_read_p95",
      label: "Client read p95",
      valueMs: clientRead?.p95LatencyMs,
      warnMs: normalizedThresholds.clientReadP95WarnMs,
      failMs: normalizedThresholds.clientReadP95FailMs,
      sampleCount: clientRead?.sampleCount ?? null,
      detail: "Client-observed end-to-end read duration, including network and client parsing overhead.",
    }),
    durationEvaluation({
      id: "client_write_p95",
      label: "Client write p95",
      valueMs: clientWrite?.p95LatencyMs,
      warnMs: normalizedThresholds.clientWriteP95WarnMs,
      failMs: normalizedThresholds.clientWriteP95FailMs,
      sampleCount: clientWrite?.sampleCount ?? null,
      detail: "Client-observed end-to-end write duration, including network and client parsing overhead.",
    }),
    durationEvaluation({
      id: "sync_wait_p95",
      label: "Sync wait p95",
      valueMs: syncWait?.p95LatencyMs,
      warnMs: normalizedThresholds.syncWaitP95WarnMs,
      failMs: normalizedThresholds.syncWaitP95FailMs,
      sampleCount: syncWait?.sampleCount ?? null,
      detail: "Local-hosted propagation wait measured by smoke and test-drive flows.",
    }),
    durationEvaluation({
      id: "db_max_span",
      label: "Max DB span",
      valueMs: dbMaxSpanMs,
      warnMs: normalizedThresholds.dbMaxSpanWarnMs,
      failMs: normalizedThresholds.dbMaxSpanFailMs,
      sampleCount: dbQueryCount || null,
      detail: "Slowest single bounded Postgres span observed inside hosted MCP server handlers.",
    }),
    countEvaluation({
      id: "db_failed_queries",
      label: "DB failed queries",
      value: dbFailedQueryCount,
      warnCount: normalizedThresholds.dbFailedQueryWarnCount,
      sampleCount: dbQueryCount || null,
      detail: "Failed Postgres spans observed inside hosted MCP server handlers.",
    }),
  ].filter(Boolean);

  const failedCount = evaluations.filter((evaluation) => evaluation.status === "fail").length;
  const warningCount = evaluations.filter((evaluation) => evaluation.status === "warn").length;

  return {
    status: worstStatus(evaluations.map((evaluation) => evaluation.status)),
    thresholds: normalizedThresholds,
    evaluations,
    warningCount,
    failedCount,
  };
}

function collectDbSpanTargets(history, limit = 8) {
  const groups = new Map();
  const operations = normalizedLatencyHistory(history);
  for (const operation of operations) {
    const spans = Array.isArray(operation.db?.spans) ? operation.db.spans : [];
    for (const span of spans) {
      const target = span.target || span.name || "db.query";
      const operationType = span.operation || "query";
      const key = `${operationType}|${target}`;
      const current = groups.get(key) || {
        operation: operationType,
        target,
        spanCount: 0,
        totalMs: 0,
        maxMs: 0,
        rowCount: 0,
        failedCount: 0,
        latestAt: null,
        examples: [],
      };

      current.spanCount += 1;
      current.totalMs += span.durationMs;
      current.maxMs = Math.max(current.maxMs, span.durationMs);
      if (Number.isFinite(Number(span.rowCount))) current.rowCount += Number(span.rowCount);
      if (span.ok === false) current.failedCount += 1;
      if (!current.latestAt || Date.parse(operation.at) > Date.parse(current.latestAt)) {
        current.latestAt = operation.at;
      }
      current.examples.push({
        name: operation.name,
        kind: operation.kind,
        target: operation.target,
        durationMs: rounded(span.durationMs),
        latencyMs: rounded(operation.latencyMs),
        at: operation.at,
        ok: span.ok !== false,
        error: span.error || null,
      });
      current.examples.sort((left, right) => right.durationMs - left.durationMs);
      current.examples.splice(3);
      groups.set(key, current);
    }
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      totalMs: rounded(group.totalMs),
      averageMs: rounded(group.totalMs / Math.max(1, group.spanCount)),
      maxMs: rounded(group.maxMs),
    }))
    .sort((left, right) => {
      if (left.maxMs !== right.maxMs) return right.maxMs - left.maxMs;
      if (left.totalMs !== right.totalMs) return right.totalMs - left.totalMs;
      return String(left.target).localeCompare(String(right.target));
    })
    .slice(0, Math.max(1, Number(limit) || 8));
}

function sloFindingFromEvaluation(evaluation) {
  if (!evaluation || evaluation.status === "pass") return null;
  const observed = evaluation.metric === "count"
    ? `${evaluation.value} observed`
    : `${evaluation.valueMs}ms observed`;
  const warn = evaluation.metric === "count"
    ? `warn at ${evaluation.warnCount}`
    : `warn at ${evaluation.warnMs}ms`;
  const fail = evaluation.metric === "count"
    ? null
    : `fail at ${evaluation.failMs}ms`;
  return {
    level: evaluation.status,
    title: `${evaluation.label} breached ${evaluation.status} threshold`,
    detail: [observed, warn, fail, evaluation.detail].filter(Boolean).join("; "),
    metricId: evaluation.id,
  };
}

export function diagnoseLatencyPerformance({
  history = [],
  clientHistory = [],
  thresholds = {},
} = {}) {
  const normalizedThresholds = normalizeLatencySloThresholds(thresholds);
  const serverHistory = normalizedLatencyHistory(history);
  const clientObservedHistory = normalizedLatencyHistory(clientHistory);
  const slo = evaluateLatencySlo({
    history: serverHistory,
    clientHistory: clientObservedHistory,
    thresholds: normalizedThresholds,
  });
  const findings = slo.evaluations
    .map(sloFindingFromEvaluation)
    .filter(Boolean);
  const dbSpanTargets = collectDbSpanTargets(serverHistory);
  const slowestDbTarget = dbSpanTargets[0] || null;

  if (slowestDbTarget?.maxMs >= normalizedThresholds.dbMaxSpanWarnMs) {
    findings.push({
      level: slowestDbTarget.maxMs >= normalizedThresholds.dbMaxSpanFailMs
        ? "fail"
        : "warn",
      title: `Slowest DB target: ${slowestDbTarget.target}`,
      detail: `${slowestDbTarget.operation} max ${slowestDbTarget.maxMs}ms, average ${slowestDbTarget.averageMs}ms across ${slowestDbTarget.spanCount} spans.`,
      metricId: "slowest_db_target",
    });
  }

  const serverRead = summaryByKind(summarizeLatencyHistory(serverHistory), "read");
  const clientRead = summaryByKind(summarizeLatencyHistory(clientObservedHistory), "read");
  if (
    Number.isFinite(Number(serverRead?.p95LatencyMs)) &&
    Number.isFinite(Number(clientRead?.p95LatencyMs)) &&
    clientRead.p95LatencyMs - serverRead.p95LatencyMs >= 1000
  ) {
    findings.push({
      level: "warn",
      title: "Client read latency is materially higher than server handler latency",
      detail: `Client read p95 ${clientRead.p95LatencyMs}ms vs server read p95 ${serverRead.p95LatencyMs}ms. Check client/network/MCP overhead before optimizing DB paths only.`,
      metricId: "client_server_read_gap",
    });
  }

  return {
    status: worstStatus([
      slo.status,
      findings.map((finding) => finding.level),
    ]),
    slo,
    findings: findings.slice(0, 8),
    dbSpanTargets,
    slowestOperations: slowestLatencyOperations([
      ...serverHistory,
      ...clientObservedHistory,
    ], 8),
  };
}

export function latestSuccessfulLatency(history, kind) {
  return [...history]
    .reverse()
    .find((operation) => operation.kind === kind && operation.ok)?.latencyMs ?? null;
}

export function buildLatencySnapshot({
  previousSnapshot = null,
  operationLatencies = [],
  baseUrl,
  brainId,
  smokeFilename,
  checkedAt = new Date().toISOString(),
  historyLimit = DEFAULT_HISTORY_LIMIT,
  trendLimit = DEFAULT_TREND_LIMIT,
}) {
  const history = appendLatencyHistory(previousSnapshot, operationLatencies, historyLimit);
  const operationSummaries = summarizeLatencyHistory(history, trendLimit);
  const timingLayerSummaries = summarizeLatencyHistoryByTimingLayer(history, trendLimit);
  const toolSummaries = summarizeLatencyHistoryByTool(history, trendLimit);
  const slowestOperations = slowestLatencyOperations(history);

  return {
    version: 3,
    checkedAt,
    baseUrl,
    brainId,
    smokeFilename,
    operationCount: operationLatencies.length,
    historyCount: history.length,
    latestReadLatencyMs: latestSuccessfulLatency(history, "read"),
    latestWriteLatencyMs: latestSuccessfulLatency(history, "write"),
    latestSyncWaitLatencyMs: latestSuccessfulLatency(history, "sync_wait"),
    latestOperationAt: history.at(-1)?.at ?? null,
    operations: operationLatencies
      .map(normalizeLatencyOperation)
      .filter(Boolean)
      .slice(-40),
    history,
    operationSummaries,
    timingLayerSummaries,
    toolSummaries,
    slowestOperations,
  };
}
