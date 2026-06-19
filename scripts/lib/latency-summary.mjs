const DEFAULT_HISTORY_LIMIT = 240;
const DEFAULT_TREND_LIMIT = 24;
export const HOSTED_MCP_LATENCY_EVENT_TYPE = "hosted_mcp_latency";
const KIND_LABELS = {
  read: "Read operations",
  write: "Write operations",
  sync_wait: "Sync wait",
  operation: "Other operations",
};
const KIND_ORDER = ["read", "write", "sync_wait", "operation"];
const TIMING_LAYER_LABELS = {
  server_tool: "Server tool handler",
  client_e2e: "Client-observed E2E",
  sync_wait: "Sync wait",
  unknown: "Unknown timing layer",
};
const TIMING_LAYER_ORDER = ["server_tool", "client_e2e", "sync_wait", "unknown"];
const DEFAULT_USAGE_WINDOWS = [
  { key: "24h", label: "24H", durationMs: 24 * 60 * 60 * 1000 },
  { key: "7d", label: "7D", durationMs: 7 * 24 * 60 * 60 * 1000 },
];

function asFiniteLatency(value) {
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
  const operation = latencyOperationFromSyncEventRow(row);
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
