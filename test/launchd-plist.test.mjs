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
const cockpitScriptPath = path.join(
  __dirname,
  "..",
  "scripts",
  "write-cockpit-launchd-plist.mjs"
);
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

test("cockpit launchd plist runs local cockpit with a stable loopback URL", async () => {
  const outputPath = path.join(tmpRoot, "com.example.brain-cockpit.plist");
  const brainRoot = path.join(tmpRoot, "ai-brain");
  const nodePath = "/opt/example/bin/node";
  const hostedCockpitPath = path.join(tmpRoot, "repo", "scripts", "hosted-cockpit.mjs");

  const { stdout } = await exec(process.execPath, [cockpitScriptPath], {
    env: {
      ...process.env,
      BRAIN_REPO_ROOT: brainRoot,
      BRAIN_COCKPIT_LAUNCHD_LABEL: "com.example.brain-cockpit",
      BRAIN_COCKPIT_LAUNCHD_NODE: nodePath,
      BRAIN_COCKPIT_LAUNCHD_SCRIPT: hostedCockpitPath,
      BRAIN_COCKPIT_LAUNCHD_PLIST: outputPath,
      BRAIN_COCKPIT_PORT: "8799",
    },
  });

  const result = JSON.parse(stdout);
  const plist = await fs.readFile(outputPath, "utf-8");

  assert.equal(result.outputPath, outputPath);
  assert.equal(result.url, "http://127.0.0.1:8799/");
  assert.equal(result.nodePath, nodePath);
  assert.equal(result.cockpitScriptPath, hostedCockpitPath);
  assert.match(plist, new RegExp(`<string>${nodePath}</string>`));
  assert.match(plist, new RegExp(`<string>${hostedCockpitPath}</string>`));
  assert.match(plist, /<key>BRAIN_COCKPIT_HOST<\/key>\s*<string>127\.0\.0\.1<\/string>/);
  assert.match(plist, /<key>BRAIN_COCKPIT_PORT<\/key>\s*<string>8799<\/string>/);
  assert.match(plist, /<key>BRAIN_COCKPIT_PORT_FALLBACK<\/key>\s*<string>0<\/string>/);
  assert.match(plist, /cockpit\.out\.log/);
  assert.match(plist, /cockpit\.err\.log/);
  assert.doesNotMatch(plist, /<string>\/usr\/bin\/env<\/string>/);
  assert.doesNotMatch(plist, /<string>npm<\/string>/);
  assert.doesNotMatch(plist, /<string>run<\/string>/);
});
