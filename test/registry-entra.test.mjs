import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "brain-registry-entra-"));
const registryPath = path.join(tmp, "registry.json");
const oldConfig = process.env.BRAIN_PLATFORM_CONFIG;
const oldProviders = process.env.BRAIN_IDENTITY_PROVIDERS;
process.env.BRAIN_PLATFORM_CONFIG = registryPath;
process.env.BRAIN_IDENTITY_PROVIDERS = "entra";
const registry = await import(path.join(__dirname, "..", "dist", "services", "registry.js"));

const tenant = "11111111-1111-4111-8111-111111111111";
const objectId = "22222222-2222-4222-8222-222222222222";
const base = {
  version: 1,
  default_brain_id: "ers-brain",
  brains: [{
    id: "ers-brain",
    type: "shared",
    template_used: "ers",
    integration_mode: "vertical",
    storage_backend: "postgres",
    storage_config: {},
  }],
};

after(async () => {
  if (oldConfig === undefined) delete process.env.BRAIN_PLATFORM_CONFIG;
  else process.env.BRAIN_PLATFORM_CONFIG = oldConfig;
  if (oldProviders === undefined) delete process.env.BRAIN_IDENTITY_PROVIDERS;
  else process.env.BRAIN_IDENTITY_PROVIDERS = oldProviders;
  await fs.rm(tmp, { recursive: true, force: true });
});

async function write(value) {
  await fs.writeFile(registryPath, JSON.stringify(value), "utf-8");
}

test("stable Entra tenant/object mismatch cannot fall through to mutable email", async () => {
  await write({
    ...base,
    principals: [{
      provider: "entra",
      provider_tenant_id: tenant,
      provider_user_id: objectId,
      email: "person@ers.example",
      roles: { "ers-brain": "owner" },
    }],
  });
  await assert.rejects(
    () => registry.resolveBrain("ers-brain", {
      provider: "entra",
      providerTenantId: tenant,
      providerUserId: "33333333-3333-4333-8333-333333333333",
      email: "person@ers.example",
    }),
    /not accessible/i
  );
});

test("registry rejects duplicate Entra tenant/object pairs and malformed GUIDs", async () => {
  const principal = {
    provider: "entra",
    provider_tenant_id: tenant,
    provider_user_id: objectId,
    roles: { "ers-brain": "owner" },
  };
  await write({ ...base, principals: [principal, { ...principal, name: "Duplicate" }] });
  await assert.rejects(() => registry.loadRegistry(), /duplicate registry principal/i);

  await write({ ...base, principals: [{ ...principal, provider_tenant_id: "common" }] });
  await assert.rejects(() => registry.loadRegistry(), /exact GUID/i);
});

test("Entra-only registry refuses GitHub principals", async () => {
  await write({
    ...base,
    principals: [{
      provider: "github",
      provider_user_id: "123",
      roles: { "ers-brain": "owner" },
    }],
  });
  await assert.rejects(() => registry.loadRegistry(), /refuses GitHub registry principals/i);
});
