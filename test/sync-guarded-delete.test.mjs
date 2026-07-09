import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "brain-guarded-del-"));

const { MemoryRevisionStore, LocalSyncAgent } = await import(
  path.join(__dirname, "..", "dist", "sync", "index.js")
);

after(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

const BRAIN = "ai-brain-jem";

function dirs(name) {
  const root = path.join(tmpRoot, name);
  return {
    brainDir: path.join(root, "brain"),
    stateFile: path.join(root, ".brain-sync", "state.json"),
  };
}

async function writeFile(brainDir, filename, content) {
  const full = path.join(brainDir, filename);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, "utf-8");
}

function makeAgent(store, options) {
  return new LocalSyncAgent({
    brainId: BRAIN,
    store,
    actor: { provider: "test", id: "agent" },
    ...options,
  });
}

/** Seed a structurally-healthy brain: both markers + `count` content files. */
async function seedHealthy(brainDir, count) {
  await writeFile(brainDir, "00_loader.md", "# loader\n");
  await writeFile(brainDir, "NOW.md", "# now\n");
  const names = [];
  for (let i = 0; i < count; i += 1) {
    const name = `note-${i}.md`;
    await writeFile(brainDir, name, `body ${i}\n`);
    names.push(name);
  }
  return names;
}

async function isDeletedHosted(store, filename) {
  const heads = await store.listFiles(BRAIN, { includeDeleted: true });
  const head = heads.find((h) => h.filename === filename);
  return head ? head.deleted === true : false;
}

test("a confirmed local deletion tombstones only after two consecutive absent scans (debounce)", async () => {
  const store = new MemoryRevisionStore();
  const { brainDir, stateFile } = dirs("debounce");
  await seedHealthy(brainDir, 10); // 12 tracked incl. markers -> 1 delete = 8% <= 10%
  const agent = makeAgent(store, { brainDir, stateFile });
  await agent.pushLocalChanges(); // track everything

  await fs.rm(path.join(brainDir, "note-3.md"));

  const first = await agent.pushLocalChanges();
  assert.deepEqual(first.deleted, [], "not tombstoned on first absent scan");
  assert.equal(await isDeletedHosted(store, "note-3.md"), false);

  const second = await agent.pushLocalChanges();
  assert.deepEqual(second.deleted, ["note-3.md"], "tombstoned on second absent scan");
  assert.equal(await isDeletedHosted(store, "note-3.md"), true);
});

test("an empty scan (unmounted/empty folder) never tombstones tracked files", async () => {
  const store = new MemoryRevisionStore();
  const { brainDir, stateFile } = dirs("unmount");
  const names = await seedHealthy(brainDir, 6);
  const agent = makeAgent(store, { brainDir, stateFile });
  await agent.pushLocalChanges();

  // Simulate an unmounted / empty OneDrive: every file disappears at once.
  await fs.rm(brainDir, { recursive: true, force: true });
  await fs.mkdir(brainDir, { recursive: true });

  await agent.pushLocalChanges();
  const report = await agent.pushLocalChanges();
  assert.deepEqual(report.deleted, [], "no tombstones from an empty scan");
  assert.ok(report.guardTripped, "a guard is reported");
  for (const name of [...names, "00_loader.md", "NOW.md"]) {
    assert.equal(await isDeletedHosted(store, name), false, `${name} still live`);
  }
});

test("a vanished structural marker blocks all delete inference", async () => {
  const store = new MemoryRevisionStore();
  const { brainDir, stateFile } = dirs("marker");
  await seedHealthy(brainDir, 10);
  const agent = makeAgent(store, { brainDir, stateFile });
  await agent.pushLocalChanges();

  // A damaged tree: a marker vanished alongside a content file.
  await fs.rm(path.join(brainDir, "00_loader.md"));
  await fs.rm(path.join(brainDir, "note-2.md"));

  await agent.pushLocalChanges();
  const report = await agent.pushLocalChanges();
  assert.deepEqual(report.deleted, [], "no tombstones while a marker is missing");
  assert.ok(report.guardTripped, "a guard is reported");
  assert.equal(await isDeletedHosted(store, "note-2.md"), false);
});

test("a confirmed batch over the mass-delete threshold is skipped, not tombstoned", async () => {
  const store = new MemoryRevisionStore();
  const { brainDir, stateFile } = dirs("mass");
  const names = await seedHealthy(brainDir, 8); // 10 tracked
  const agent = makeAgent(store, { brainDir, stateFile });
  await agent.pushLocalChanges();

  // Delete 6 content files at once (> 5 absolute default, and 60% > 10%).
  const doomed = names.slice(0, 6);
  for (const name of doomed) await fs.rm(path.join(brainDir, name));

  await agent.pushLocalChanges(); // arm debounce
  const report = await agent.pushLocalChanges();
  assert.deepEqual(report.deleted, [], "mass delete not auto-applied");
  assert.deepEqual(report.deletionsSkipped.sort(), doomed.sort());
  assert.ok(report.guardTripped, "a guard is reported");
  for (const name of doomed) {
    assert.equal(await isDeletedHosted(store, name), false, `${name} still live`);
  }
});
