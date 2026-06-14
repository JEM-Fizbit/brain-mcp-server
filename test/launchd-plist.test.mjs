import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.join(__dirname, "..", "scripts", "write-sync-launchd-plist.mjs");
const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "brain-launchd-test-"));

after(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

test("launchd plist runs the sync CLI with an absolute Node path", async () => {
  const outputPath = path.join(tmpRoot, "com.example.brain-sync.plist");
  const brainRoot = path.join(tmpRoot, "ai-brain");
  const nodePath = "/opt/example/bin/node";
  const syncCliPath = path.join(tmpRoot, "repo", "dist", "sync", "cli.js");

  const { stdout } = await exec(process.execPath, [scriptPath], {
    env: {
      ...process.env,
      BRAIN_REPO_ROOT: brainRoot,
      BRAIN_SYNC_LAUNCHD_LABEL: "com.example.brain-sync",
      BRAIN_SYNC_LAUNCHD_NODE: nodePath,
      BRAIN_SYNC_LAUNCHD_SYNC_CLI: syncCliPath,
      BRAIN_SYNC_LAUNCHD_PLIST: outputPath,
    },
  });

  const result = JSON.parse(stdout);
  const plist = await fs.readFile(outputPath, "utf-8");

  assert.equal(result.outputPath, outputPath);
  assert.equal(result.nodePath, nodePath);
  assert.equal(result.syncCliPath, syncCliPath);
  assert.match(plist, new RegExp(`<string>${nodePath}</string>`));
  assert.match(plist, new RegExp(`<string>${syncCliPath}</string>`));
  assert.doesNotMatch(plist, /<string>\/usr\/bin\/env<\/string>/);
  assert.doesNotMatch(plist, /<string>npm<\/string>/);
  assert.doesNotMatch(plist, /<string>run<\/string>/);
  assert.match(plist, new RegExp(`<string>${path.join(brainRoot, "brain")}</string>`));
});
