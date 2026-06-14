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
