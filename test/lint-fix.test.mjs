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
  indexOrphans,
  bumpReviewedDate,
} = await import(path.join(__dirname, "..", "dist", "services", "lint-fix.js"));

// --- parseDoneDate / daysBetween ---------------------------------------------

test("parseDoneDate reads the Brain's (done DATE) convention", () => {
  assert.equal(parseDoneDate("- [x] Book holiday *(done 2026-06-09)*"), "2026-06-09");
  assert.equal(parseDoneDate("- [x] Thing (done 2026-06-14 — commit abc)"), "2026-06-14");
  assert.equal(parseDoneDate("- [x] No stamp here"), null);
  // A bare non-"done" date must NOT be treated as a completion stamp.
  assert.equal(parseDoneDate("- [x] Deployed **v1** (2026-05-25)"), null);
});

test("daysBetween counts whole days across months", () => {
  assert.equal(daysBetween("2026-06-01", "2026-07-01"), 30);
  assert.equal(daysBetween("2026-07-01", "2026-07-01"), 0);
});

// --- stampDoneItems (D-support) ----------------------------------------------

test("stampDoneItems tags only undated Done-section items with today", () => {
  const tasks = [
    "# TASKS",
    "",
    "## Active",
    "- [ ] Active undated item",       // not in Done → untouched
    "",
    "## Done",
    "- [x] Already stamped *(done 2026-06-09)*",
    "- [x] Freshly finished, no stamp",
    "",
  ].join("\n");

  const { content, stamped } = stampDoneItems(tasks, "2026-07-01");

  assert.equal(stamped.length, 1);
  assert.match(content, /Freshly finished, no stamp \(done 2026-07-01\)/);
  // Existing stamp preserved, not double-stamped.
  assert.equal((content.match(/\(done 2026-06-09\)/g) || []).length, 1);
  assert.equal((content.match(/\(done 2026-07-01\)/g) || []).length, 1);
  // Active item untouched.
  assert.match(content, /- \[ \] Active undated item\n/);
});

// --- relocateCompletedTasks (D) ----------------------------------------------

test("relocateCompletedTasks moves [x] lines from other sections into Done", () => {
  const tasks = [
    "# TASKS",
    "",
    "## Active",
    "- [ ] Still open",
    "- [x] Done but misfiled",
    "",
    "## Done",
    "- [x] Existing done item",
    "",
  ].join("\n");

  const { content, moved } = relocateCompletedTasks(tasks);

  assert.equal(moved.length, 1);
  // The misfiled line is gone from Active and present under Done.
  const activeBlock = content.split("## Done")[0];
  assert.doesNotMatch(activeBlock, /Done but misfiled/);
  const doneBlock = content.split("## Done")[1];
  assert.match(doneBlock, /Done but misfiled/);
  assert.match(doneBlock, /Existing done item/);
  // Open item stays put.
  assert.match(activeBlock, /- \[ \] Still open/);
});

test("relocateCompletedTasks ignores [x] inside code fences", () => {
  const tasks = [
    "# TASKS",
    "",
    "## Active",
    "```",
    "- [x] example in a code block",
    "```",
    "",
    "## Done",
    "",
  ].join("\n");

  const { moved } = relocateCompletedTasks(tasks);
  assert.equal(moved.length, 0);
});

// --- archiveOldDoneItems (B) -------------------------------------------------

test("archiveOldDoneItems moves items stamped older than 30 days", () => {
  const tasks = [
    "# TASKS",
    "",
    "## Done",
    "- [x] Old one *(done 2026-05-01)*",
    "- [x] Recent one *(done 2026-06-20)*",
    "",
    "## Future",
    "- [ ] keep me",
    "",
  ].join("\n");
  const archive = "# Archived Done Tasks\n";

  const { tasksContent, archiveContent, archived } = archiveOldDoneItems(
    tasks,
    archive,
    "2026-07-01",
    30
  );

  assert.equal(archived.length, 1);
  assert.doesNotMatch(tasksContent, /Old one/);
  assert.match(tasksContent, /Recent one/);       // within 30d stays
  assert.match(tasksContent, /- \[ \] keep me/);  // other sections intact
  assert.match(archiveContent, /Old one \*\(done 2026-05-01\)\*/); // appended verbatim
  assert.match(archiveContent, /# Archived Done Tasks/);           // existing archive kept
});

test("archiveOldDoneItems never archives an unstamped item", () => {
  const tasks = ["# TASKS", "", "## Done", "- [x] no date", ""].join("\n");
  const { archived, tasksContent } = archiveOldDoneItems(tasks, "", "2026-07-01", 30);
  assert.equal(archived.length, 0);
  assert.match(tasksContent, /no date/);
});

// --- indexOrphans (A) --------------------------------------------------------

test("indexOrphans appends pending entries under mapped headings", () => {
  const loader = [
    "## All Files",
    "",
    "### Core Context",
    "- `01_identity.md` — Who John is.",
    "",
    "### Reference Data",
    "- `REF_facts.md` — Extracted facts.",
    "",
    "### Operations",
    "- `LOG.md` — Change log.",
    "",
  ].join("\n");

  const { content, added } = indexOrphans(loader, [
    "07_new_domain.md",
    "REF_new_ref.md",
    "TASKS.md",
  ]);

  assert.equal(added.length, 3);
  const core = content.split("### Reference Data")[0];
  assert.match(core, /- `07_new_domain.md` — \(description pending review\)/);
  const ref = content.split("### Reference Data")[1].split("### Operations")[0];
  assert.match(ref, /- `REF_new_ref.md` — \(description pending review\)/);
  const ops = content.split("### Operations")[1];
  assert.match(ops, /- `TASKS.md` — \(description pending review\)/);
});

// --- bumpReviewedDate (C) ----------------------------------------------------

test("bumpReviewedDate updates the Last reviewed line to today", () => {
  const loader = "## Maintenance\n\n- **Last reviewed:** 2026-06-17\n";
  const { content, bumped } = bumpReviewedDate(loader, "2026-07-01");
  assert.equal(bumped, true);
  assert.match(content, /- \*\*Last reviewed:\*\* 2026-07-01/);
  assert.doesNotMatch(content, /2026-06-17/);
});

test("bumpReviewedDate is a no-op when the line is absent", () => {
  const loader = "## Maintenance\n\nnothing here\n";
  const { content, bumped } = bumpReviewedDate(loader, "2026-07-01");
  assert.equal(bumped, false);
  assert.equal(content, loader);
});
