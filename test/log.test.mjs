import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "brain-log-test-"));
const brainDir = path.join(tmpDir, "brain");

process.env.BRAIN_DIR = brainDir;
delete process.env.BRAIN_PLATFORM_CONFIG;
process.env.BRAIN_DATE_TIME_ZONE = "UTC";

const log = await import(
  path.join(__dirname, "..", "dist", "services", "log.js")
);

after(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

test("appendLog inserts newest entries directly below the preamble", async () => {
  await fs.mkdir(brainDir, { recursive: true });
  await fs.rm(path.join(brainDir, "LOG.md"), { force: true });

  await log.appendLog("UPDATE", ["first.md"], "first entry");
  await log.appendLog("UPDATE", ["second.md"], "second entry");

  const content = await fs.readFile(path.join(brainDir, "LOG.md"), "utf-8");
  const firstIndex = content.indexOf("first entry");
  const secondIndex = content.indexOf("second entry");

  assert.ok(secondIndex > -1, "second entry should exist");
  assert.ok(firstIndex > -1, "first entry should exist");
  assert.ok(secondIndex < firstIndex, "newest entry should be above older entries");

  const latest = await log.readLog(1);
  assert.match(latest, /second entry/);
  assert.doesNotMatch(latest, /first entry/);
});

test("readLog paginates the newest-first stream with offset", async () => {
  await fs.mkdir(brainDir, { recursive: true });
  await fs.rm(path.join(brainDir, "LOG.md"), { force: true });

  for (const label of ["one", "two", "three", "four", "five"]) {
    await log.appendLog("UPDATE", [`${label}.md`], `${label} entry`);
  }

  const firstPage = await log.readLog(2, undefined, 0);
  assert.match(firstPage, /Showing newest 2 of 5 entries/);
  assert.match(firstPage, /five entry/);
  assert.match(firstPage, /four entry/);
  assert.doesNotMatch(firstPage, /three entry/);

  const secondPage = await log.readLog(2, undefined, 2);
  assert.match(secondPage, /Showing entries 3-4 of 5 \(newest first\)/);
  assert.match(secondPage, /three entry/);
  assert.match(secondPage, /two entry/);
  assert.doesNotMatch(secondPage, /five entry/);

  const beyondEnd = await log.readLog(2, undefined, 99);
  assert.equal(beyondEnd, "No log entries at offset 99. Total entries: 5.");
});

test("readLogContent reads legacy one-line date entries", () => {
  const content = [
    "# Brain Change Log",
    "",
    "- 2026-06-24 — `brain/entities/ers_genomics.md` — UPDATE | US subsidiary details added.",
    "2026-06-23 — UPDATE — TASKS.md — Added task intake item.",
    "",
  ].join("\n");

  const latest = log.readLogContent(content, 1, 0);
  assert.match(latest, /US subsidiary details added/);
  assert.doesNotMatch(latest, /Added task intake item/);

  const second = log.readLogContent(content, 1, 1);
  assert.match(second, /Added task intake item/);
  assert.doesNotMatch(second, /US subsidiary details added/);
});

test("appendLogEntryToContent inserts below a legacy preamble", () => {
  const content = [
    "# LOG — ERS Brain change log",
    "",
    "Append-only. One line per change.",
    "",
    "- 2026-06-24 — existing entry",
    "",
  ].join("\n");
  const entry = log.formatLogEntry("UPDATE", ["TASKS.md"], "new entry", "2026-06-25");

  const next = log.appendLogEntryToContent(content, entry);

  assert.ok(
    next.indexOf("# LOG — ERS Brain change log") < next.indexOf("new entry"),
    "preamble should stay at the top"
  );
  assert.ok(
    next.indexOf("new entry") < next.indexOf("existing entry"),
    "new entry should be above older legacy entries"
  );
});

test("appendLogEntryToContent prepends above existing standard entries in a legacy log", () => {
  const content = [
    "# LOG — ERS Brain change log",
    "",
    "Append-only. One line per change.",
    "",
    "## [2026-06-25] UPDATE | existing standard entry",
    "Files: TASKS.md",
    "",
    "- 2026-06-24 — existing legacy entry",
    "",
  ].join("\n");
  const entry = log.formatLogEntry("UPDATE", ["LOG.md"], "new standard entry", "2026-06-25");

  const next = log.appendLogEntryToContent(content, entry);

  assert.ok(
    next.indexOf("Append-only. One line per change.") <
      next.indexOf("new standard entry"),
    "preamble should remain above inserted entries"
  );
  assert.ok(
    next.indexOf("new standard entry") < next.indexOf("existing standard entry"),
    "new entry should be above existing standard entries"
  );
  assert.ok(
    next.indexOf("existing standard entry") < next.indexOf("existing legacy entry"),
    "existing standard entries should remain above legacy entries"
  );
});

test("readLogContent does not attach a legacy preamble to a standard entry", () => {
  const content = [
    "## [2026-06-25] UPDATE | new entry",
    "Files: TASKS.md",
    "",
    "# LOG — ERS Brain change log",
    "",
    "Append-only. One line per change.",
    "",
    "- 2026-06-24 — existing entry",
    "",
  ].join("\n");

  const latest = log.readLogContent(content, 1, 0);

  assert.match(latest, /new entry/);
  assert.doesNotMatch(latest, /# LOG/);
  assert.doesNotMatch(latest, /existing entry/);
});
