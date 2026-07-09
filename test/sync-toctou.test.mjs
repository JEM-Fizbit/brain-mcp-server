import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "brain-sync-toctou-"));

const { MemoryRevisionStore, LocalSyncAgent } = await import(
  path.join(__dirname, "..", "dist", "sync", "index.js")
);

after(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

// Delegating wrapper whose readFile also mutates the local file first —
// deterministically reproducing a local edit landing inside the pull window
// between the agent's clean-hash check and its overwrite.
function storeThatEditsLocallyDuringRead(store, localPath, localEdit) {
  return {
    getHead: (...args) => store.getHead(...args),
    listFiles: (...args) => store.listFiles(...args),
    proposeRevision: (...args) => store.proposeRevision(...args),
    recordConflict: (...args) => store.recordConflict(...args),
    listConflicts: (...args) => store.listConflicts(...args),
    listChanges: (...args) => store.listChanges(...args),
    readFile: async (...args) => {
      await fs.writeFile(localPath, localEdit, "utf-8");
      return store.readFile(...args);
    },
  };
}

test("pull records a conflict instead of overwriting a local edit that lands mid-pull", async () => {
  const store = new MemoryRevisionStore();
  const root = path.join(tmpRoot, "mid-pull-edit");
  const brainDir = path.join(root, "brain");
  const stateFile = path.join(root, ".brain-sync", "state.json");
  const localPath = path.join(brainDir, "NOW.md");
  await fs.mkdir(brainDir, { recursive: true });
  await fs.writeFile(localPath, "v1\n", "utf-8");

  const actor = { provider: "test", id: "agent" };
  const pushAgent = new LocalSyncAgent({
    brainId: "ai-brain-jem",
    store,
    actor,
    brainDir,
    stateFile,
  });
  const pushReport = await pushAgent.pushLocalChanges();
  assert.deepEqual(pushReport.pushed, ["NOW.md"]);

  const head = await store.getHead("ai-brain-jem", "NOW.md");
  const remote = await store.proposeRevision({
    brainId: "ai-brain-jem",
    filename: "NOW.md",
    baseRevisionId: head.revisionId,
    content: "remote v2\n",
    origin: "hosted_mcp",
  });
  assert.equal(remote.status, "accepted");

  const localEdit = "local edit during pull\n";
  const pullAgent = new LocalSyncAgent({
    brainId: "ai-brain-jem",
    store: storeThatEditsLocallyDuringRead(store, localPath, localEdit),
    actor,
    brainDir,
    stateFile,
  });
  const report = await pullAgent.pullHostedChanges();

  assert.equal(
    await fs.readFile(localPath, "utf-8"),
    localEdit,
    "a concurrent local edit must never be silently overwritten"
  );
  assert.equal(report.pulled.length, 0);
  assert.equal(report.conflicts.length, 1);
  assert.equal(report.conflicts[0].filename, "NOW.md");

  const leftovers = (await fs.readdir(brainDir)).filter((name) =>
    name.includes(".brain-sync-tmp")
  );
  assert.deepEqual(leftovers, [], "no temp files left behind");
});

// The former "restore of a missing tracked file yields to a local write that
// lands mid-restore" test was removed with spec 011: pull no longer resurrects
// a locally-missing file (that path was the resurrection branch review-1 flagged
// as fighting guarded push-side deletion). The surviving safety property — a
// locally-modified file that is tombstoned remotely is never clobbered — is
// covered by test/sync-pull-tombstone.test.mjs.
