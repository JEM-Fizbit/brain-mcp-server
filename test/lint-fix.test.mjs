import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const {
  parseDoneDate,
  daysBetween,
  stampDoneItems,
  relocateCompletedTasks,
  archiveOldDoneItems,
} = await import(path.join(__dirname, "..", "dist", "services", "lint-fix.js"));

// --- parseDoneDate / daysBetween ---------------------------------------------

test("parseDoneDate reads the Brain's (done DATE) convention", () => {
  assert.equal(parseDoneDate("- [x] Book holiday *(done 2026-06-09)*"), "2026-06-09");
  assert.equal(parseDoneDate("- [x] Thing (done 2026-06-14 — commit abc)"), "2026-06-14");
  assert.equal(parseDoneDate("- [x] No stamp here"), null);
  assert.equal(parseDoneDate("- [x] Deployed **v1** (2026-05-25)"), null);
});

test("daysBetween counts whole days across months", () => {
  assert.equal(daysBetween("2026-06-01", "2026-07-01"), 30);
  assert.equal(daysBetween("2026-07-01", "2026-07-01"), 0);
});

// --- item model: each transform enumerates items + honours an approved filter -

const tasksFixture = [
  "# TASKS",
  "",
  "## Active",
  "- [ ] Active undated item",
  "- [x] Misfiled done thing",
  "",
  "## Done",
  "- [x] Already stamped *(done 2026-06-09)*",
  "- [x] Freshly finished, no stamp",
  "- [x] Old one *(done 2026-05-01)*",
  "",
].join("\n");

test("stampDoneItems enumerates undated Done items with stable ids", () => {
  const a = stampDoneItems(tasksFixture, "2026-07-01");
  const b = stampDoneItems(tasksFixture, "2026-07-01");
  // One undated Done line ("Freshly finished"). "Already stamped" and the dated
  // "Old one" are not candidates; the Active item is out of the Done section.
  assert.equal(a.items.length, 1);
  assert.equal(a.items[0].kind, "done_stamp");
  assert.ok(a.items[0].id && typeof a.items[0].id === "string");
  assert.equal(a.items[0].id, b.items[0].id, "ids must be stable across calls");
});

test("stampDoneItems with empty approved set changes nothing but still lists items", () => {
  const { content, items } = stampDoneItems(tasksFixture, "2026-07-01", new Set());
  assert.equal(items.length, 1);
  assert.equal(content, tasksFixture, "no item approved -> content unchanged");
});

test("stampDoneItems applies only the approved id", () => {
  const plan = stampDoneItems(tasksFixture, "2026-07-01", new Set());
  const id = plan.items[0].id;
  const { content } = stampDoneItems(tasksFixture, "2026-07-01", new Set([id]));
  assert.match(content, /Freshly finished, no stamp \(done 2026-07-01\)/);
});

test("stampDoneItems with no approved arg applies all (back-compat default)", () => {
  const { content } = stampDoneItems(tasksFixture, "2026-07-01");
  assert.match(content, /Freshly finished, no stamp \(done 2026-07-01\)/);
});

test("relocateCompletedTasks enumerates misfiled [x] items and applies selectively", () => {
  const plan = relocateCompletedTasks(tasksFixture, "2026-07-01", new Set());
  assert.equal(plan.items.length, 1);
  assert.equal(plan.items[0].kind, "task_relocate");
  assert.equal(plan.content, tasksFixture);

  const applied = relocateCompletedTasks(tasksFixture, "2026-07-01", new Set([plan.items[0].id]));
  const activeBlock = applied.content.split("## Done")[0];
  assert.doesNotMatch(activeBlock, /Misfiled done thing/);
  // Moved into Done AND stamped with today's date (self-contained).
  assert.match(applied.content.split("## Done")[1], /Misfiled done thing \(done 2026-07-01\)/);
});

test("relocateCompletedTasks ignores [x] inside code fences", () => {
  const fenced = ["# T", "", "## Active", "```", "- [x] example", "```", "", "## Done", ""].join("\n");
  assert.equal(relocateCompletedTasks(fenced, "2026-07-01").items.length, 0);
});

test("archiveOldDoneItems enumerates >30d items and archives selectively", () => {
  const archive = "# Archived Done Tasks\n";
  const plan = archiveOldDoneItems(tasksFixture, archive, "2026-07-01", 30, new Set());
  assert.equal(plan.items.length, 1); // only "Old one" (2026-05-01)
  assert.equal(plan.items[0].kind, "done_archive");
  assert.equal(plan.tasksContent, tasksFixture);
  assert.equal(plan.archiveContent, archive);

  const applied = archiveOldDoneItems(tasksFixture, archive, "2026-07-01", 30, new Set([plan.items[0].id]));
  assert.doesNotMatch(applied.tasksContent, /Old one/);
  assert.match(applied.archiveContent, /Old one \*\(done 2026-05-01\)\*/);
});

test("archiveOldDoneItems never enumerates an unstamped item", () => {
  const t = ["# T", "", "## Done", "- [x] no date", ""].join("\n");
  assert.equal(archiveOldDoneItems(t, "", "2026-07-01", 30).items.length, 0);
});
