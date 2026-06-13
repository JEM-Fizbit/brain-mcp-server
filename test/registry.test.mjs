import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "brain-registry-test-"));
const brainDir = path.join(tmpDir, "brain");
const sourcesDir = path.join(tmpDir, "sources");
const registryFile = path.join(tmpDir, "registry.json");

process.env.BRAIN_DIR = brainDir;
process.env.BRAIN_SOURCES_DIR = sourcesDir;
process.env.BRAIN_PLATFORM_CONFIG = registryFile;

const registry = await import(
  path.join(__dirname, "..", "dist", "services", "registry.js")
);

after(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

async function writeRegistry(data) {
  await fs.writeFile(registryFile, JSON.stringify(data, null, 2), "utf-8");
}

test("loads explicit registry and resolves single accessible Brain", async () => {
  await writeRegistry({
    version: 1,
    default_brain_id: "ai-brain-jem",
    brains: [
      {
        id: "ai-brain-jem",
        type: "personal",
        template_used: "personal",
        integration_mode: "vertical",
        storage_backend: "filesystem",
        storage_config: { brain_dir: brainDir, sources_dir: sourcesDir },
      },
    ],
    principals: [
      {
        provider: "github",
        provider_user_id: "123",
        login: "johnemilad",
        roles: { "ai-brain-jem": "owner" },
      },
    ],
  });

  const result = await registry.resolveBrain(undefined, {
    provider: "github",
    providerUserId: "123",
    login: "johnemilad",
  });

  assert.equal(result.brain.id, "ai-brain-jem");
  assert.equal(result.role, "owner");
});

test("requires brain_id when principal can access multiple Brains", async () => {
  await writeRegistry({
    version: 1,
    brains: [
      {
        id: "ai-brain-jem",
        type: "personal",
        template_used: "personal",
        integration_mode: "vertical",
        storage_backend: "filesystem",
        storage_config: { brain_dir: brainDir },
      },
      {
        id: "project-brain",
        type: "shared",
        template_used: "project",
        integration_mode: "vertical",
        storage_backend: "filesystem",
        storage_config: { brain_dir: path.join(tmpDir, "project", "brain") },
      },
    ],
    principals: [
      {
        provider: "github",
        provider_user_id: "123",
        roles: { "ai-brain-jem": "owner", "project-brain": "reader" },
      },
    ],
  });

  await assert.rejects(
    () =>
      registry.resolveBrain(undefined, {
        provider: "github",
        providerUserId: "123",
      }),
    /brain_id is required/i
  );

  const explicit = await registry.resolveBrain("project-brain", {
    provider: "github",
    providerUserId: "123",
  });
  assert.equal(explicit.brain.id, "project-brain");
  assert.equal(explicit.role, "reader");
});

test("GitHub allowed login grants default Brain owner fallback", async () => {
  process.env.GITHUB_ALLOWED_LOGINS = "johnemilad";
  await writeRegistry({
    version: 1,
    default_brain_id: "ai-brain-jem",
    brains: [
      {
        id: "ai-brain-jem",
        type: "personal",
        template_used: "personal",
        integration_mode: "vertical",
        storage_backend: "filesystem",
        storage_config: { brain_dir: brainDir },
      },
    ],
  });

  const result = await registry.resolveBrain(undefined, {
    provider: "github",
    providerUserId: "123",
    login: "johnemilad",
  });

  assert.equal(result.brain.id, "ai-brain-jem");
  assert.equal(result.role, "owner");
});
