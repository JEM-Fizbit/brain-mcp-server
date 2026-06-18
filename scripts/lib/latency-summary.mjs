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

export function latencyHistoryFromSyncEventRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map(latencyOperationFromSyncEventRow)
    .filter(Boolean)
    .sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
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
