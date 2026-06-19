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
} = await import(path.join(__dirname, "..", "dist", "services", "operation-telemetry.js"));

test("tool telemetry classifies hosted MCP reads and writes", () => {
  assert.equal(classifyToolOperation("brain_read_file", {}), "read");
  assert.equal(classifyToolOperation("brain_search", { query: "private query" }), "read");
  assert.equal(classifyToolOperation("brain_update_file", {}), "write");
  assert.equal(classifyToolOperation("brain_resolve_conflict", {}), "write");
  assert.equal(classifyToolOperation("brain_log", {}), "write");
  assert.equal(classifyToolOperation("brain_lint", {}), "write");
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

test("postgres operation telemetry records sanitized DB spans", async () => {
  const pool = instrumentPostgresPool(
    {
      async query(_sql, _values) {
        return { rowCount: 2, rows: [{ id: 1 }, { id: 2 }] };
      },
      async connect() {
        throw new Error("not used");
      },
    },
    "brain_runtime"
  );
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
  assert.equal(summary.db.spans[0].operation, "select");
  assert.equal(summary.db.spans[0].target, "brain.brain_file_revisions");
  assert.doesNotMatch(JSON.stringify(summary), /private search term|select content/);
});
