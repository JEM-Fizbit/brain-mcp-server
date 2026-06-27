import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "brain-sync-test-"));

const { FileRevisionStore, MemoryRevisionStore, LocalSyncAgent } = await import(
  path.join(__dirname, "..", "dist", "sync", "index.js")
);

after(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

function dirs(name) {
  const root = path.join(tmpRoot, name);
  return {
    brainDir: path.join(root, "brain"),
    stateFile: path.join(root, ".brain-sync", "state.json"),
  };
}

async function writeBrainFile(brainDir, filename, content) {
  const fullPath = path.join(brainDir, filename);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, "utf-8");
}

async function readBrainFile(brainDir, filename) {
  return fs.readFile(path.join(brainDir, filename), "utf-8");
}

function makeAgent(store, options) {
  return new LocalSyncAgent({
    brainId: "ai-brain-jem",
    store,
    actor: { provider: "test", id: "agent" },
    ...options,
  });
}

function assertTiming(report, operation, phase) {
  const timing = report.timings.find(
    (entry) => entry.operation === operation && entry.phase === phase
  );
  assert.ok(timing, `missing timing ${operation}:${phase}`);
  assert.equal(typeof timing.ms, "number");
  assert.ok(timing.ms >= 0);
}

async function accept(result) {
  assert.equal(result.ok, true);
  return result.head;
}

test("local Markdown edit pushes to hosted revision store", async () => {
  const store = new MemoryRevisionStore();
  const { brainDir, stateFile } = dirs("local-to-hosted");
  await writeBrainFile(brainDir, "NOW.md", "Local first\n");

  const report = await makeAgent(store, { brainDir, stateFile }).pushLocalChanges();

  assert.deepEqual(report.pushed, ["NOW.md"]);
  assert.equal(report.conflicts.length, 0);
  assertTiming(report, "push", "local_scan");
  assertTiming(report, "push", "revision_store_write");
  assertTiming(report, "push", "total");

  const hosted = await store.readFile("ai-brain-jem", "NOW.md");
  assert.equal(hosted.content, "Local first\n");
  assert.equal(hosted.origin, "local_agent");
});

test("local sync ignores a nested duplicate Brain vault under a valid Brain root", async () => {
  const store = new MemoryRevisionStore();
  const { brainDir, stateFile } = dirs("nested-duplicate-vault");
  await writeBrainFile(brainDir, "00_loader.md", "Root loader\n");
  await writeBrainFile(brainDir, "NOW.md", "Root now\n");
  await writeBrainFile(brainDir, "brain/00_loader.md", "Nested loader\n");
  await writeBrainFile(brainDir, "brain/NOW.md", "Nested now\n");

  const report = await makeAgent(store, { brainDir, stateFile }).pushLocalChanges();

  assert.deepEqual(report.pushed, ["00_loader.md", "NOW.md"]);
  assert.equal(report.conflicts.length, 0);
  await assert.rejects(
    store.readFile("ai-brain-jem", "brain/00_loader.md"),
    /File not found/
  );
  await assert.rejects(
    store.readFile("ai-brain-jem", "brain/NOW.md"),
    /File not found/
  );
});

test("local sync rejects a parent container when the Brain root is nested", async () => {
  const store = new MemoryRevisionStore();
  const root = path.join(tmpRoot, "container-root");
  const brainDir = root;
  const stateFile = path.join(root, ".brain-sync", "state.json");
  await writeBrainFile(path.join(root, "brain"), "00_loader.md", "Nested loader\n");
  await writeBrainFile(path.join(root, "brain"), "NOW.md", "Nested now\n");

  await assert.rejects(
    makeAgent(store, { brainDir, stateFile }).pushLocalChanges(),
    /BRAIN_DIR.*Brain root/
  );
});

test("hosted MCP write pulls to clean local Markdown tree", async () => {
  const store = new MemoryRevisionStore();
  const { brainDir, stateFile } = dirs("hosted-to-local");
  await accept(
    await store.proposeRevision({
      brainId: "ai-brain-jem",
      filename: "NOW.md",
      baseRevisionId: null,
      content: "Remote first\n",
      origin: "hosted_mcp",
      actor: { provider: "github", id: "123", name: "John" },
    })
  );

  const report = await makeAgent(store, { brainDir, stateFile }).pullHostedChanges();

  assert.deepEqual(report.pulled, ["NOW.md"]);
  assert.equal(report.conflicts.length, 0);
  assertTiming(report, "pull", "revision_store_list");
  assertTiming(report, "pull", "revision_store_read");
  assertTiming(report, "pull", "local_write");
  assertTiming(report, "pull", "total");
  assert.equal(await readBrainFile(brainDir, "NOW.md"), "Remote first\n");
});

test("pull restores a tracked hosted file that is missing locally", async () => {
  const store = new MemoryRevisionStore();
  const { brainDir, stateFile } = dirs("restore-missing-tracked-local");
  await accept(
    await store.proposeRevision({
      brainId: "ai-brain-jem",
      filename: "NOW.md",
      baseRevisionId: null,
      content: "Remote canonical\n",
      origin: "hosted_mcp",
    })
  );
  const agent = makeAgent(store, { brainDir, stateFile });
  await agent.pullHostedChanges();
  await fs.rm(path.join(brainDir, "NOW.md"));

  const report = await agent.pullHostedChanges();

  assert.deepEqual(report.pulled, ["NOW.md"]);
  assert.equal(report.conflicts.length, 0);
  assert.equal(await readBrainFile(brainDir, "NOW.md"), "Remote canonical\n");
});

test("hosted write does not overwrite dirty local Markdown", async () => {
  const store = new MemoryRevisionStore();
  const { brainDir, stateFile } = dirs("dirty-local-block");
  const base = await accept(
    await store.proposeRevision({
      brainId: "ai-brain-jem",
      filename: "NOW.md",
      baseRevisionId: null,
      content: "Base\n",
      origin: "hosted_mcp",
    })
  );
  const agent = makeAgent(store, { brainDir, stateFile });
  await agent.pullHostedChanges();
  await writeBrainFile(brainDir, "NOW.md", "Local dirty\n");

  await accept(
    await store.proposeRevision({
      brainId: "ai-brain-jem",
      filename: "NOW.md",
      baseRevisionId: base.revisionId,
      content: "Remote update\n",
      origin: "hosted_mcp",
    })
  );

  const report = await agent.pullHostedChanges();

  assert.equal(report.pulled.length, 0);
  assert.equal(report.conflicts.length, 1);
  assert.equal(report.conflicts[0].filename, "NOW.md");
  assert.equal(await readBrainFile(brainDir, "NOW.md"), "Local dirty\n");
});

test("stale local edit conflicts instead of overwriting newer hosted head", async () => {
  const store = new MemoryRevisionStore();
  const { brainDir, stateFile } = dirs("dirty-hosted-block");
  const base = await accept(
    await store.proposeRevision({
      brainId: "ai-brain-jem",
      filename: "NOW.md",
      baseRevisionId: null,
      content: "Base\n",
      origin: "hosted_mcp",
    })
  );
  const agent = makeAgent(store, { brainDir, stateFile });
  await agent.pullHostedChanges();

  await accept(
    await store.proposeRevision({
      brainId: "ai-brain-jem",
      filename: "NOW.md",
      baseRevisionId: base.revisionId,
      content: "Remote update\n",
      origin: "hosted_mcp",
    })
  );
  await writeBrainFile(brainDir, "NOW.md", "Local stale edit\n");

  const report = await agent.pushLocalChanges();

  assert.equal(report.pushed.length, 0);
  assert.equal(report.conflicts.length, 1);
  assert.equal(report.conflicts[0].filename, "NOW.md");

  const hosted = await store.readFile("ai-brain-jem", "NOW.md");
  assert.equal(hosted.content, "Remote update\n");
  assert.equal(await readBrainFile(brainDir, "NOW.md"), "Local stale edit\n");
});

test("file revision store persists heads and conflicts across instances", async () => {
  const storeFile = path.join(tmpRoot, "file-store", "revision-store.json");
  const store = new FileRevisionStore(storeFile);
  const base = await accept(
    await store.proposeRevision({
      brainId: "ai-brain-jem",
      filename: "NOW.md",
      baseRevisionId: null,
      content: "Persistent base\n",
      origin: "hosted_mcp",
    })
  );
  const conflict = await store.proposeRevision({
    brainId: "ai-brain-jem",
    filename: "NOW.md",
    baseRevisionId: null,
    content: "Stale write\n",
    origin: "local_agent",
  });
  assert.equal(conflict.ok, false);

  const restarted = new FileRevisionStore(storeFile);
  const hosted = await restarted.readFile("ai-brain-jem", "NOW.md");
  const conflicts = await restarted.listConflicts("ai-brain-jem", "open");

  assert.equal(hosted.revisionId, base.revisionId);
  assert.equal(hosted.content, "Persistent base\n");
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].filename, "NOW.md");

  const resolution = await restarted.resolveConflict({
    brainId: "ai-brain-jem",
    conflictId: conflicts[0].conflictId,
    content: "Persistent resolution\n",
    actor: { provider: "test", id: "resolver" },
  });
  assert.equal(resolution.conflict.status, "resolved");
  assert.equal(resolution.conflict.resolutionRevisionId, resolution.revision.revisionId);
  assert.equal(resolution.revision.content, "Persistent resolution\n");

  const resolvedStore = new FileRevisionStore(storeFile);
  assert.equal(
    (await resolvedStore.readFile("ai-brain-jem", "NOW.md")).content,
    "Persistent resolution\n"
  );
  assert.equal((await resolvedStore.listConflicts("ai-brain-jem", "open")).length, 0);
  assert.equal(
    (await resolvedStore.listConflicts("ai-brain-jem", "resolved")).length,
    1
  );
});

test("local sync agent can use file revision store after restart", async () => {
  const { brainDir, stateFile } = dirs("file-store-agent");
  const storeFile = path.join(tmpRoot, "file-store-agent", "hosted.json");
  await writeBrainFile(brainDir, "NOW.md", "Pushed through file store\n");

  const pushReport = await makeAgent(new FileRevisionStore(storeFile), {
    brainDir,
    stateFile,
  }).pushLocalChanges();
  assert.deepEqual(pushReport.pushed, ["NOW.md"]);

  const restartedStore = new FileRevisionStore(storeFile);
  const hosted = await restartedStore.readFile("ai-brain-jem", "NOW.md");
  assert.equal(hosted.content, "Pushed through file store\n");

  await accept(
    await restartedStore.proposeRevision({
      brainId: "ai-brain-jem",
      filename: "Reference/nested.md",
      baseRevisionId: null,
      content: "Nested remote file\n",
      origin: "hosted_mcp",
    })
  );

  const pullReport = await makeAgent(restartedStore, {
    brainDir,
    stateFile,
  }).pullHostedChanges();
  assert.deepEqual(pullReport.pulled, ["Reference/nested.md"]);
  assert.equal(
    await readBrainFile(brainDir, "Reference/nested.md"),
    "Nested remote file\n"
  );
});

test("local sync agent can restrict push and pull to explicit files", async () => {
  const store = new MemoryRevisionStore();
  const { brainDir, stateFile } = dirs("include-files");
  await writeBrainFile(brainDir, "NOW.md", "Included local file\n");
  await writeBrainFile(brainDir, "TASKS.md", "Excluded local file\n");

  const agent = makeAgent(store, {
    brainDir,
    stateFile,
    includeFiles: ["NOW.md"],
  });
  const pushReport = await agent.pushLocalChanges();

  assert.deepEqual(pushReport.pushed, ["NOW.md"]);
  await assert.rejects(
    store.readFile("ai-brain-jem", "TASKS.md"),
    /File not found/
  );

  await accept(
    await store.proposeRevision({
      brainId: "ai-brain-jem",
      filename: "TASKS.md",
      baseRevisionId: null,
      content: "Excluded remote file\n",
      origin: "hosted_mcp",
    })
  );

  const pullReport = await agent.pullHostedChanges();
  assert.equal(pullReport.pulled.length, 0);
  assert.equal(await readBrainFile(brainDir, "TASKS.md"), "Excluded local file\n");
});
