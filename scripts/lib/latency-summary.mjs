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

export function normalizeLatencyOperation(operation) {
  if (!operation || typeof operation !== "object") return null;
  const latencyMs = asFiniteLatency(operation.latencyMs);
  const at = asIso(operation.at);
  if (latencyMs === null || !at) return null;

  const normalized = {
    name: String(operation.name || "operation"),
    kind: String(operation.kind || "operation"),
    target: operation.target ? String(operation.target) : null,
    ok: operation.ok !== false,
    latencyMs,
    at,
  };

  if (operation.error) normalized.error = String(operation.error);
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
    ok: metadata.ok !== false,
    latencyMs: row.duration_ms,
    at: row.created_at,
    error: metadata.error,
  });
}

export function operationKindLabel(kind) {
  return KIND_LABELS[kind] || kind || "operation";
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
        label: KIND_LABELS[kind] || kind,
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
        trend: trend.map((operation) => ({
          at: operation.at,
          latencyMs: operation.latencyMs,
          name: operation.name,
        })),
      };
    });
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

  return {
    version: 2,
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
  };
}
