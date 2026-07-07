import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

test("server version is not hardcoded in source", async () => {
  const offenders = [];
  for (const rel of ["src/mcp-server.ts", "src/http/server.ts"]) {
    const text = await fs.readFile(path.join(root, rel), "utf-8");
    if (/version:\s*"\d+\.\d+\.\d+"/.test(text)) offenders.push(rel);
  }
  assert.deepEqual(
    offenders,
    [],
    `hardcoded semver found (must use SERVER_VERSION from constants): ${offenders.join(", ")}`
  );
});

test("SERVER_VERSION matches package.json (the which-build-is-deployed tell)", async () => {
  const pkg = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf-8"));
  const constants = await import(path.join(root, "dist", "constants.js"));
  assert.equal(constants.SERVER_VERSION, pkg.version);
});
