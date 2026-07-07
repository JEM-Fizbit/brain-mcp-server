import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "brain-write-integrity-"));
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

after(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// Every JavaScript String.replace $-pattern in one replacement string:
// $$ (escaped dollar), $& (matched text), $` (preceding slice), $' (following slice).
const DOLLAR_REPLACEMENT = "costs $$100, match=$&, pre=$` post=$' end";

// Literal oracle: split/join never interprets replacement patterns.
function literalPatch(seed, oldContent, next) {
  return seed.split(oldContent).join(next);
}

test("filesystem patch mode preserves $-patterns byte-for-byte", async () => {
  const seed = "# Notes\n\nBudget line OLD here\n";
  await fs.writeFile(path.join(brainDir, "PATCH_FS.md"), seed, "utf-8");

  await brain.updateFile("PATCH_FS.md", DOLLAR_REPLACEMENT, "patch", "OLD");

  const result = await fs.readFile(path.join(brainDir, "PATCH_FS.md"), "utf-8");
  assert.equal(result, literalPatch(seed, "OLD", DOLLAR_REPLACEMENT));
});

test("hosted patch mode preserves $-patterns byte-for-byte", async () => {
  const store = new RevisionBrainStore(new MemoryRevisionStore());
  const seed = "# Notes\n\nBudget line OLD here\n";
  await store.writeFile("ai-brain-jem", "PATCH_HOSTED.md", seed, "replace");

  await store.writeFile(
    "ai-brain-jem",
    "PATCH_HOSTED.md",
    DOLLAR_REPLACEMENT,
    "patch",
    "OLD"
  );

  const result = await store.readFile("ai-brain-jem", "PATCH_HOSTED.md");
  assert.equal(result, literalPatch(seed, "OLD", DOLLAR_REPLACEMENT));
});

test("filesystem append to an empty file adds no leading newline", async () => {
  await fs.writeFile(path.join(brainDir, "APPEND_FS.md"), "", "utf-8");

  await brain.updateFile("APPEND_FS.md", "first entry\n", "append");

  const result = await fs.readFile(path.join(brainDir, "APPEND_FS.md"), "utf-8");
  assert.equal(result, "first entry\n");
});

test("hosted append to an empty file adds no leading newline", async () => {
  const store = new RevisionBrainStore(new MemoryRevisionStore());
  await store.writeFile("ai-brain-jem", "APPEND_HOSTED.md", "", "replace");

  await store.writeFile("ai-brain-jem", "APPEND_HOSTED.md", "first entry\n", "append");

  const result = await store.readFile("ai-brain-jem", "APPEND_HOSTED.md");
  assert.equal(result, "first entry\n");
});
