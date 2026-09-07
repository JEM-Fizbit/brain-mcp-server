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
  /**
   * Milliseconds from the start of the tool handler to the start of this span
   * (spec 019 phase 2). Without it, concurrent spans are indistinguishable from
   * sequential ones and their durations can only be summed — which overstates
   * elapsed database time whenever a handler fans out.
   */
  startOffsetMs: number;
  /**
   * Connection acquisition, not SQL. Acquisition used to be billed to whichever
   * SELECT happened to trigger it, because `pool.query` connects before it
   * queries — so a span read as "this table was slow" when the real cost was a
   * TCP/TLS/SCRAM handshake, or a wait for a free client.
   */
  kind: "query" | "acquire";
}

export interface DbTelemetrySummary {
  queryCount: number;
  totalMs: number;
  /**
   * Union of span intervals: the database-attributable critical path. `totalMs`
   * sums spans and therefore double-counts concurrency; `wallMs` cannot exceed
   * the handler duration. Both are reported because neither alone is honest —
   * the sum answers "how much database work", the union "how long it took".
   */
  wallMs: number;
  averageMs: number | null;
  maxMs: number | null;
  rowCount: number;
  failedCount: number;
  truncatedCount: number;
  acquireCount: number;
  acquireMs: number;
  newConnections: number;
  spans: DbTelemetrySpan[];
}

interface OperationTelemetryContext {
  dbSpans: DbTelemetrySpan[];
  maxDbSpans: number;
  truncatedDbSpans: number;
  startedAt: number;
  newConnections: number;
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

function startOffset(context: OperationTelemetryContext, startedAt: number): number {
  return rounded(Math.max(0, startedAt - context.startedAt));
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
      kind: "query",
      startOffsetMs: startOffset(context, startedAt),
      durationMs: rounded(performance.now() - startedAt),
      ok: true,
      rowCount: resultRowCount(result),
      error: null,
    });
    return result;
  } catch (error) {
    recordDbSpan({
      ...descriptor,
      kind: "query",
      startOffsetMs: startOffset(context, startedAt),
      durationMs: rounded(performance.now() - startedAt),
      ok: false,
      rowCount: null,
      error: errorMessage(error),
    });
    throw error;
  }
}

/**
 * Acquisition spans are noisy: most acquisitions hand back an already-open
 * idle client in well under a millisecond. Record one only when it cost
 * something — a brand-new connection (handshake) or a measurable wait for a
 * free client (pool saturation) — so the bounded span budget is spent on the
 * acquisitions that explain latency rather than on hundreds of no-ops.
 */
const ACQUIRE_SPAN_MIN_MS = 2;

function recordAcquireSpan(
  label: string,
  startedAt: number,
  isNewConnection: boolean,
  error: unknown
): void {
  const context = contextStorage.getStore();
  if (!context) return;
  const durationMs = rounded(performance.now() - startedAt);
  if (isNewConnection) context.newConnections += 1;
  if (!error && !isNewConnection && durationMs < ACQUIRE_SPAN_MIN_MS) return;
  recordDbSpan({
    name: `${label}.acquire`,
    operation: "acquire",
    target: isNewConnection ? "connection.new" : "connection.pooled",
    kind: "acquire",
    startOffsetMs: startOffset(context, startedAt),
    durationMs,
    ok: !error,
    rowCount: null,
    error: error ? errorMessage(error) : null,
  });
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

/**
 * Instrument acquisition rather than `pool.query`.
 *
 * node-postgres implements `Pool.query` as `this.connect()` followed by
 * `client.query()`, so wrapping `pool.query` produced a single span covering
 * both and attributed the connection cost to the SQL. Patching `connect` — in
 * both its promise and callback forms, since `Pool.query` uses the callback
 * form internally — lets each `pool.query` emit an acquire span plus a query
 * span, and gives the explicit `pool.connect()` transaction path the same
 * accounting instead of silently omitting its acquisition.
 */
export function instrumentPostgresPool(pool: pg.Pool, label = "postgres"): pg.Pool {
  const instrumentable = pool as ConnectablePool;
  if (instrumentable.__brainTelemetryInstrumented) return pool;

  const originalConnect = instrumentable.connect.bind(pool);

  instrumentable.connect = ((...args: unknown[]) => {
    const startedAt = performance.now();

    if (typeof args[0] === "function") {
      const callback = args[0] as (
        error: unknown,
        client?: pg.PoolClient,
        release?: unknown
      ) => void;
      return originalConnect(((
        error: unknown,
        client?: pg.PoolClient,
        release?: unknown
      ) => {
        const isNew = Boolean(client) && !isInstrumentedClient(client!);
        recordAcquireSpan(label, startedAt, isNew, error);
        callback(error, client ? instrumentClient(client, label) : client, release);
      }) as never);
    }

    return originalConnect(...args).then(
      (client: pg.PoolClient) => {
        const isNew = !isInstrumentedClient(client);
        recordAcquireSpan(label, startedAt, isNew, null);
        return instrumentClient(client, label);
      },
      (error: unknown) => {
        recordAcquireSpan(label, startedAt, false, error);
        throw error;
      }
    );
  }) as ConnectablePool["connect"];

  instrumentable.__brainTelemetryInstrumented = true;
  return pool;
}

function isInstrumentedClient(client: pg.PoolClient): boolean {
  return Boolean((client as InstrumentableClient).__brainTelemetryInstrumented);
}

export function createOperationTelemetryContext(): OperationTelemetryContext {
  return {
    dbSpans: [],
    maxDbSpans: maxDbSpans(),
    truncatedDbSpans: 0,
    startedAt: performance.now(),
    newConnections: 0,
  };
}

export async function runWithOperationTelemetry<T>(
  context: OperationTelemetryContext,
  fn: () => Promise<T>
): Promise<T> {
  return contextStorage.run(context, fn);
}

/**
 * Total length of the union of span intervals. Overlapping spans are counted
 * once, so a handler that runs two concurrent 530ms queries reports 540ms of
 * wall time rather than 1060ms of summed duration.
 */
export function unionSpanMs(spans: DbTelemetrySpan[]): number {
  if (!spans.length) return 0;
  const intervals = spans
    .map((span) => [span.startOffsetMs, span.startOffsetMs + span.durationMs])
    .sort((left, right) => left[0] - right[0]);
  let total = 0;
  let [currentStart, currentEnd] = intervals[0];
  for (const [start, end] of intervals.slice(1)) {
    if (start > currentEnd) {
      total += currentEnd - currentStart;
      currentStart = start;
      currentEnd = end;
      continue;
    }
    if (end > currentEnd) currentEnd = end;
  }
  return rounded(total + (currentEnd - currentStart));
}

export function summarizeOperationTelemetry(
  context: OperationTelemetryContext
): { db: DbTelemetrySummary } {
  // `queryCount` stays the count of SQL statements. Acquisitions are reported
  // separately so an existing consumer reading queryCount is not silently
  // handed a larger number that means something different.
  const querySpans = context.dbSpans.filter((span) => span.kind !== "acquire");
  const acquireSpans = context.dbSpans.filter((span) => span.kind === "acquire");
  const queryCount = querySpans.length + context.truncatedDbSpans;
  const totalMs = rounded(
    querySpans.reduce((total, span) => total + span.durationMs, 0)
  );
  const maxMs = querySpans.length
    ? Math.max(...querySpans.map((span) => span.durationMs))
    : null;
  const rowCount = querySpans.reduce(
    (total, span) => total + (span.rowCount || 0),
    0
  );
  const failedCount = context.dbSpans.filter((span) => !span.ok).length;

  return {
    db: {
      queryCount,
      totalMs,
      wallMs: unionSpanMs(context.dbSpans),
      averageMs: querySpans.length ? rounded(totalMs / querySpans.length) : null,
      maxMs: maxMs === null ? null : rounded(maxMs),
      rowCount,
      failedCount,
      truncatedCount: context.truncatedDbSpans,
      acquireCount: acquireSpans.length,
      acquireMs: rounded(
        acquireSpans.reduce((total, span) => total + span.durationMs, 0)
      ),
      newConnections: context.newConnections,
      spans: context.dbSpans,
    },
  };
}
