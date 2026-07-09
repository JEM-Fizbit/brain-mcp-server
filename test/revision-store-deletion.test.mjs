import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { MemoryRevisionStore } = await import(
  path.join(__dirname, "..", "dist", "sync", "memory-revision-store.js")
);
const { FileRevisionStore } = await import(
  path.join(__dirname, "..", "dist", "sync", "file-revision-store.js")
);

const BRAIN = "test-brain";

async function storeWithLiveFile(filename = "note.md", content = "# hello\nbody\n") {
  const store = new MemoryRevisionStore();
  const created = await store.proposeRevision({
    brainId: BRAIN,
    filename,
    baseRevisionId: null,
    content,
    origin: "local_agent",
  });
  assert.equal(created.status, "accepted", "setup: file should be created");
  return { store, head: created.head };
}

test("proposeDeletion tombstones a live file: getHead flags it deleted", async () => {
  const { store, head } = await storeWithLiveFile();
  const result = await store.proposeDeletion({
    brainId: BRAIN,
    filename: "note.md",
    baseRevisionId: head.revisionId,
    origin: "local_agent",
  });
  assert.equal(result.ok, true);
  assert.equal(result.status, "accepted");
  const after = await store.getHead(BRAIN, "note.md");
  assert.ok(after, "getHead still returns a head (the tombstone)");
  assert.equal(after.deleted, true, "head is flagged deleted");
});

test("listFiles excludes deleted files by default, includes them with includeDeleted", async () => {
  const { store, head } = await storeWithLiveFile();
  await store.proposeDeletion({
    brainId: BRAIN,
    filename: "note.md",
    baseRevisionId: head.revisionId,
    origin: "local_agent",
  });
  const visible = await store.listFiles(BRAIN);
  assert.equal(
    visible.find((f) => f.filename === "note.md"),
    undefined,
    "default listFiles omits the tombstone"
  );
  const all = await store.listFiles(BRAIN, { includeDeleted: true });
  const row = all.find((f) => f.filename === "note.md");
  assert.ok(row, "includeDeleted surfaces the tombstone");
  assert.equal(row.deleted, true);
});

test("readFile on a deleted head throws FileDeletedError", async () => {
  const { store, head } = await storeWithLiveFile();
  await store.proposeDeletion({
    brainId: BRAIN,
    filename: "note.md",
    baseRevisionId: head.revisionId,
    origin: "local_agent",
  });
  await assert.rejects(
    () => store.readFile(BRAIN, "note.md"),
    (err) => err.name === "FileDeletedError",
    "readFile must throw FileDeletedError, not return null content"
  );
});

test("re-deleting an already-deleted file is idempotent (unchanged)", async () => {
  const { store, head } = await storeWithLiveFile();
  const first = await store.proposeDeletion({
    brainId: BRAIN,
    filename: "note.md",
    baseRevisionId: head.revisionId,
    origin: "local_agent",
  });
  const second = await store.proposeDeletion({
    brainId: BRAIN,
    filename: "note.md",
    baseRevisionId: first.head.revisionId,
    origin: "local_agent",
  });
  assert.equal(second.status, "unchanged");
});

test("recreate over a tombstone with base=null is accepted, not a conflict", async () => {
  const { store, head } = await storeWithLiveFile();
  await store.proposeDeletion({
    brainId: BRAIN,
    filename: "note.md",
    baseRevisionId: head.revisionId,
    origin: "local_agent",
  });
  const recreated = await store.proposeRevision({
    brainId: BRAIN,
    filename: "note.md",
    baseRevisionId: null,
    content: "# hello again\n",
    origin: "local_agent",
  });
  assert.equal(recreated.ok, true, "recreate over a tombstone must not conflict");
  assert.equal(recreated.status, "accepted");
  const after = await store.getHead(BRAIN, "note.md");
  assert.equal(after.deleted ?? false, false, "recreated file is live again");
});

test("FileRevisionStore: a deletion persists across reload (tombstone survives)", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "brain-del-"));
  const filePath = path.join(dir, "revisions.json");
  try {
    const store = new FileRevisionStore(filePath);
    const created = await store.proposeRevision({
      brainId: BRAIN,
      filename: "note.md",
      baseRevisionId: null,
      content: "# hi\n",
      origin: "local_agent",
    });
    const del = await store.proposeDeletion({
      brainId: BRAIN,
      filename: "note.md",
      baseRevisionId: created.head.revisionId,
      origin: "local_agent",
    });
    assert.equal(del.status, "accepted");

    // Fresh store instance reads the same on-disk file.
    const reopened = new FileRevisionStore(filePath);
    const visible = await reopened.listFiles(BRAIN);
    assert.equal(
      visible.find((f) => f.filename === "note.md"),
      undefined,
      "tombstone stays deleted after reload (no resurrection)"
    );
    const all = await reopened.listFiles(BRAIN, { includeDeleted: true });
    assert.equal(all.find((f) => f.filename === "note.md")?.deleted, true);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("proposeDeletion with a stale base conflicts, never silently deletes", async () => {
  const { store, head } = await storeWithLiveFile();
  // A concurrent edit moves the head.
  await store.proposeRevision({
    brainId: BRAIN,
    filename: "note.md",
    baseRevisionId: head.revisionId,
    content: "# edited\n",
    origin: "hosted_mcp",
  });
  const result = await store.proposeDeletion({
    brainId: BRAIN,
    filename: "note.md",
    baseRevisionId: head.revisionId, // stale
    origin: "local_agent",
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, "conflict");
  const still = await store.getHead(BRAIN, "note.md");
  assert.equal(still.deleted ?? false, false, "file remains live after a conflicted delete");
});
