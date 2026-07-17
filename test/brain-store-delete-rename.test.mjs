import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "brain-store-delrn-"));
const brainDir = path.join(tmpDir, "brain");
await fs.mkdir(brainDir, { recursive: true });

process.env.BRAIN_DIR = brainDir;
delete process.env.BRAIN_PLATFORM_CONFIG;
process.env.BRAIN_DATE_TIME_ZONE = "UTC";

const brain = await import(path.join(__dirname, "..", "dist", "services", "brain.js"));
const { MemoryRevisionStore } = await import(
  path.join(__dirname, "..", "dist", "sync", "index.js")
);
const { RevisionBrainStore } = await import(
  path.join(__dirname, "..", "dist", "services", "revision-brain-store.js")
);
const { FileDeletedError } = await import(
  path.join(__dirname, "..", "dist", "sync", "types.js")
);

after(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

const B = "b1";

// ---- Filesystem store (stdio path) ----

test("brain.deleteFile removes the file from disk", async () => {
  const p = path.join(brainDir, "del-fs.md");
  await fs.writeFile(p, "# gone\n", "utf-8");
  await brain.deleteFile("del-fs.md");
  await assert.rejects(() => fs.access(p), "file is unlinked");
});

test("brain.renameFile moves the file and refuses to overwrite a live target", async () => {
  await fs.writeFile(path.join(brainDir, "rn-from.md"), "# body\n", "utf-8");
  await brain.renameFile("rn-from.md", "rn-to.md");
  assert.equal(await fs.readFile(path.join(brainDir, "rn-to.md"), "utf-8"), "# body\n");
  await assert.rejects(() => fs.access(path.join(brainDir, "rn-from.md")), "old path gone");

  // Refuse to clobber an existing target.
  await fs.writeFile(path.join(brainDir, "rn-a.md"), "a\n", "utf-8");
  await fs.writeFile(path.join(brainDir, "rn-b.md"), "b\n", "utf-8");
  await assert.rejects(() => brain.renameFile("rn-a.md", "rn-b.md"), /exist/i);
  assert.equal(await fs.readFile(path.join(brainDir, "rn-b.md"), "utf-8"), "b\n", "target untouched");
});

// ---- Hosted (revision) store ----

function hostedStore() {
  return new RevisionBrainStore(new MemoryRevisionStore());
}

test("RevisionBrainStore.deleteFile tombstones: gone from listFiles, readFile throws", async () => {
  const store = hostedStore();
  await store.writeFile(B, "note.md", "# hi\n", "replace");
  await store.deleteFile(B, "note.md");

  const files = await store.listFiles(B);
  assert.equal(files.find((f) => f.name === "note.md"), undefined);
  await assert.rejects(
    () => store.readFile(B, "note.md"),
    (err) => err instanceof FileDeletedError
  );
});

test("RevisionBrainStore.deleteFile on a missing file errors", async () => {
  const store = hostedStore();
  await assert.rejects(() => store.deleteFile(B, "nope.md"), /not found/i);
});

test("RevisionBrainStore.renameFile moves content and clears the old name", async () => {
  const store = hostedStore();
  await store.writeFile(B, "old.md", "# body\n", "replace");
  await store.renameFile(B, "old.md", "new.md");

  assert.equal(await store.readFile(B, "new.md"), "# body\n");
  const files = await store.listFiles(B);
  assert.equal(files.find((f) => f.name === "new.md")?.name, "new.md");
  assert.equal(files.find((f) => f.name === "old.md"), undefined);
});

test("RevisionBrainStore.restoreFile brings back the last content after a delete", async () => {
  const store = hostedStore();
  await store.writeFile(B, "note.md", "v1\n", "replace");
  await store.writeFile(B, "note.md", "v2 final\n", "replace");
  await store.deleteFile(B, "note.md");
  await store.restoreFile(B, "note.md");
  assert.equal(await store.readFile(B, "note.md"), "v2 final\n");
  const files = await store.listFiles(B);
  assert.equal(files.find((f) => f.name === "note.md")?.name, "note.md");
});

test("restoreFile errors when the file is not deleted", async () => {
  const store = hostedStore();
  await store.writeFile(B, "live.md", "x\n", "replace");
  await assert.rejects(() => store.restoreFile(B, "live.md"), /not deleted|nothing to restore/i);
});

test("deleteFile refuses the protected structural files", async () => {
  const store = hostedStore();
  await store.writeFile(
    B,
    "00_loader.md",
    "loader\n",
    "replace",
    undefined,
    undefined,
    "admin"
  );
  await assert.rejects(() => store.deleteFile(B, "00_loader.md"), /protected/i);
});

test("renameFile refuses to rename a protected file away", async () => {
  const store = hostedStore();
  await store.writeFile(
    B,
    "NOW.md",
    "now\n",
    "replace",
    undefined,
    undefined,
    "owner"
  );
  await assert.rejects(() => store.renameFile(B, "NOW.md", "renamed.md"), /protected/i);
});
