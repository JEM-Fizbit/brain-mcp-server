#!/usr/bin/env node
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createBrainLibraryServer } from "../dist/brain-library/index.js";
import { loadLocalEnv } from "./lib/load-local-env.mjs";

loadLocalEnv();
const exec = promisify(execFile);
const brainId = process.env.BRAIN_LIBRARY_BRAIN_ID || process.env.BRAIN_ID || "ai-brain-jem";
if (brainId !== "ai-brain-jem") {
  console.error("Brain Library pilot is JEM-only. Refusing to start for a different Brain id.");
  process.exit(2);
}
const brainRoot = path.resolve(
  process.env.BRAIN_LIBRARY_ROOT || process.env.BRAIN_REPO_ROOT || process.cwd()
);
const host = "127.0.0.1";
const port = Number(process.env.BRAIN_LIBRARY_PORT || 8797);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error("BRAIN_LIBRARY_PORT must be a valid TCP port.");
  process.exit(2);
}
let configuredRoots = {};
try {
  configuredRoots = JSON.parse(process.env.BRAIN_LIBRARY_ROOTS_JSON || "{}");
} catch {
  console.error("BRAIN_LIBRARY_ROOTS_JSON must be a JSON object of root aliases to local paths.");
  process.exit(2);
}
const roots = { brain_repo: brainRoot, ...configuredRoots };
const allowLocalOpen = process.env.BRAIN_LIBRARY_ALLOW_LOCAL_OPEN === "1";
const server = createBrainLibraryServer({
  brainRoot,
  brainId,
  roots,
  allowLocalOpen,
  openArtifact: async (artifactPath) => {
    await exec("/usr/bin/open", [artifactPath]);
  },
});
server.listen(port, host, () => {
  console.log(`JEM Brain Library: http://${host}:${port}/`);
  console.log(`Root: ${brainRoot}`);
  console.log(`Local artifact opening: ${allowLocalOpen ? "enabled" : "disabled"}`);
});
