import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "brain-lint-apply-"));
process.env.BRAIN_DIR = tmpDir;

const { applyLintFixes, planLintFixes, applyLintFixSelection } = await import(
  path.join(__dirname, "..", "dist", "services", "lint-apply.js")
);

const LOADER = [
  "# Loader",
  "",
  "## All Files",
  "",
  "### Core Context",
  "- `NOW.md` — current state.",
  "",
  "### Operations",
  "- `TASKS.md` — tasks.",
  "- `LOG.md` — log.",
  "",
  "## Maintenance",
  "",
  "- **Last reviewed:** 2026-06-01",
  "",
].join("\n");

const TASKS = [
  "# TASKS",
  "",
  "## Active",
  "- [ ] open item",
  "- [x] misfiled done thing",
  "",
  "## Done",
  "- [x] old thing *(done 2026-05-01)*",
  "- [x] recent thing *(done 2026-06-25)*",
  "- [x] undated thing",
  "",
  "## Future",
  "- [ ] later",
  "",
].join("\n");

async function seed() {
  const entries = await fs.readdir(tmpDir);
  for (const name of entries) {
    await fs.rm(path.join(tmpDir, name), { recursive: true, force: true });
  }
  await fs.writeFile(path.join(tmpDir, "00_loader.md"), LOADER, "utf-8");
  await fs.writeFile(path.join(tmpDir, "NOW.md"), "# NOW\n", "utf-8");
  await fs.writeFile(path.join(tmpDir, "TASKS.md"), TASKS, "utf-8");
  await fs.writeFile(path.join(tmpDir, "LOG.md"), "# LOG\n", "utf-8");
  // An existing file not referenced in the loader → an orphan.
  await fs.writeFile(path.join(tmpDir, "07_orphan.md"), "# Orphan\n", "utf-8");
}

test("applyLintFixes runs all four fixes and writes changed files", async () => {
  await seed();

  const summary = await applyLintFixes("ai-brain-jem", "2026-07-01");

  // Summary reflects each fix.
  assert.equal(summary.orphansIndexed.length, 1);
  assert.match(summary.orphansIndexed[0], /07_orphan\.md/);
  assert.equal(summary.tasksRelocated.length, 1);
  assert.equal(summary.doneStamped.length, 1); // pre-existing undated item; relocated line is stamped by relocate
  assert.equal(summary.doneArchived.length, 1); // old thing (>30d)
  assert.equal(summary.reviewedDateBumped, true);
  assert.equal(summary.applied, true);

  const loader = await fs.readFile(path.join(tmpDir, "00_loader.md"), "utf-8");
  assert.match(loader, /- `07_orphan.md` — \(description pending review\)/);
  assert.match(loader, /- \*\*Last reviewed:\*\* 2026-07-01/);

  const tasks = await fs.readFile(path.join(tmpDir, "TASKS.md"), "utf-8");
  assert.doesNotMatch(tasks, /old thing/); // archived out
  assert.match(tasks, /recent thing/); // within 30d stays
  assert.match(tasks, /undated thing \(done 2026-07-01\)/); // stamped
  const activeBlock = tasks.split("## Done")[0];
  assert.doesNotMatch(activeBlock, /misfiled done thing/); // moved out of Active
  const doneBlock = tasks.split("## Done")[1];
  assert.match(doneBlock, /misfiled done thing \(done 2026-07-01\)/); // relocated + stamped

  const archive = await fs.readFile(
    path.join(tmpDir, "archive", "tasks-done.md"),
    "utf-8"
  );
  assert.match(archive, /old thing \*\(done 2026-05-01\)\*/);

  const log = await fs.readFile(path.join(tmpDir, "LOG.md"), "utf-8");
  assert.match(log, /LINT/);
});

test("applyLintFixes dry run reports the plan but writes nothing", async () => {
  await seed();
  const before = await fs.readFile(path.join(tmpDir, "TASKS.md"), "utf-8");

  const summary = await applyLintFixes("ai-brain-jem", "2026-07-01", {
    dryRun: true,
  });

  assert.equal(summary.dryRun, true);
  assert.equal(summary.applied, false);
  assert.equal(summary.tasksRelocated.length, 1); // plan still computed
  assert.deepEqual(summary.filesWritten, []);

  const after = await fs.readFile(path.join(tmpDir, "TASKS.md"), "utf-8");
  assert.equal(after, before); // untouched
  // Archive must not be created on a dry run.
  await assert.rejects(() =>
    fs.readFile(path.join(tmpDir, "archive", "tasks-done.md"), "utf-8")
  );
});

test("applyLintFixes is a silent no-op on a clean Brain", async () => {
  const entries = await fs.readdir(tmpDir);
  for (const name of entries) {
    await fs.rm(path.join(tmpDir, name), { recursive: true, force: true });
  }
  // Loader references everything; no orphans, no tasks to fix.
  await fs.writeFile(
    path.join(tmpDir, "00_loader.md"),
    "# Loader\n\n## All Files\n\n### Operations\n- `NOW.md` — now.\n",
    "utf-8"
  );
  await fs.writeFile(path.join(tmpDir, "NOW.md"), "# NOW\n", "utf-8");

  const summary = await applyLintFixes("ai-brain-jem", "2026-07-01");
  assert.equal(summary.applied, false);
  assert.deepEqual(summary.filesWritten, []);
});

test("planLintFixes enumerates per-item fixes without writing", async () => {
  await seed();
  const before = await fs.readFile(path.join(tmpDir, "TASKS.md"), "utf-8");

  const plan = await planLintFixes("ai-brain-jem", "2026-07-01");
  const kinds = plan.items.map((i) => i.kind);
  for (const k of ["orphan_index", "task_relocate", "done_stamp", "done_archive", "reviewed_date"]) {
    assert.ok(kinds.includes(k), `plan should include a ${k} item`);
  }
  assert.ok(plan.items.every((i) => typeof i.id === "string" && i.id.length > 0));

  // Read-only: nothing changed on disk.
  assert.equal(await fs.readFile(path.join(tmpDir, "TASKS.md"), "utf-8"), before);
  await assert.rejects(() =>
    fs.readFile(path.join(tmpDir, "archive", "tasks-done.md"), "utf-8")
  );
});

test("applyLintFixSelection applies only approved items", async () => {
  await seed();
  const plan = await planLintFixes("ai-brain-jem", "2026-07-01");
  const orphanId = plan.items.find((i) => i.kind === "orphan_index").id;
  const archiveId = plan.items.find((i) => i.kind === "done_archive").id;

  // Approve orphan-index + one archive + the reviewed-date bump; skip relocate & stamp.
  const res = await applyLintFixSelection("ai-brain-jem", "2026-07-01", [
    orphanId,
    archiveId,
    "reviewed_date",
  ]);
  assert.equal(res.applied, true);
  assert.ok(res.appliedIds.includes(orphanId));
  assert.ok(res.appliedIds.includes(archiveId));
  assert.equal(res.reviewedDateBumped, true);

  const loader = await fs.readFile(path.join(tmpDir, "00_loader.md"), "utf-8");
  assert.match(loader, /- `07_orphan.md` — \(description pending review\)/);
  assert.match(loader, /- \*\*Last reviewed:\*\* 2026-07-01/);

  const tasks = await fs.readFile(path.join(tmpDir, "TASKS.md"), "utf-8");
  assert.doesNotMatch(tasks, /old thing/); // approved archive happened
  // NOT approved: relocate (misfiled stays in Active) and stamp (undated stays undated).
  assert.match(tasks.split("## Done")[0], /misfiled done thing/);
  assert.doesNotMatch(tasks, /undated thing \(done/);

  const archive = await fs.readFile(path.join(tmpDir, "archive", "tasks-done.md"), "utf-8");
  assert.match(archive, /old thing/);
});

test("applyLintFixSelection ignores stale ids and writes nothing", async () => {
  await seed();
  const before = await fs.readFile(path.join(tmpDir, "TASKS.md"), "utf-8");

  const res = await applyLintFixSelection("ai-brain-jem", "2026-07-01", [
    "done_stamp:deadbeef",
  ]);
  assert.equal(res.applied, false);
  assert.deepEqual(res.staleIds, ["done_stamp:deadbeef"]);
  assert.deepEqual(res.filesWritten, []);
  assert.equal(await fs.readFile(path.join(tmpDir, "TASKS.md"), "utf-8"), before);
});
