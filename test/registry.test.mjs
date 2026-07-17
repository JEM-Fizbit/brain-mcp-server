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

test("pathsForBrain refuses a non-filesystem backend (S1-guard)", () => {
  assert.throws(
    () =>
      registry.pathsForBrain({
        id: "ers-brain",
        type: "shared",
        template_used: "ers",
        integration_mode: "vertical",
        storage_backend: "postgres",
        storage_config: { brain_dir: "/app/does-not-exist/brain" },
      }),
    /unavailable/i,
    "filesystem path resolution must be refused on a postgres-backed Brain"
  );
});

test("pathsForBrain resolves on a filesystem backend", () => {
  const paths = registry.pathsForBrain({
    id: "ai-brain-jem",
    type: "personal",
    template_used: "personal",
    integration_mode: "vertical",
    storage_backend: "filesystem",
    storage_config: { brain_dir: brainDir, sources_dir: sourcesDir },
  });
  assert.equal(paths.brainDir, brainDir);
  assert.equal(paths.sourcesRoot, sourcesDir);
});

test("registry rejects unknown roles fail-closed", async () => {
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
    ],
    principals: [
      {
        provider: "github",
        provider_user_id: "123",
        roles: { "ai-brain-jem": "editor" },
      },
    ],
  });
  await assert.rejects(() => registry.loadRegistry(), /unsupported brain role/i);
});

test("per-Brain lint override is validated and leaves other Brains legacy", async () => {
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
        id: "ers-brain",
        type: "shared",
        template_used: "ers",
        integration_mode: "vertical",
        storage_backend: "filesystem",
        storage_config: { brain_dir: path.join(tmpDir, "ers", "brain") },
      },
    ],
  });
  process.env.BRAIN_LINT_MODE_OVERRIDES = JSON.stringify({
    "ai-brain-jem": "graph_shadow",
    "ers-brain": "legacy",
  });
  try {
    const loaded = await registry.loadRegistry();
    assert.equal(loaded.brains[0].lint.reachability_mode, "graph_shadow");
    assert.equal(loaded.brains[1].lint.reachability_mode, "legacy");
  } finally {
    delete process.env.BRAIN_LINT_MODE_OVERRIDES;
  }
});

test("lint override fails startup on malformed JSON, unknown modes, and unknown Brains", async () => {
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
    ],
  });
  for (const [value, pattern] of [
    ["{", /valid json/i],
    [JSON.stringify({ "ai-brain-jem": "shadow" }), /unsupported mode/i],
    [JSON.stringify({ "missing-brain": "legacy" }), /unknown brain_id/i],
  ]) {
    process.env.BRAIN_LINT_MODE_OVERRIDES = value;
    await assert.rejects(() => registry.loadRegistry(), pattern);
  }
  delete process.env.BRAIN_LINT_MODE_OVERRIDES;
});
