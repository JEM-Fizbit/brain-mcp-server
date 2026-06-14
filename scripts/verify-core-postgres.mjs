import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { BRAIN_DIR } from "../dist/constants.js";
import { LocalSyncAgent, PostgresRevisionStore } from "../dist/sync/index.js";

const databaseUrl = process.env.BRAIN_REVISION_DATABASE_URL;

if (!databaseUrl) {
  console.error(
    "BRAIN_REVISION_DATABASE_URL is missing. Set it in your shell before running core verification."
  );
  process.exit(2);
}

const brainId = process.env.BRAIN_ID || "ai-brain-jem";
const sourceBrainDir = process.env.BRAIN_DIR || BRAIN_DIR;
const mirrorRoot = await fs.mkdtemp(path.join(os.tmpdir(), "brain-core-verify-"));
const mirrorBrainDir = path.join(mirrorRoot, "brain");
const stateFile = path.join(mirrorRoot, ".brain-sync", "state.json");

const coreFiles = [
  "00_loader.md",
  "01_identity.md",
  "02_expertise.md",
  "03_work_style.md",
  "04_active_roles.md",
  "05_projects.md",
  "06_writing_voice.md",
  "07_interests_learning.md",
  "09_tools_stack.md",
  "10_mental_models.md",
  "11_next_chapter_framework.md",
  "NOW.md",
  "TASKS.md",
  "SOURCES.md",
];

const store = new PostgresRevisionStore(databaseUrl);
const agent = new LocalSyncAgent({
  brainId,
  brainDir: mirrorBrainDir,
  stateFile,
  store,
  includeFiles: coreFiles,
  actor: {
    provider: "local_sync_cli",
    id: process.env.USER || "local",
    name: process.env.USER || "local",
  },
});

try {
  await fs.mkdir(mirrorBrainDir, { recursive: true });
  console.log(`[verify] Pulling ${coreFiles.length} core files into ${mirrorBrainDir}`);
  const report = await agent.pullHostedChanges();
  assert.equal(report.conflicts.length, 0, "core verification should not create conflicts");

  for (const filename of coreFiles) {
    const source = await fs.readFile(path.join(sourceBrainDir, filename), "utf-8");
    const pulled = await fs.readFile(path.join(mirrorBrainDir, filename), "utf-8");
    assert.equal(pulled, source, `${filename} should match local Brain content`);
  }

  console.log(
    JSON.stringify(
      {
        pulled: report.pulled,
        unchanged: report.unchanged,
        conflicts: report.conflicts.length,
        verifiedFiles: coreFiles.length,
      },
      null,
      2
    )
  );
  console.log("[verify] PASS: hosted core files match local Brain byte-for-byte");
} finally {
  await store.close();
  await fs.rm(mirrorRoot, { recursive: true, force: true }).catch(() => undefined);
}
