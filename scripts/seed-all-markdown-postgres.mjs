import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { BRAIN_DIR } from "../dist/constants.js";
import { LocalSyncAgent, PostgresRevisionStore } from "../dist/sync/index.js";

const databaseUrl = process.env.BRAIN_REVISION_DATABASE_URL;

if (!databaseUrl) {
  console.error(
    "BRAIN_REVISION_DATABASE_URL is missing. Set it in your shell before running the full Markdown seed."
  );
  process.exit(2);
}

const brainId = process.env.BRAIN_ID || "ai-brain-jem";
const sourceBrainDir = process.env.BRAIN_DIR || BRAIN_DIR;
const stateFile =
  process.env.BRAIN_SYNC_STATE_FILE ||
  path.resolve(sourceBrainDir, "..", ".brain-sync", "state.json");

async function listMarkdownFiles(root) {
  const files = [];

  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        files.push(path.relative(root, fullPath).split(path.sep).join("/"));
      }
    }
  }

  await walk(root);
  return files.sort();
}

const store = new PostgresRevisionStore(databaseUrl);

try {
  const localMarkdownFiles = await listMarkdownFiles(sourceBrainDir);
  const pushAgent = new LocalSyncAgent({
    brainId,
    brainDir: sourceBrainDir,
    stateFile,
    store,
    actor: {
      provider: "local_sync_cli",
      id: process.env.USER || "local",
      name: process.env.USER || "local",
    },
  });

  console.log(`[seed-all] Pushing ${localMarkdownFiles.length} Markdown files to ${brainId}`);
  const pushReport = await pushAgent.pushLocalChanges();
  assert.equal(pushReport.conflicts.length, 0, "full Markdown seed should not create conflicts");

  const hostedHeads = await store.listFiles(brainId);
  const hostedFiles = hostedHeads.map((head) => head.filename).sort();
  assert.deepEqual(hostedFiles, localMarkdownFiles);

  const mirrorRoot = await fs.mkdtemp(path.join(os.tmpdir(), "brain-all-md-verify-"));
  const mirrorBrainDir = path.join(mirrorRoot, "brain");
  const mirrorStateFile = path.join(mirrorRoot, ".brain-sync", "state.json");

  try {
    await fs.mkdir(mirrorBrainDir, { recursive: true });
    const pullAgent = new LocalSyncAgent({
      brainId,
      brainDir: mirrorBrainDir,
      stateFile: mirrorStateFile,
      store,
      actor: {
        provider: "local_sync_cli",
        id: process.env.USER || "local",
        name: process.env.USER || "local",
      },
    });
    const pullReport = await pullAgent.pullHostedChanges();
    assert.equal(pullReport.conflicts.length, 0, "fresh mirror pull should not create conflicts");

    for (const filename of localMarkdownFiles) {
      const source = await fs.readFile(path.join(sourceBrainDir, filename), "utf-8");
      const pulled = await fs.readFile(path.join(mirrorBrainDir, filename), "utf-8");
      assert.equal(pulled, source, `${filename} should match local Brain content`);
    }

    console.log(
      JSON.stringify(
        {
          localMarkdownFiles: localMarkdownFiles.length,
          pushed: pushReport.pushed.length,
          unchanged: pushReport.unchanged.length,
          pullVerified: localMarkdownFiles.length,
          conflicts: pushReport.conflicts.length + pullReport.conflicts.length,
        },
        null,
        2
      )
    );
    console.log("[seed-all] PASS: all hosted Markdown files match local Brain byte-for-byte");
  } finally {
    await fs.rm(mirrorRoot, { recursive: true, force: true }).catch(() => undefined);
  }
} finally {
  await store.close();
}
