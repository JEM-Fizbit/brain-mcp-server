import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "brain-pull-tomb-"));

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

function makeAgent(store, options) {
  return new LocalSyncAgent({
    brainId: BRAIN,
    store,
    actor: { provider: "test", id: "agent" },
    ...options,
  });
}

async function seedHosted(store, filename, content) {
  const result = await store.proposeRevision({
    brainId: BRAIN,
    filename,
    baseRevisionId: null,
    content,
    origin: "test",
  });
  assert.equal(result.ok, true);
  return result.head.revisionId;
}

async function localExists(brainDir, filename) {
  try {
    await fs.stat(path.join(brainDir, filename));
    return true;
  } catch {
    return false;
  }
}

test("pull applies a hosted tombstone by removing a clean local file", async () => {
  const store = new MemoryRevisionStore();
  const { brainDir, stateFile } = dirs("clean");
  const rev = await seedHosted(store, "topic.md", "hello\n");
  const agent = makeAgent(store, { brainDir, stateFile });
  await agent.pullHostedChanges(); // writes + tracks topic.md
  assert.equal(await localExists(brainDir, "topic.md"), true);

  await store.proposeDeletion({
    brainId: BRAIN,
    filename: "topic.md",
    baseRevisionId: rev,
    origin: "test",
  });

  const report = await agent.pullHostedChanges();
  assert.deepEqual(report.deleted, ["topic.md"]);
  assert.equal(await localExists(brainDir, "topic.md"), false, "clean local file removed");

  const state = JSON.parse(await fs.readFile(stateFile, "utf-8"));
  assert.equal(state.files["topic.md"], undefined, "no longer tracked");
});

test("pull does not delete a locally-modified file that was tombstoned remotely", async () => {
  const store = new MemoryRevisionStore();
  const { brainDir, stateFile } = dirs("dirty");
  const rev = await seedHosted(store, "topic.md", "hello\n");
  const agent = makeAgent(store, { brainDir, stateFile });
  await agent.pullHostedChanges();

  // Local edit after the last sync, then a remote deletion.
  await fs.writeFile(path.join(brainDir, "topic.md"), "my unsynced edits\n", "utf-8");
  await store.proposeDeletion({
    brainId: BRAIN,
    filename: "topic.md",
    baseRevisionId: rev,
    origin: "test",
  });

  const report = await agent.pullHostedChanges();
  assert.deepEqual(report.deleted, [], "dirty file not deleted");
  assert.equal(report.conflicts.length, 1, "conflict recorded");
  assert.equal(report.conflicts[0].filename, "topic.md");
  assert.equal(await localExists(brainDir, "topic.md"), true, "local edits preserved");
});

test("pull treats a hosted tombstone as a no-op when the file is already gone locally", async () => {
  const store = new MemoryRevisionStore();
  const { brainDir, stateFile } = dirs("gone");
  const rev = await seedHosted(store, "topic.md", "hello\n");
  const agent = makeAgent(store, { brainDir, stateFile });
  await agent.pullHostedChanges();
  await fs.rm(path.join(brainDir, "topic.md"));

  await store.proposeDeletion({
    brainId: BRAIN,
    filename: "topic.md",
    baseRevisionId: rev,
    origin: "test",
  });

  const report = await agent.pullHostedChanges();
  assert.deepEqual(report.conflicts, [], "no conflict for an already-absent file");
  const state = JSON.parse(await fs.readFile(stateFile, "utf-8"));
  assert.equal(state.files["topic.md"], undefined, "reconciled out of tracking");
});

test("pull never unlinks a protected structural file even if tombstoned remotely", async () => {
  const store = new MemoryRevisionStore();
  const { brainDir, stateFile } = dirs("protected");
  const rev = await seedHosted(store, "NOW.md", "# now\n");
  const agent = makeAgent(store, { brainDir, stateFile });
  await agent.pullHostedChanges();

  await store.proposeDeletion({
    brainId: BRAIN,
    filename: "NOW.md",
    baseRevisionId: rev,
    origin: "test",
  });

  const report = await agent.pullHostedChanges();
  assert.deepEqual(report.deleted, [], "protected file not deleted");
  assert.equal(await localExists(brainDir, "NOW.md"), true, "protected file preserved locally");
});

test("pull does not resurrect a tracked file that is missing locally (deletion is owned by guarded push)", async () => {
  const store = new MemoryRevisionStore();
  const { brainDir, stateFile } = dirs("no-resurrect");
  await seedHosted(store, "topic.md", "canonical\n");
  const agent = makeAgent(store, { brainDir, stateFile });
  await agent.pullHostedChanges(); // track topic.md
  await fs.rm(path.join(brainDir, "topic.md")); // simulate a pending local deletion

  const report = await agent.pullHostedChanges();
  assert.deepEqual(report.pulled, [], "not resurrected");
  assert.deepEqual(report.conflicts, [], "no conflict — push side owns the decision");
  assert.equal(await localExists(brainDir, "topic.md"), false, "left absent for guarded push to handle");
});
