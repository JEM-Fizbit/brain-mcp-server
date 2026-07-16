export const SYNC_HEARTBEAT_EVENT_TYPE = "sync_heartbeat";

export function evaluateSyncHeartbeat(row, nowMs = Date.now(), maxAgeMs = 300_000) {
  if (!row?.created_at) {
    return {
      status: "warn",
      state: "not_recorded",
      ageMs: null,
      maxAgeMs,
      createdAt: null,
    };
  }
  const createdAtMs = Date.parse(row.created_at);
  if (!Number.isFinite(createdAtMs)) {
    return {
      status: "warn",
      state: "invalid_timestamp",
      ageMs: null,
      maxAgeMs,
      createdAt: String(row.created_at),
    };
  }
  const ageMs = Math.max(0, nowMs - createdAtMs);
  return {
    status: ageMs > maxAgeMs ? "warn" : "pass",
    state: ageMs > maxAgeMs ? "stale" : "current",
    ageMs,
    maxAgeMs,
    createdAt: new Date(createdAtMs).toISOString(),
    durationMs: row.duration_ms === null || row.duration_ms === undefined
      ? null
      : Number(row.duration_ms),
    metadata: row.metadata && typeof row.metadata === "object" ? row.metadata : {},
  };
}
