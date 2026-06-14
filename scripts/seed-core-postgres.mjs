import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { BRAIN_DIR } from "../dist/constants.js";
import { LocalSyncAgent, PostgresRevisionStore } from "../dist/sync/index.js";

const databaseUrl = process.env.BRAIN_REVISION_DATABASE_URL;

if (!databaseUrl) {
  console.error(
    "BRAIN_REVISION_DATABASE_URL is missing. Set it in your shell before running the core seed."
  );
  process.exit(2);
}

const brainId = process.env.BRAIN_ID || "ai-brain-jem";
const brainDir = process.env.BRAIN_DIR || BRAIN_DIR;
const stateFile =
  process.env.BRAIN_SYNC_STATE_FILE ||
  path.resolve(brainDir, "..", ".brain-sync", "state.json");

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
  brainDir,
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
  for (const filename of coreFiles) {
    await fs.access(path.join(brainDir, filename));
  }

  console.log(`[seed] Pushing ${coreFiles.length} core files to ${brainId}`);
  const report = await agent.pushLocalChanges();
  assert.equal(report.conflicts.length, 0, "core seed should not create conflicts");

  const hosted = await store.listFiles(brainId);
  const hostedFiles = new Set(hosted.map((head) => head.filename));
  for (const filename of coreFiles) {
    assert.ok(hostedFiles.has(filename), `${filename} should exist in hosted store`);
  }

  console.log(
    JSON.stringify(
      {
        pushed: report.pushed,
        unchanged: report.unchanged,
        conflicts: report.conflicts.length,
        hostedCoreFiles: coreFiles.length,
      },
      null,
      2
    )
  );
  console.log("[seed] PASS: core Brain files are present in Supabase Postgres");
} finally {
  await store.close();
}
