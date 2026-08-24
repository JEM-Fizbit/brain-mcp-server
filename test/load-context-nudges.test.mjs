// Regression guard for the defect fixed alongside this test: brain_load_context
// routes through loadContextFromActiveStore, which returned loader + NOW.md and
// nothing else. The nudge-bearing brain.ts loadContext had been left with zero
// callers since the store abstraction landed, so every hosted session lost its
// lint / issues / inbox signals — and, transitively, the capture-queue warning,
// which is only computed inside an explicit brain_lint run.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "brain-load-context-"));
const brainDir = path.join(tmpDir, "brain");
await fs.mkdir(brainDir, { recursive: true });

const BRAIN = "nudge-test-brain";
process.env.BRAIN_DIR = brainDir;
process.env.BRAIN_ID = BRAIN;
process.env.BRAIN_DATE_TIME_ZONE = "UTC";
// Point the issue check at a repo that cannot resolve so `gh` fails fast and
// the nudge block falls back to "no open issues" without a network dependency.
process.env.BRAIN_GITHUB_REPO = "invalid-owner-does-not-exist/nope";
delete process.env.BRAIN_PLATFORM_CONFIG;
delete process.env.BRAIN_REVISION_STORE;
delete process.env.BRAIN_EXPERIMENTAL_REVISION_STORE_FILE;

const { loadContextFromActiveStore } = await import(
  path.join(__dirname, "..", "dist", "services", "active-brain-store.js")
);

after(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

async function writeBrain({ tasks, log }) {
  await fs.writeFile(
    path.join(brainDir, "00_loader.md"),
    "# Loader\n\nRoute intents here.\n",
    "utf-8"
  );
  await fs.writeFile(
    path.join(brainDir, "NOW.md"),
    "# NOW\n\nCurrent priorities.\n",
    "utf-8"
  );
  if (tasks === null) {
    await fs.rm(path.join(brainDir, "TASKS.md"), { force: true });
  } else {
    await fs.writeFile(path.join(brainDir, "TASKS.md"), tasks, "utf-8");
  }
  if (log === null) {
    await fs.rm(path.join(brainDir, "LOG.md"), { force: true });
  } else {
    await fs.writeFile(path.join(brainDir, "LOG.md"), log, "utf-8");
  }
}

const CLEAN_TASKS = [
  "# Tasks",
  "",
  "## Capture / Triage Queue",
  "",
  "*Queue empty.*",
  "",
].join("\n");

const STALE_TASKS = [
  "# Tasks",
  "",
  "## Capture / Triage Queue",
  "",
  "- [ ] 2026-01-05 — NOTE — An item nobody ever routed",
  "- [ ] 2026-01-06 — BUG — Another one",
  "",
].join("\n");

function freshLog() {
  const today = new Date().toISOString().slice(0, 10);
  return `# Log\n\n## [${today}] LINT\n- pass\n`;
}

test("core files are always returned", async () => {
  await writeBrain({ tasks: CLEAN_TASKS, log: freshLog() });
  const out = await loadContextFromActiveStore(BRAIN);
  assert.ok(out.includes("--- FILE: 00_loader.md ---"));
  assert.ok(out.includes("Route intents here."));
  assert.ok(out.includes("--- FILE: NOW.md ---"));
  assert.ok(out.includes("Current priorities."));
});

test("a healthy Brain gets its context with no nudge noise", async () => {
  await writeBrain({ tasks: CLEAN_TASKS, log: freshLog() });
  const out = await loadContextFromActiveStore(BRAIN);
  assert.ok(!out.includes("⚠️"), out);
  assert.ok(!out.includes("🗂️"), out);
});

test("a stale capture queue reaches the session bootstrap", async () => {
  await writeBrain({ tasks: STALE_TASKS, log: freshLog() });
  const out = await loadContextFromActiveStore(BRAIN);
  assert.ok(
    out.includes("Capture / Triage Queue has 2 open item(s)"),
    `capture queue nudge missing from bootstrap:\n${out}`
  );
  assert.ok(out.includes("2 of them stale"), out);
});

test("a Brain that has never been linted is nudged to run brain_lint", async () => {
  await writeBrain({ tasks: CLEAN_TASKS, log: "# Log\n\nNo operations yet.\n" });
  const out = await loadContextFromActiveStore(BRAIN);
  assert.ok(out.includes("brain_lint has never been run"), out);
});

test("a missing LOG.md does not fabricate a never-linted claim", async () => {
  await writeBrain({ tasks: CLEAN_TASKS, log: null });
  const out = await loadContextFromActiveStore(BRAIN);
  assert.ok(!out.includes("brain_lint has never been run"), out);
  assert.ok(out.includes("--- FILE: NOW.md ---"), "core context still returned");
});

test("a missing TASKS.md degrades quietly rather than throwing", async () => {
  await writeBrain({ tasks: null, log: freshLog() });
  const out = await loadContextFromActiveStore(BRAIN);
  assert.ok(out.includes("--- FILE: NOW.md ---"));
  assert.ok(!out.includes("🗂️"), out);
});

test("a Brain missing its loader still fails loudly", async () => {
  await writeBrain({ tasks: CLEAN_TASKS, log: freshLog() });
  await fs.rm(path.join(brainDir, "00_loader.md"));
  await assert.rejects(
    () => loadContextFromActiveStore(BRAIN),
    /Missing required Brain files: 00_loader\.md/
  );
});
