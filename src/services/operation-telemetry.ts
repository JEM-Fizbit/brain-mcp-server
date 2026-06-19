import { AsyncLocalStorage } from "node:async_hooks";
import { performance } from "node:perf_hooks";
import type pg from "pg";

type Queryable = {
  query: (...args: unknown[]) => Promise<unknown>;
};

type ConnectablePool = pg.Pool & {
  __brainTelemetryInstrumented?: boolean;
  query: (...args: unknown[]) => Promise<unknown>;
  connect: (...args: unknown[]) => Promise<pg.PoolClient>;
};

type InstrumentableClient = pg.PoolClient & {
  __brainTelemetryInstrumented?: boolean;
  query: (...args: unknown[]) => Promise<unknown>;
};

export interface DbTelemetrySpan {
  name: string;
  operation: string;
  target: string | null;
  durationMs: number;
  ok: boolean;
  rowCount: number | null;
  error: string | null;
}

export interface DbTelemetrySummary {
  queryCount: number;
  totalMs: number;
  averageMs: number | null;
  maxMs: number | null;
  rowCount: number;
  failedCount: number;
  truncatedCount: number;
  spans: DbTelemetrySpan[];
}

interface OperationTelemetryContext {
  dbSpans: DbTelemetrySpan[];
  maxDbSpans: number;
  truncatedDbSpans: number;
}

const contextStorage = new AsyncLocalStorage<OperationTelemetryContext>();

function maxDbSpans(): number {
  return Math.max(0, Number(process.env.BRAIN_HOSTED_MCP_DB_SPAN_LIMIT || 24));
}

function rounded(value: number): number {
  return Number(value.toFixed(3));
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 180);
}

function queryText(query: unknown): string {
  if (typeof query === "string") return query;
  if (query && typeof query === "object") {
    const text = (query as { text?: unknown }).text;
    if (typeof text === "string") return text;
  }
  return "";
}

function sqlOperation(sql: string): string {
  const match = sql.trim().match(/^([a-z]+)/i);
  return match ? match[1].toLowerCase() : "query";
}

function sqlTargets(sql: string): string[] {
  const targets = new Set<string>();
  const normalized = sql.replace(/\s+/g, " ");
  const patterns = [
    /\bfrom\s+(brain\.[a-z_]+)/gi,
    /\bjoin\s+(brain\.[a-z_]+)/gi,
    /\binto\s+(brain\.[a-z_]+)/gi,
    /\bupdate\s+(brain\.[a-z_]+)/gi,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(normalized))) {
      targets.add(match[1].toLowerCase());
    }
  }
  return [...targets].slice(0, 4);
}

function spanDescriptor(query: unknown, label: string): Pick<DbTelemetrySpan, "name" | "operation" | "target"> {
  const sql = queryText(query);
  const operation = sqlOperation(sql);
  const targets = sqlTargets(sql);
  const target = targets.length ? targets.join("+") : null;
  const name = target ? `${label}.${operation}:${target}` : `${label}.${operation}`;
  return { name, operation, target };
}

function resultRowCount(result: unknown): number | null {
  if (result && typeof result === "object") {
    const rowCount = (result as { rowCount?: unknown }).rowCount;
    if (typeof rowCount === "number" && Number.isFinite(rowCount)) return rowCount;
  }
  return null;
}

function recordDbSpan(span: DbTelemetrySpan): void {
  const context = contextStorage.getStore();
  if (!context) return;
  if (context.dbSpans.length >= context.maxDbSpans) {
    context.truncatedDbSpans += 1;
    return;
  }
  context.dbSpans.push(span);
}

async function timedQuery<T>(
  label: string,
  query: unknown,
  fn: () => Promise<T>
): Promise<T> {
  const context = contextStorage.getStore();
  if (!context) return fn();

  const descriptor = spanDescriptor(query, label);
  const startedAt = performance.now();
  try {
    const result = await fn();
    recordDbSpan({
      ...descriptor,
      durationMs: rounded(performance.now() - startedAt),
      ok: true,
      rowCount: resultRowCount(result),
      error: null,
    });
    return result;
  } catch (error) {
    recordDbSpan({
      ...descriptor,
      durationMs: rounded(performance.now() - startedAt),
      ok: false,
      rowCount: null,
      error: errorMessage(error),
    });
    throw error;
  }
}

function instrumentClient(client: pg.PoolClient, label: string): pg.PoolClient {
  const instrumentable = client as InstrumentableClient;
  if (instrumentable.__brainTelemetryInstrumented) return client;
  const originalQuery = instrumentable.query.bind(client);
  instrumentable.query = ((...args: unknown[]) =>
    timedQuery(label, args[0], () => originalQuery(...args))) as InstrumentableClient["query"];
  instrumentable.__brainTelemetryInstrumented = true;
  return client;
}

export function instrumentPostgresPool(pool: pg.Pool, label = "postgres"): pg.Pool {
  const instrumentable = pool as ConnectablePool;
  if (instrumentable.__brainTelemetryInstrumented) return pool;

  const originalQuery = instrumentable.query.bind(pool);
  const originalConnect = instrumentable.connect.bind(pool);

  instrumentable.query = ((...args: unknown[]) =>
    timedQuery(label, args[0], () => originalQuery(...args))) as ConnectablePool["query"];

  instrumentable.connect = (async (...args: unknown[]) => {
    const client = await originalConnect(...args);
    return instrumentClient(client, label);
  }) as ConnectablePool["connect"];

  instrumentable.__brainTelemetryInstrumented = true;
  return pool;
}

export function createOperationTelemetryContext(): OperationTelemetryContext {
  return {
    dbSpans: [],
    maxDbSpans: maxDbSpans(),
    truncatedDbSpans: 0,
  };
}

export async function runWithOperationTelemetry<T>(
  context: OperationTelemetryContext,
  fn: () => Promise<T>
): Promise<T> {
  return contextStorage.run(context, fn);
}

export function summarizeOperationTelemetry(
  context: OperationTelemetryContext
): { db: DbTelemetrySummary } {
  const queryCount = context.dbSpans.length + context.truncatedDbSpans;
  const totalMs = rounded(
    context.dbSpans.reduce((total, span) => total + span.durationMs, 0)
  );
  const maxMs = context.dbSpans.length
    ? Math.max(...context.dbSpans.map((span) => span.durationMs))
    : null;
  const rowCount = context.dbSpans.reduce(
    (total, span) => total + (span.rowCount || 0),
    0
  );
  const failedCount = context.dbSpans.filter((span) => !span.ok).length;

  return {
    db: {
      queryCount,
      totalMs,
      averageMs: context.dbSpans.length ? rounded(totalMs / context.dbSpans.length) : null,
      maxMs: maxMs === null ? null : rounded(maxMs),
      rowCount,
      failedCount,
      truncatedCount: context.truncatedDbSpans,
      spans: context.dbSpans,
    },
  };
}
