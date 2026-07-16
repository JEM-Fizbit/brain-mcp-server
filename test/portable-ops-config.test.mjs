import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

test("hosted doctor selects Fly app from BRAIN_FLY_APP", () => {
  const script = read("scripts/hosted-doctor.mjs");
  assert.match(script, /process\.env\.BRAIN_FLY_APP/);
  assert.doesNotMatch(script, /\["status", "--app", "jem-brain-mcp"\]/);
});

test("source pipeline requires an explicit repository root", () => {
  for (const relativePath of [
    "scripts/inventory-source-artifacts-postgres.mjs",
    "scripts/upload-source-artifacts-postgres.mjs",
    "scripts/extract-source-text-postgres.mjs",
  ]) {
    const script = read(relativePath);
    assert.match(script, /BRAIN_REPO_ROOT is missing/);
    assert.doesNotMatch(script, /\/Users\/johnemilad\/Projects\/ai-brain-jem/);
  }
});
test("source upload requires an explicit Supabase project URL", () => {
  for (const relativePath of [
    "scripts/upload-source-artifacts-postgres.mjs",
    "scripts/run-source-upload-interactive.sh",
  ]) {
    const script = read(relativePath);
    assert.match(script, /BRAIN_SUPABASE_URL/);
    assert.doesNotMatch(script, /omnwbcdtmtvxasgdmvwr/);
  }
});
