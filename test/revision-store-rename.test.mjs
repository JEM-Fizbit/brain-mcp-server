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

async function storeWithLiveFile(filename, content) {
  const store = new MemoryRevisionStore();
  const created = await store.proposeRevision({
    brainId: BRAIN,
    filename,
    baseRevisionId: null,
    content,
    origin: "local_agent",
  });
  assert.equal(created.status, "accepted");
  return { store, head: created.head };
}

test("proposeRename moves content to the new path and tombstones the old", async () => {
  const { store, head } = await storeWithLiveFile("old.md", "# body\ntext\n");
  const result = await store.proposeRename({
    brainId: BRAIN,
    from: "old.md",
    to: "new.md",
    baseRevisionId: head.revisionId,
    origin: "local_agent",
  });
  assert.equal(result.ok, true);
  assert.equal(result.status, "accepted");

  const to = await store.readFile(BRAIN, "new.md");
  assert.equal(to.content, "# body\ntext\n", "content moved to the new path");
  const fromHead = await store.getHead(BRAIN, "old.md");
  assert.equal(fromHead.deleted, true, "old path is tombstoned");
});

test("proposeRename records the renamed_from / renamed_to pairing", async () => {
  const { store, head } = await storeWithLiveFile("old.md", "x\n");
  await store.proposeRename({
    brainId: BRAIN,
    from: "old.md",
    to: "new.md",
    baseRevisionId: head.revisionId,
    origin: "local_agent",
  });
  const toHead = await store.getHead(BRAIN, "new.md");
  const fromHead = await store.getHead(BRAIN, "old.md");
  assert.equal(toHead.renamedFrom, "old.md", "new head links back to the old path");
  assert.equal(fromHead.renamedTo, "new.md", "tombstone links forward to the new path");
});

test("proposeRename with a stale base conflicts and applies NOTHING (atomic)", async () => {
  const { store, head } = await storeWithLiveFile("old.md", "orig\n");
  // Concurrent edit moves old.md's head.
  await store.proposeRevision({
    brainId: BRAIN,
    filename: "old.md",
    baseRevisionId: head.revisionId,
    content: "edited\n",
    origin: "hosted_mcp",
  });
  const result = await store.proposeRename({
    brainId: BRAIN,
    from: "old.md",
    to: "new.md",
    baseRevisionId: head.revisionId, // stale
    origin: "local_agent",
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, "conflict");
  // Neither side changed: old.md still live with the edit, new.md never created.
  assert.equal((await store.getHead(BRAIN, "old.md")).deleted ?? false, false);
  assert.equal((await store.getHead(BRAIN, "new.md")), null, "no duplicate head created");
});

test("proposeRename onto a live target conflicts, leaving the source untouched", async () => {
  const { store, head } = await storeWithLiveFile("old.md", "a\n");
  await store.proposeRevision({
    brainId: BRAIN,
    filename: "taken.md",
    baseRevisionId: null,
    content: "b\n",
    origin: "local_agent",
  });
  const result = await store.proposeRename({
    brainId: BRAIN,
    from: "old.md",
    to: "taken.md",
    baseRevisionId: head.revisionId,
    origin: "local_agent",
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, "conflict");
  assert.equal((await store.getHead(BRAIN, "old.md")).deleted ?? false, false, "source untouched");
  assert.equal((await store.readFile(BRAIN, "taken.md")).content, "b\n", "target untouched");
});

test("FileRevisionStore: a rename persists across reload", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "brain-rename-"));
  const filePath = path.join(dir, "revisions.json");
  try {
    const store = new FileRevisionStore(filePath);
    const created = await store.proposeRevision({
      brainId: BRAIN,
      filename: "old.md",
      baseRevisionId: null,
      content: "# hi\n",
      origin: "local_agent",
    });
    await store.proposeRename({
      brainId: BRAIN,
      from: "old.md",
      to: "new.md",
      baseRevisionId: created.head.revisionId,
      origin: "local_agent",
    });
    const reopened = new FileRevisionStore(filePath);
    const live = await reopened.listFiles(BRAIN);
    assert.equal(live.find((f) => f.filename === "new.md")?.deleted ?? false, false);
    assert.equal(live.find((f) => f.filename === "old.md"), undefined);
    assert.equal((await reopened.readFile(BRAIN, "new.md")).content, "# hi\n");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
