import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const {
  classifyToolOperation,
  targetForToolOperation,
} = await import(path.join(__dirname, "..", "dist", "services", "tool-telemetry.js"));
const {
  createOperationTelemetryContext,
  instrumentPostgresPool,
  runWithOperationTelemetry,
  summarizeOperationTelemetry,
  unionSpanMs,
} = await import(path.join(__dirname, "..", "dist", "services", "operation-telemetry.js"));
const { authReasonCode } = await import(
  path.join(__dirname, "..", "dist", "services", "auth-telemetry.js")
);

test("tool telemetry classifies hosted MCP reads and writes", () => {
  assert.equal(classifyToolOperation("brain_read_file", {}), "read");
  assert.equal(classifyToolOperation("brain_search", { query: "private query" }), "read");
  assert.equal(classifyToolOperation("brain_update_file", {}), "write");
  assert.equal(classifyToolOperation("brain_resolve_conflict", {}), "write");
  assert.equal(classifyToolOperation("brain_log", {}), "write");
  assert.equal(classifyToolOperation("brain_lint", {}), "write");
  assert.equal(classifyToolOperation("brain_prepare_ingest", {}), "read");
  assert.equal(classifyToolOperation("brain_ingest", { dry_run: true }), "operation");
  assert.equal(classifyToolOperation("brain_ingest", { dry_run: false }), "write");
});

test("tool telemetry targets avoid recording payload content", () => {
  assert.equal(
    targetForToolOperation("brain_update_file", {
      filename: "NOW.md",
      content: "do not persist this content in telemetry",
    }),
    "NOW.md"
  );
  assert.equal(
    targetForToolOperation("brain_search", {
      query: "do not persist this query in telemetry",
    }),
    "query"
  );
  assert.equal(
    targetForToolOperation("brain_ingest_complete", {
      source_label: "Sensitive source title",
      md_file: "sources/personal/private.md",
    }),
    "source_label"
  );
});

// Faithful stand-in for node-postgres: `Pool.query` acquires a client through
// `this.connect` and runs the SQL on it. Spec 019 phase 2 instruments
// acquisition rather than `pool.query`, so a fake whose query bypasses connect
// would no longer model the real code path.
function fakePool(handler = async () => ({ rowCount: 2, rows: [{ id: 1 }, { id: 2 }] })) {
  const client = { async query(sql, values) { return handler(sql, values); } };
  return {
    connect(callback) {
      if (typeof callback === "function") {
        callback(null, client, () => undefined);
        return undefined;
      }
      return Promise.resolve(client);
    },
    query(sql, values) {
      return new Promise((resolve, reject) => {
        this.connect((error, connected) => {
          if (error) return reject(error);
          connected.query(sql, values).then(resolve, reject);
        });
      });
    },
  };
}

test("postgres operation telemetry records sanitized DB spans", async () => {
  const pool = instrumentPostgresPool(fakePool(), "brain_runtime");
  const context = createOperationTelemetryContext();

  await runWithOperationTelemetry(context, async () => {
    await pool.query(
      "select content from brain.brain_file_revisions where content = $1",
      ["private search term"]
    );
  });

  const summary = summarizeOperationTelemetry(context);
  assert.equal(summary.db.queryCount, 1);
  assert.equal(summary.db.rowCount, 2);
  const querySpan = summary.db.spans.find((span) => span.kind === "query");
  assert.equal(querySpan.operation, "select");
  assert.equal(querySpan.target, "brain.brain_file_revisions");
  assert.doesNotMatch(JSON.stringify(summary), /private search term|select content/);
});

test("postgres pool instrumentation preserves callback-style connect", async () => {
  const pool = instrumentPostgresPool(
    fakePool(async () => ({ rowCount: 1, rows: [{ id: 1 }] })),
    "brain_runtime"
  );
  const context = createOperationTelemetryContext();

  await runWithOperationTelemetry(context, async () => {
    await pool.query("select * from brain.brain_files");
  });

  const summary = summarizeOperationTelemetry(context);
  assert.equal(summary.db.queryCount, 1);
  assert.equal(
    summary.db.spans.find((span) => span.kind === "query").target,
    "brain.brain_files"
  );
});

test("auth telemetry reason codes are sanitized", () => {
  assert.equal(
    authReasonCode("missing Authorization: Bearer header"),
    "missing_bearer"
  );
  assert.equal(authReasonCode("token expired"), "token_expired");
  assert.equal(
    authReasonCode("identity provider is not enabled"),
    "provider_disabled"
  );
  assert.equal(authReasonCode("invalid_grant"), "invalid_grant");
  assert.equal(
    authReasonCode("oauth failed for Bearer secret-token with spaces"),
    "auth_failed"
  );
});

// --- Spec 019 phase 2: acquisition spans, concurrency, wall time ---

test("node-postgres still routes Pool.query through connect", async () => {
  // Load-bearing upstream assumption. Instrumenting acquisition instead of
  // pool.query only captures pool.query's SQL because node-postgres implements
  // query as connect-then-query. If a pg upgrade changes that, telemetry would
  // silently go blank; this test fails loudly instead.
  const pg = (await import("pg")).default;
  const source = pg.Pool.prototype.query.toString();
  assert.match(source, /this\.connect\(/);
});

test("connection acquisition is measured apart from the SQL", async () => {
  const pool = instrumentPostgresPool(fakePool(), "brain_runtime");
  const context = createOperationTelemetryContext();
  await runWithOperationTelemetry(context, async () => {
    await pool.query("select 1 from brain.brain_files");
  });

  const summary = summarizeOperationTelemetry(context);
  const acquire = summary.db.spans.find((span) => span.kind === "acquire");
  assert.ok(acquire, "a first-time acquisition should be recorded");
  assert.equal(acquire.operation, "acquire");
  assert.equal(acquire.target, "connection.new");
  assert.equal(summary.db.newConnections, 1);
  // queryCount stays the count of SQL statements, not of spans.
  assert.equal(summary.db.queryCount, 1);
  assert.equal(summary.db.acquireCount, 1);
});

test("a pooled re-acquisition does not spend the span budget", async () => {
  const pool = instrumentPostgresPool(fakePool(), "brain_runtime");
  const context = createOperationTelemetryContext();
  await runWithOperationTelemetry(context, async () => {
    await pool.query("select 1 from brain.brain_files");
    await pool.query("select 2 from brain.brain_files");
    await pool.query("select 3 from brain.brain_files");
  });

  const summary = summarizeOperationTelemetry(context);
  assert.equal(summary.db.queryCount, 3);
  // Only the first acquisition opened a connection; the rest reused it and
  // cost nothing worth a span.
  assert.equal(summary.db.newConnections, 1);
  assert.equal(summary.db.acquireCount, 1);
});

test("wall time counts overlapping spans once and sequential spans in full", () => {
  assert.equal(
    unionSpanMs([
      { startOffsetMs: 0, durationMs: 530 },
      { startOffsetMs: 2, durationMs: 528 },
    ]),
    530
  );
  assert.equal(
    unionSpanMs([
      { startOffsetMs: 0, durationMs: 100 },
      { startOffsetMs: 100, durationMs: 100 },
    ]),
    200
  );
  // A gap between spans is not database time.
  assert.equal(
    unionSpanMs([
      { startOffsetMs: 0, durationMs: 50 },
      { startOffsetMs: 500, durationMs: 50 },
    ]),
    100
  );
  assert.equal(unionSpanMs([]), 0);
});

test("a concurrent fan-out reports wall time below the summed span total", async () => {
  const pool = instrumentPostgresPool(
    fakePool(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      return { rowCount: 1, rows: [{ id: 1 }] };
    }),
    "brain_runtime"
  );
  const context = createOperationTelemetryContext();
  await runWithOperationTelemetry(context, async () => {
    await Promise.all([
      pool.query("select 1 from brain.brain_files"),
      pool.query("select 2 from brain.sync_conflicts"),
      pool.query("select 3 from brain.brain_files"),
    ]);
  });

  const summary = summarizeOperationTelemetry(context);
  assert.equal(summary.db.queryCount, 3);
  // This is the reading that produced "1072ms of DB spans in a 544ms handler".
  assert.ok(
    summary.db.wallMs < summary.db.totalMs,
    `wallMs ${summary.db.wallMs} should be below totalMs ${summary.db.totalMs}`
  );
  assert.ok(summary.db.spans.every((span) => span.startOffsetMs >= 0));
});

// --- Spec 019 phase 3: connection warmth ---

test("pool options keep connections alive and default to holding none", async () => {
  const { postgresPoolOptions } = await import("../dist/sync/postgres-revision-store.js");
  const previous = { ...process.env };
  try {
    delete process.env.BRAIN_PG_POOL_MIN;
    delete process.env.BRAIN_PG_KEEPALIVE;
    const options = postgresPoolOptions("postgresql://u:p@example.invalid:6543/postgres");
    // keepAlive is a prerequisite for holding a connection: without it a
    // silently dropped socket is handed to the next caller and stalls for the
    // full query timeout.
    assert.equal(options.keepAlive, true);
    assert.ok(options.keepAliveInitialDelayMillis > 0);
    // Default 0 so CLI and script pools keep their current exit behaviour.
    assert.equal(options.min, 0);

    process.env.BRAIN_PG_POOL_MIN = "1";
    assert.equal(
      postgresPoolOptions("postgresql://u:p@example.invalid:6543/postgres").min,
      1
    );

    process.env.BRAIN_PG_KEEPALIVE = "0";
    assert.equal(
      postgresPoolOptions("postgresql://u:p@example.invalid:6543/postgres").keepAlive,
      false
    );
  } finally {
    process.env = previous;
  }
});

test("the hosted deployment keeps pooled connections past the default", async () => {
  // A/B measured on the live deployment: the idle timeout is what retains a
  // connection; pg-pool "min" made no difference and must not be set here in
  // the belief that it does.
  const fs = await import("node:fs/promises");
  const flyToml = await fs.readFile(new URL("../fly.toml", import.meta.url), "utf-8");
  assert.match(flyToml, /BRAIN_PG_IDLE_TIMEOUT_MS = "120000"/);
  assert.doesNotMatch(flyToml, /BRAIN_PG_POOL_MIN/);
});
