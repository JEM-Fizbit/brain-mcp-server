import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { buildContextNudges } = await import(
  path.join(__dirname, "..", "dist", "services", "context-nudges.js")
);
const { summarizeCaptureQueue } = await import(
  path.join(__dirname, "..", "dist", "services", "task-intake.js")
);
const { parseLastOpDate } = await import(
  path.join(__dirname, "..", "dist", "services", "log.js")
);

const NOW = new Date("2026-08-24T12:00:00Z");

function inputs(overrides = {}) {
  return {
    lastLint: NOW,
    lintKnown: true,
    issues: [],
    inboxCount: null,
    captureQueue: null,
    ...overrides,
  };
}

test("a healthy Brain produces no nudges at all", () => {
  assert.deepEqual(buildContextNudges(inputs(), NOW), []);
});

test("lint staleness fires only past the threshold", () => {
  const fresh = buildContextNudges(
    inputs({ lastLint: new Date("2026-08-01T00:00:00Z") }),
    NOW
  );
  assert.deepEqual(fresh, [], "23 days is inside the 30-day threshold");

  const stale = buildContextNudges(
    inputs({ lastLint: new Date("2026-06-01T00:00:00Z") }),
    NOW
  );
  assert.ok(
    stale.some((line) => line.includes("Last brain_lint was 84 days ago")),
    `expected a staleness nudge, got ${JSON.stringify(stale)}`
  );
});

test("a never-linted Brain is nudged, but an unreadable log is not", () => {
  const never = buildContextNudges(
    inputs({ lastLint: null, lintKnown: true }),
    NOW
  );
  assert.ok(never.some((line) => line.includes("has never been run")));

  // LOG.md unreadable: absence of evidence is not evidence of never linting.
  const unknown = buildContextNudges(
    inputs({ lastLint: null, lintKnown: false }),
    NOW
  );
  assert.deepEqual(unknown, []);
});

test("the inbox nudge distinguishes 'no host inbox' from 'inbox is empty'", () => {
  assert.deepEqual(
    buildContextNudges(inputs({ inboxCount: null }), NOW),
    [],
    "null means the backend has no host inbox — stay silent"
  );
  assert.deepEqual(
    buildContextNudges(inputs({ inboxCount: 0 }), NOW),
    [],
    "a real count of zero is also silent"
  );
  const pending = buildContextNudges(inputs({ inboxCount: 3 }), NOW);
  assert.ok(pending.some((line) => line.includes("3 file(s) pending")));
});

test("open maintenance issues are listed with their numbers and urls", () => {
  const out = buildContextNudges(
    inputs({
      issues: [{ number: 42, title: "Stale sources index", url: "https://example.invalid/42" }],
    }),
    NOW
  );
  assert.ok(out.some((line) => line.includes("1 open Brain maintenance issue")));
  assert.ok(out.some((line) => line.includes("#42: Stale sources index")));
});

// The regression this whole change exists to prevent: a capture queue that
// breaches its thresholds every session while nothing ever says so.
test("a stale capture queue is surfaced at session start", () => {
  const tasks = [
    "# Tasks",
    "",
    "## Capture / Triage Queue",
    "",
    "- [ ] 2026-06-25 — NOTE — Something captured two months ago",
    "- [ ] 2026-08-23 — BUG — Something captured yesterday",
    "",
  ].join("\n");

  const status = summarizeCaptureQueue(tasks, NOW);
  assert.equal(status.openCount, 2);
  assert.equal(status.staleCount, 1);
  assert.equal(status.oldestOpenDays, 60);

  const out = buildContextNudges(inputs({ captureQueue: status }), NOW);
  const text = out.join("\n");
  assert.ok(text.includes("2 open item(s)"), text);
  assert.ok(text.includes("1 of them stale"), text);
  assert.ok(text.includes("oldest 60 days"), text);
  assert.ok(
    text.includes("transit, not an owner"),
    "the nudge should name the routing rule, not just the count"
  );
});

test("an empty or within-threshold capture queue stays silent", () => {
  const clean = [
    "# Tasks",
    "",
    "## Capture / Triage Queue",
    "",
    "*Queue empty.*",
    "",
  ].join("\n");
  assert.equal(summarizeCaptureQueue(clean, NOW), null);
  assert.deepEqual(buildContextNudges(inputs(), NOW), []);
});

test("parseLastOpDate reads the newest LINT entry from LOG.md content", () => {
  const logContent = [
    "# Log",
    "",
    "## [2026-08-20] LINT",
    "- pass",
    "",
    "## [2026-08-01] UPDATE",
    "- something",
    "",
    "## [2026-07-04] LINT",
    "- older pass",
  ].join("\n");

  assert.equal(
    parseLastOpDate(logContent, "LINT").toISOString().slice(0, 10),
    "2026-08-20"
  );
  assert.equal(parseLastOpDate("# Log\n\nno entries\n", "LINT"), null);
});
