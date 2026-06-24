import pg from "pg";
import { revisionStoreProvider } from "./active-brain-store.js";
import { maybeAlertOnAuthFailure } from "./auth-alert.js";

const { Pool } = pg;

export const HOSTED_MCP_AUTH_EVENT_TYPE = "hosted_mcp_auth";

let poolCache:
  | {
      key: string;
      pool: pg.Pool;
    }
  | undefined;

function authTelemetryEnabled(): boolean {
  return (
    process.env.TRANSPORT === "http" &&
    revisionStoreProvider() === "postgres" &&
    Boolean(process.env.BRAIN_REVISION_DATABASE_URL) &&
    process.env.BRAIN_HOSTED_MCP_AUTH_DB_WRITE !== "0"
  );
}

function telemetryPool(): pg.Pool | null {
  const connectionString = process.env.BRAIN_REVISION_DATABASE_URL;
  if (!connectionString) return null;
  if (poolCache?.key === connectionString) return poolCache.pool;
  poolCache?.pool.end().catch(() => undefined);
  poolCache = {
    key: connectionString,
    pool: new Pool({
      connectionString,
      allowExitOnIdle: true,
      connectionTimeoutMillis: 3000,
      max: 1,
      query_timeout: 3000,
      statement_timeout: 3000,
    }),
  };
  return poolCache.pool;
}

function safeText(value: unknown, fallback: string): string {
  if (typeof value !== "string" || value.length === 0) return fallback;
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || fallback;
}

export function authReasonCode(reason: unknown): string {
  const text = typeof reason === "string" ? reason : "";
  if (/missing Authorization: Bearer header/i.test(text)) return "missing_bearer";
  if (/token expired/i.test(text)) return "token_expired";
  if (/audience mismatch/i.test(text)) return "audience_mismatch";
  if (/invalid JWT/i.test(text)) return "invalid_token";
  if (/\bbearer\b/i.test(text)) return "auth_failed";
  return safeText(text, "auth_failed");
}

export async function closeAuthTelemetryForTests(): Promise<void> {
  const pool = poolCache?.pool;
  poolCache = undefined;
  await pool?.end().catch(() => undefined);
}

async function recordAuthEvent(input: {
  name: string;
  reason: string;
  httpStatus: number;
  durationMs: number;
  target?: string | null;
  clientId?: string | null;
  grantType?: string | null;
}): Promise<void> {
  if (!authTelemetryEnabled()) return;
  const pool = telemetryPool();
  if (!pool) return;

  const metadata = {
    version: 1,
    source: "hosted_mcp_server",
    timingLayer: "auth",
    durationType: "auth_failure",
    name: input.name,
    kind: "auth",
    target: input.target || input.reason,
    ok: false,
    error: input.reason,
    httpStatus: input.httpStatus,
    // Non-secret OAuth identifiers for tracking/classification (spec 005).
    // client_id is attacker-controlled on the failure path, so it is sanitized
    // and length-bounded. Never record tokens, secrets, headers, or bodies.
    clientId: input.clientId ? safeText(input.clientId, "unknown") : null,
    grantType: input.grantType ? safeText(input.grantType, "unknown") : null,
    db: null,
  };

  try {
    await pool.query(
      `
        insert into brain.sync_events (
          brain_id,
          event_type,
          filename,
          duration_ms,
          metadata,
          created_at
        )
        values ($1, $2, null, $3, $4::jsonb, now())
      `,
      [
        process.env.BRAIN_ID || "ai-brain-jem",
        HOSTED_MCP_AUTH_EVENT_TYPE,
        Math.max(0, Number(input.durationMs.toFixed(3))),
        JSON.stringify(metadata),
      ]
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[auth-telemetry] Could not record auth event: ${message.slice(0, 180)}`);
    return;
  }

  // Best-effort, non-blocking alert evaluation. Gated on a Slack bot token, so
  // it is a no-op unless hosted alerting is configured; it never adds latency to
  // or throws into the auth path. Set BRAIN_AUTH_ALERT_AWAIT=1 for diagnostics.
  const alert = maybeAlertOnAuthFailure();
  if (process.env.BRAIN_AUTH_ALERT_AWAIT === "1") {
    await alert.catch(() => undefined);
  } else {
    void Promise.resolve(alert).catch(() => undefined);
  }
}

export function recordAuthEventBestEffort(input: {
  name: string;
  reason: string;
  httpStatus: number;
  durationMs: number;
  target?: string | null;
  clientId?: string | null;
  grantType?: string | null;
}): Promise<void> | void {
  const write = recordAuthEvent(input);
  if (process.env.BRAIN_HOSTED_MCP_AUTH_AWAIT_DB_WRITE === "1") return write;
  write.catch(() => undefined);
  return undefined;
}
