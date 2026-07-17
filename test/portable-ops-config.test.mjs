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

test("local operator template configures the hosted doctor target", () => {
  const template = read(".env.local.example");
  assert.match(template, /^BRAIN_HOSTED_BASE_URL=https:\/\/.+$/m);
  assert.match(template, /^BRAIN_FLY_APP=\S+$/m);
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

test("fresh-stack docs list every database migration in file order", () => {
  const migrations = fs
    .readdirSync(path.join(repoRoot, "db", "migrations"))
    .filter((filename) => filename.endsWith(".sql"))
    .sort();

  for (const relativePath of [
    "docs/deploy-fly.md",
    "docs/specs/012-ers-mcp-fork.md",
  ]) {
    const document = read(relativePath);
    const positions = migrations.map((filename) => {
      const position = document.indexOf(filename);
      assert.notEqual(
        position,
        -1,
        `${relativePath} must list db/migrations/${filename}`
      );
      return position;
    });

    assert.deepEqual(
      positions,
      [...positions].sort((left, right) => left - right),
      `${relativePath} must list migrations in filename order`
    );
  }
});
