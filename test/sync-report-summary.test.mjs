import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { summarizeReport } = await import(
  path.join(__dirname, "..", "dist", "sync", "report-summary.js")
);

function baseReport(overrides = {}) {
  return {
    pushed: [],
    pulled: [],
    unchanged: [],
    conflicts: [],
    timings: [],
    deleted: [],
    deletionsSkipped: [],
    ...overrides,
  };
}

test("summary surfaces deleted files and their count", () => {
  const summary = summarizeReport(baseReport({ deleted: ["a.md", "b.md"] }));
  assert.equal(summary.deleted, 2);
  assert.deepEqual(summary.deletedFiles, ["a.md", "b.md"]);
});

test("summary surfaces a tripped guard so a skipped mass-delete is never silent", () => {
  const summary = summarizeReport(
    baseReport({
      deletionsSkipped: ["x.md", "y.md"],
      guardTripped: "mass_delete: 2 confirmed deletion(s) ...",
    })
  );
  assert.equal(summary.deletionsSkipped, 2);
  assert.deepEqual(summary.deletionsSkippedFiles, ["x.md", "y.md"]);
  assert.match(summary.guardTripped, /mass_delete/);
});

test("summary omits guardTripped when no guard fired", () => {
  const summary = summarizeReport(baseReport());
  assert.equal(summary.deleted, 0);
  assert.equal(summary.deletionsSkipped, 0);
  assert.equal(summary.guardTripped, undefined);
});
