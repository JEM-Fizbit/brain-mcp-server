import { performance } from "node:perf_hooks";
import pg from "pg";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type {
  CallToolResult,
  ServerNotification,
  ServerRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { revisionStoreProvider } from "./active-brain-store.js";
import { attachPoolErrorLogger } from "./pg-pool.js";
import { resolveToolBrain } from "./request-context.js";
import {
  createOperationTelemetryContext,
  runWithOperationTelemetry,
  summarizeOperationTelemetry,
  type DbTelemetrySummary,
} from "./operation-telemetry.js";

const { Pool } = pg;

export const HOSTED_MCP_LATENCY_EVENT_TYPE = "hosted_mcp_latency";

type ToolExtra = RequestHandlerExtra<ServerRequest, ServerNotification> | undefined;
type ToolCallbackLike = (argsOrExtra: unknown, maybeExtra?: unknown) => unknown;

let poolCache:
  | {
      key: string;
      pool: pg.Pool;
    }
  | undefined;

function telemetryEnabled(): boolean {
  return (
    process.env.TRANSPORT === "http" &&
    revisionStoreProvider() === "postgres" &&
    Boolean(process.env.BRAIN_REVISION_DATABASE_URL) &&
    process.env.BRAIN_HOSTED_MCP_LATENCY_DB_WRITE !== "0"
  );
}

function telemetryPool(): pg.Pool | null {
  const connectionString = process.env.BRAIN_REVISION_DATABASE_URL;
  if (!connectionString) return null;
  if (poolCache?.key === connectionString) return poolCache.pool;
  poolCache?.pool.end().catch(() => undefined);
  poolCache = {
    key: connectionString,
    pool: attachPoolErrorLogger(
      new Pool({
        connectionString,
        allowExitOnIdle: true,
        connectionTimeoutMillis: 3000,
        max: 2,
        query_timeout: 3000,
        statement_timeout: 3000,
      }),
      "tool_telemetry"
    ),
  };
  return poolCache.pool;
}

export async function closeToolTelemetryForTests(): Promise<void> {
  const pool = poolCache?.pool;
  poolCache = undefined;
  await pool?.end().catch(() => undefined);
}

export function classifyToolOperation(toolName: string, args: unknown): string {
  if (toolName === "brain_prepare_ingest") return "read";
  if (
    toolName === "brain_update_file" ||
    toolName === "brain_resolve_conflict" ||
    toolName === "brain_commit" ||
    toolName === "brain_log" ||
    toolName === "brain_ingest_complete" ||
    toolName === "brain_semantic_index" ||
    toolName === "brain_lint"
  ) {
    return "write";
  }
  if (toolName === "brain_ingest") {
    return args && typeof args === "object" && (args as { dry_run?: unknown }).dry_run === false
      ? "write"
      : "operation";
  }
  if (/_(read|load|list|search|status|describe|scan)/.test(toolName)) return "read";
  return "operation";
}

function safeString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function safeFilename(value: unknown): string | null {
  const filename = safeString(value);
  if (!filename) return null;
  if (!filename.endsWith(".md")) return null;
  if (filename.startsWith("/") || filename.includes("..")) return null;
  return filename;
}

export function targetForToolOperation(toolName: string, args: unknown): string | null {
  if (!args || typeof args !== "object") return toolName;
  const input = args as Record<string, unknown>;
  return (
    safeFilename(input.filename) ||
    safeString(input.conflict_id) ||
    safeString(input.category) ||
    safeString(input.scope) ||
    safeString(input.brain_id) ||
    (typeof input.query === "string" ? "query" : null) ||
    (typeof input.source_label === "string" ? "source_label" : null) ||
    toolName
  );
}

function filenameForToolOperation(args: unknown): string | null {
  return args && typeof args === "object"
    ? safeFilename((args as Record<string, unknown>).filename)
    : null;
}

function toolReturnedError(result: unknown): result is CallToolResult & { isError: true } {
  return Boolean(result && typeof result === "object" && (result as CallToolResult).isError);
}

function errorMessage(error: unknown): string | null {
  if (!error) return null;
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 500);
}

async function telemetryBrainId(args: unknown, extra: ToolExtra): Promise<string | null> {
  try {
    const input = args && typeof args === "object" ? (args as { brain_id?: unknown }) : {};
    const requestedBrainId = typeof input.brain_id === "string" ? input.brain_id : undefined;
    const ctx = await resolveToolBrain(requestedBrainId, extra);
    return ctx.brainId;
  } catch {
    return null;
  }
}

async function recordToolLatency(input: {
  toolName: string;
  args: unknown;
  extra: ToolExtra;
  durationMs: number;
  ok: boolean;
  error?: string | null;
  dbTelemetry?: DbTelemetrySummary;
}): Promise<void> {
  if (!telemetryEnabled()) return;
  const pool = telemetryPool();
  if (!pool) return;
  const brainId = await telemetryBrainId(input.args, input.extra);
  if (!brainId) return;

  const kind = classifyToolOperation(input.toolName, input.args);
  const target = targetForToolOperation(input.toolName, input.args);
  const metadata = {
    version: 3,
    source: "hosted_mcp_server",
    timingLayer: "server_tool",
    durationType: "server_tool_handler",
    name: input.toolName,
    kind,
    target,
    ok: input.ok,
    error: input.error || null,
    db: input.dbTelemetry || null,
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
        values ($1, $2, $3, $4, $5::jsonb, now())
      `,
      [
        brainId,
        HOSTED_MCP_LATENCY_EVENT_TYPE,
        filenameForToolOperation(input.args),
        Math.max(0, Number(input.durationMs.toFixed(3))),
        JSON.stringify(metadata),
      ]
    );
  } catch (error) {
    console.warn(
      `[tool-telemetry] Could not record hosted MCP latency: ${errorMessage(error)}`
    );
  }
}

function recordToolLatencyBestEffort(input: {
  toolName: string;
  args: unknown;
  extra: ToolExtra;
  durationMs: number;
  ok: boolean;
  error?: string | null;
  dbTelemetry?: DbTelemetrySummary;
}): Promise<void> | void {
  const write = recordToolLatency(input);
  if (process.env.BRAIN_HOSTED_MCP_LATENCY_AWAIT_DB_WRITE === "1") return write;
  write.catch(() => undefined);
  return undefined;
}

function wrapToolCallback(toolName: string, callback: ToolCallbackLike): ToolCallbackLike {
  return async (argsOrExtra: unknown, maybeExtra?: unknown) => {
    const startedAt = performance.now();
    const telemetryContext = createOperationTelemetryContext();
    const hasArgs = maybeExtra !== undefined;
    const args = hasArgs ? argsOrExtra : {};
    const extra = (hasArgs ? maybeExtra : argsOrExtra) as ToolExtra;
    let result: unknown;
    let thrown: unknown;

    try {
      result = await runWithOperationTelemetry(telemetryContext, () =>
        Promise.resolve(callback(argsOrExtra, maybeExtra))
      );
      return result;
    } catch (error) {
      thrown = error;
      throw error;
    } finally {
      const isErrorResult = toolReturnedError(result);
      const operationTelemetry = summarizeOperationTelemetry(telemetryContext);
      const maybeWrite = recordToolLatencyBestEffort({
        toolName,
        args,
        extra,
        durationMs: performance.now() - startedAt,
        ok: !thrown && !isErrorResult,
        error: thrown ? errorMessage(thrown) : isErrorResult ? "tool_returned_error" : null,
        dbTelemetry: operationTelemetry.db,
      });
      if (maybeWrite) await maybeWrite;
    }
  };
}

export function instrumentToolLatency(server: McpServer): void {
  const originalTool = server.tool.bind(server) as (name: string, ...rest: unknown[]) => unknown;
  const patchedTool = (name: string, ...rest: unknown[]) => {
    const callback = rest[rest.length - 1];
    if (typeof callback === "function") {
      rest[rest.length - 1] = wrapToolCallback(name, callback as ToolCallbackLike);
    }
    return originalTool(name, ...rest);
  };

  (server as unknown as { tool: typeof patchedTool }).tool = patchedTool;
}
