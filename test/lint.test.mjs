import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "brain-lint-test-"));
process.env.BRAIN_DIR = tmpDir;

const { runLint, formatLintReport } = await import(
  path.join(__dirname, "..", "dist", "services", "lint.js")
);
const { FileRevisionStore } = await import(
  path.join(__dirname, "..", "dist", "sync", "index.js")
);

async function writeFixture(files) {
  const entries = await fs.readdir(tmpDir);
  for (const name of entries) {
    await fs.rm(path.join(tmpDir, name), { recursive: true, force: true });
  }
  for (const [name, content] of Object.entries(files)) {
    const full = path.join(tmpDir, name);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, "utf-8");
  }
}

const longBody = (lines) => Array.from({ length: lines }, (_, i) => `- line ${i + 1}`).join("\n");

test("bloat check exempts LOG.md and SOURCES.md", async () => {
  await writeFixture({
    "00_loader.md": "# Loader\n\nReferences: `01_identity.md`\n",
    "NOW.md": "# NOW\n",
    "LOG.md": longBody(250),
    "SOURCES.md": longBody(250),
    "01_identity.md": longBody(250),
  });

  const report = await runLint();
  const bloated = report.bloat.map((b) => b.file);

  assert.ok(!bloated.includes("LOG.md"), "LOG.md must not be flagged for bloat");
  assert.ok(!bloated.includes("SOURCES.md"), "SOURCES.md must not be flagged for bloat");
  assert.ok(bloated.includes("01_identity.md"), "content files must still be flagged");
});

test("drift check only flags projects under Active section", async () => {
  await writeFixture({
    "00_loader.md": "# Loader\n",
    "NOW.md": "# NOW\n\n- Working on Social-Creator-Claude this week.\n",
    "03_projects.md": [
      "# Projects",
      "",
      "## Software — Active Development",
      "",
      "### Social-Creator-Claude",
      "Active project mentioned in NOW.md.",
      "",
      "### MILADVector-Forgotten",
      "Active project NOT mentioned in NOW.md — should flag.",
      "",
      "## Live & Stable (Maintenance Mode)",
      "",
      "### PromptalisStable",
      "Stable, not in NOW.md — should NOT flag.",
      "",
      "## Concept / Early Stage",
      "",
      "### AethermereConcept",
      "Concept, not in NOW.md — should NOT flag.",
      "",
      "## Infrastructure & Tools",
      "",
      "### AIBrainInfra",
      "Infra, not in NOW.md — should NOT flag.",
      "",
      "## Content & Knowledge Management",
      "",
      "### SubstackContent",
      "Content, not in NOW.md — should NOT flag.",
      "",
    ].join("\n"),
  });

  const report = await runLint();
  const drift = report.drift.join("\n");

  assert.match(drift, /MILADVector-Forgotten/, "active project missing from NOW.md should flag");
  assert.doesNotMatch(drift, /Social-Creator-Claude/, "active project present in NOW.md should not flag");
  assert.doesNotMatch(drift, /PromptalisStable/, "stable project should not flag");
  assert.doesNotMatch(drift, /AethermereConcept/, "concept project should not flag");
  assert.doesNotMatch(drift, /AIBrainInfra/, "infrastructure project should not flag");
  assert.doesNotMatch(drift, /SubstackContent/, "content project should not flag");
});

test("drift falls back with warning when no Active section is present", async () => {
  await writeFixture({
    "00_loader.md": "# Loader\n",
    "NOW.md": "# NOW\n\n- Working on KnownProject.\n",
    "03_projects.md": [
      "# Projects",
      "",
      "## Random Heading One",
      "",
      "### KnownProject",
      "",
      "### UnknownProject",
      "",
    ].join("\n"),
  });

  const report = await runLint();
  assert.ok(Array.isArray(report.warnings), "report.warnings should exist");
  assert.ok(
    report.warnings.some((w) => /active/i.test(w)),
    "should warn that no Active section was found"
  );
  const drift = report.drift.join("\n");
  assert.match(drift, /UnknownProject/, "fallback should use prior behaviour and flag unmentioned projects");
});

async function writeBinary(name, bytes) {
  const full = path.join(tmpDir, name);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, Buffer.from(bytes));
}

test("unindexed working binaries are flagged when INDEX.md is missing", async () => {
  await writeFixture({
    "00_loader.md": "# Loader\n",
    "NOW.md": "# NOW\n",
  });
  await writeBinary("working/Tracker.xlsx", [0x50, 0x4b]);

  const report = await runLint();
  assert.deepEqual(
    report.unindexedWorkingBinaries,
    ["working/Tracker.xlsx"],
    "binary with no INDEX.md should be flagged"
  );
});

test("indexed working binary passes; unindexed sibling flagged", async () => {
  await writeFixture({
    "00_loader.md": "# Loader\n",
    "NOW.md": "# NOW\n",
    "working/INDEX.md": [
      "# Working Artifacts Index",
      "",
      "## Tracker.xlsx",
      "Indexed and discoverable.",
      "",
    ].join("\n"),
  });
  await writeBinary("working/Tracker.xlsx", [0x50, 0x4b]);
  await writeBinary("working/Orphan.pdf", [0x25, 0x50, 0x44, 0x46]);

  const report = await runLint();
  assert.deepEqual(
    report.unindexedWorkingBinaries,
    ["working/Orphan.pdf"],
    "only the binary missing from INDEX.md should be flagged"
  );
});

test("working/ markdown drafts and .gitkeep do not require INDEX entries", async () => {
  await writeFixture({
    "00_loader.md": "# Loader\n",
    "NOW.md": "# NOW\n",
    "working/INDEX.md": "# Working Artifacts Index\n",
    "working/draft.md": "# Draft\n\nFreeform working markdown.\n",
    "working/.gitkeep": "",
  });

  const report = await runLint();
  assert.deepEqual(
    report.unindexedWorkingBinaries,
    [],
    "markdown drafts and .gitkeep must not be flagged"
  );
});

test("journal rotation: under threshold does not flag", async () => {
  await writeFixture({
    "00_loader.md": "# Loader\n",
    "NOW.md": "# NOW\n",
    "JOURNAL.md": ["# Journal", "", "### 2026-05-13", "- A short entry.", ""].join("\n"),
  });

  const report = await runLint();
  assert.equal(
    report.journalRotation,
    null,
    "small JOURNAL must not trigger rotation reminder"
  );
});

test("journal rotation: line count over threshold flags with lines reason", async () => {
  // 600 short lines: comfortably over 500 lines, well under 80 KB.
  const body = Array.from({ length: 600 }, (_, i) => `- entry ${i + 1}`).join("\n");
  await writeFixture({
    "00_loader.md": "# Loader\n",
    "NOW.md": "# NOW\n",
    "JOURNAL.md": `# Journal\n\n${body}\n`,
  });

  const report = await runLint();
  assert.ok(report.journalRotation, "should flag rotation");
  assert.equal(report.journalRotation.triggeredBy, "lines");
  assert.ok(
    report.journalRotation.lines > 500,
    "line count should exceed the 500-line threshold"
  );
});

test("journal rotation: byte size over threshold flags with bytes reason", async () => {
  // ~100 KB of content split across only ~50 lines: trips bytes, not lines.
  const fatLine = "x".repeat(2000);
  const body = Array.from({ length: 50 }, () => fatLine).join("\n");
  await writeFixture({
    "00_loader.md": "# Loader\n",
    "NOW.md": "# NOW\n",
    "JOURNAL.md": `# Journal\n\n${body}\n`,
  });

  const report = await runLint();
  assert.ok(report.journalRotation, "should flag rotation");
  assert.equal(report.journalRotation.triggeredBy, "bytes");
  assert.ok(
    report.journalRotation.bytes > 80 * 1024,
    "byte size should exceed the 80 KB threshold"
  );
});

test("lint flags stale open Capture / Triage Queue items", async () => {
  await writeFixture({
    "00_loader.md": "# Loader\n\nReferences: `TASKS.md`\n",
    "NOW.md": "# NOW\n",
    "TASKS.md": [
      "# TASKS",
      "",
      "## Capture / Triage Queue",
      "",
      "Temporary capture queue.",
      "",
      "- [ ] 2026-06-01 — IDEA — Browser-based Brain viewer",
      "  - Source: ChatGPT iPhone",
      "  - Route hint: brain-platform",
      "  - Triage: Route to canonical destination, then mark transferred/closed.",
      "",
      "- [x] 2026-06-01 — NOTE — Already triaged item",
      "  - Triage: Closed.",
      "",
      "## Active",
      "",
    ].join("\n"),
  });

  const report = await runLint();
  assert.ok(report.captureQueue, "capture queue signal should be present");
  assert.equal(report.captureQueue.openCount, 1);
  assert.equal(report.captureQueue.staleCount, 1);
  assert.ok(
    report.captureQueue.oldestOpenDays >= 7,
    "oldest open item should exceed the stale threshold"
  );

  const formatted = formatLintReport(report);
  assert.match(formatted, /## Capture \/ Triage Queue/);
  assert.match(formatted, /1 open item/);
  assert.match(formatted, /Browser-based Brain viewer/);
});

test("revision-store lint does not scan BRAIN_DIR", async () => {
  const revisionRoot = await fs.mkdtemp(path.join(os.tmpdir(), "brain-lint-revision-"));
  const storeFile = path.join(revisionRoot, "revision-store.json");
  const oldEnv = {
    BRAIN_DIR: process.env.BRAIN_DIR,
    BRAIN_EXPERIMENTAL_REVISION_STORE_FILE:
      process.env.BRAIN_EXPERIMENTAL_REVISION_STORE_FILE,
  };

  process.env.BRAIN_DIR = path.join(revisionRoot, "missing-local-brain");
  process.env.BRAIN_EXPERIMENTAL_REVISION_STORE_FILE = storeFile;

  try {
    const store = new FileRevisionStore(storeFile);
    await store.proposeRevision({
      brainId: "ai-brain-jem",
      filename: "00_loader.md",
      baseRevisionId: null,
      content: "# Loader\n\nReferences: `NOW.md`, `03_projects.md`\n",
      origin: "hosted_mcp",
    });
    await store.proposeRevision({
      brainId: "ai-brain-jem",
      filename: "NOW.md",
      baseRevisionId: null,
      content: "# NOW\n\n- Working on HostedProject.\n",
      origin: "hosted_mcp",
    });
    await store.proposeRevision({
      brainId: "ai-brain-jem",
      filename: "03_projects.md",
      baseRevisionId: null,
      content: [
        "# Projects",
        "",
        "## Active",
        "",
        "### HostedProject",
        "Hosted project.",
        "",
      ].join("\n"),
      origin: "hosted_mcp",
    });

    const report = await runLint("ai-brain-jem");

    assert.deepEqual(report.bloat, []);
    assert.deepEqual(report.unindexedWorkingBinaries, []);
    assert.ok(
      report.warnings.some((warning) => /revision-backed/i.test(warning)),
      "hosted revision lint should explain that local working binaries are skipped"
    );
  } finally {
    if (oldEnv.BRAIN_DIR === undefined) {
      delete process.env.BRAIN_DIR;
    } else {
      process.env.BRAIN_DIR = oldEnv.BRAIN_DIR;
    }
    if (oldEnv.BRAIN_EXPERIMENTAL_REVISION_STORE_FILE === undefined) {
      delete process.env.BRAIN_EXPERIMENTAL_REVISION_STORE_FILE;
    } else {
      process.env.BRAIN_EXPERIMENTAL_REVISION_STORE_FILE =
        oldEnv.BRAIN_EXPERIMENTAL_REVISION_STORE_FILE;
    }
    await fs.rm(revisionRoot, { recursive: true, force: true });
  }
});
