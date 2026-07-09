import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { MemoryRevisionStore } = await import(
  path.join(__dirname, "..", "dist", "sync", "index.js")
);
const { RevisionBrainStore } = await import(
  path.join(__dirname, "..", "dist", "services", "revision-brain-store.js")
);
const { rewriteLinksAfterRename, countInboundLinkers } = await import(
  path.join(__dirname, "..", "dist", "services", "link-maintenance.js")
);

const B = "b1";

async function seed(store, obj) {
  for (const [name, content] of Object.entries(obj)) {
    await store.writeFile(B, name, content, "replace");
  }
}

test("rewriteLinksAfterRename updates inbound [[links]] across the brain", async () => {
  const store = new RevisionBrainStore(new MemoryRevisionStore());
  await seed(store, {
    "a.md": "see [[old]] and [[old|Alias]]",
    "b.md": "nothing here",
    "old.md": "# body\n",
  });
  await store.renameFile(B, "old.md", "new.md");
  const summary = await rewriteLinksAfterRename(store, B, "old.md", "new.md");
  assert.equal(summary.updated, 1);
  assert.equal(summary.ambiguous, false);
  assert.equal(await store.readFile(B, "a.md"), "see [[new]] and [[new|Alias]]");
  assert.equal(await store.readFile(B, "b.md"), "nothing here");
});

test("countInboundLinkers reports files linking to a target", async () => {
  const store = new RevisionBrainStore(new MemoryRevisionStore());
  await seed(store, {
    "a.md": "[[doomed]]",
    "b.md": "[[doomed|x]]",
    "c.md": "unrelated",
    "doomed.md": "x\n",
  });
  const linkers = await countInboundLinkers(store, B, "doomed.md");
  assert.deepEqual(linkers.sort(), ["a.md", "b.md"]);
});
