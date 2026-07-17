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
  "## Maintenance",
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
  await fs.writeFile(path.join(tmpDir, "07_orphan.md"), "# Orphan\n", "utf-8");
}

test("applyLintFixes repairs ordinary task content without changing structural files", async () => {
  await seed();
  const beforeLoader = await fs.readFile(path.join(tmpDir, "00_loader.md"), "utf-8");
  const beforeNow = await fs.readFile(path.join(tmpDir, "NOW.md"), "utf-8");

  const summary = await applyLintFixes("ai-brain-jem", "2026-07-01");
  assert.equal(summary.tasksRelocated.length, 1);
  assert.equal(summary.doneStamped.length, 1);
  assert.equal(summary.doneArchived.length, 1);
  assert.equal(summary.applied, true);
  assert.deepEqual(summary.filesWritten.sort(), ["TASKS.md", "archive/tasks-done.md"]);

  assert.equal(
    await fs.readFile(path.join(tmpDir, "00_loader.md"), "utf-8"),
    beforeLoader
  );
  assert.equal(await fs.readFile(path.join(tmpDir, "NOW.md"), "utf-8"), beforeNow);

  const tasks = await fs.readFile(path.join(tmpDir, "TASKS.md"), "utf-8");
  assert.doesNotMatch(tasks, /old thing/);
  assert.match(tasks, /recent thing/);
  assert.match(tasks, /undated thing \(done 2026-07-01\)/);
  assert.doesNotMatch(tasks.split("## Done")[0], /misfiled done thing/);
  assert.match(tasks.split("## Done")[1], /misfiled done thing \(done 2026-07-01\)/);
});

test("applyLintFixes dry run reports the plan but writes nothing", async () => {
  await seed();
  const before = await fs.readFile(path.join(tmpDir, "TASKS.md"), "utf-8");
  const summary = await applyLintFixes("ai-brain-jem", "2026-07-01", {
    dryRun: true,
  });
  assert.equal(summary.dryRun, true);
  assert.equal(summary.applied, false);
  assert.equal(summary.tasksRelocated.length, 1);
  assert.deepEqual(summary.filesWritten, []);
  assert.equal(await fs.readFile(path.join(tmpDir, "TASKS.md"), "utf-8"), before);
});

test("applyLintFixes is a silent no-op without TASKS candidates", async () => {
  await seed();
  await fs.writeFile(path.join(tmpDir, "TASKS.md"), "# TASKS\n\n## Done\n", "utf-8");
  const summary = await applyLintFixes("ai-brain-jem", "2026-07-01");
  assert.equal(summary.applied, false);
  assert.deepEqual(summary.filesWritten, []);
});

test("planLintFixes exposes only ordinary-content fix kinds", async () => {
  await seed();
  const plan = await planLintFixes("ai-brain-jem", "2026-07-01");
  assert.deepEqual(
    new Set(plan.items.map((item) => item.kind)),
    new Set(["task_relocate", "done_stamp", "done_archive"])
  );
  assert.ok(plan.items.every((item) => item.file !== "00_loader.md" && item.file !== "NOW.md"));
});

test("applyLintFixSelection applies only an approved ordinary-content item", async () => {
  await seed();
  const plan = await planLintFixes("ai-brain-jem", "2026-07-01");
  const archiveId = plan.items.find((item) => item.kind === "done_archive").id;
  const result = await applyLintFixSelection(
    "ai-brain-jem",
    "2026-07-01",
    [archiveId]
  );
  assert.equal(result.applied, true);
  assert.deepEqual(result.appliedIds, [archiveId]);
  const tasks = await fs.readFile(path.join(tmpDir, "TASKS.md"), "utf-8");
  assert.doesNotMatch(tasks, /old thing/);
  assert.match(tasks.split("## Done")[0], /misfiled done thing/);
  assert.doesNotMatch(tasks, /undated thing \(done/);
});

test("applyLintFixSelection ignores stale ids and writes nothing", async () => {
  await seed();
  const before = await fs.readFile(path.join(tmpDir, "TASKS.md"), "utf-8");
  const result = await applyLintFixSelection(
    "ai-brain-jem",
    "2026-07-01",
    ["done_stamp:deadbeef"]
  );
  assert.equal(result.applied, false);
  assert.deepEqual(result.staleIds, ["done_stamp:deadbeef"]);
  assert.deepEqual(result.filesWritten, []);
  assert.equal(await fs.readFile(path.join(tmpDir, "TASKS.md"), "utf-8"), before);
});
