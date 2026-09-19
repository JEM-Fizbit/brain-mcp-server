import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadLocalEnv, applyBrainMonitorProfileEnvSync } from "../dist/sync/runtime-binding.js";

const JEM_REF = "gfipcidoyrtgngauzijy";

test("loadLocalEnv fills only missing keys and reports which keys it set", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "runtime-binding-"));
  await fs.writeFile(path.join(root, ".env.local"), "FOO_AMBIENT=from-file\nFOO_EXPLICIT=from-file\n");
  const env = { FOO_EXPLICIT: "from-shell" };
  const ambient = loadLocalEnv(root, env);
  assert.deepEqual([...ambient], ["FOO_AMBIENT"]);
  assert.equal(env.FOO_AMBIENT, "from-file");
  assert.equal(env.FOO_EXPLICIT, "from-shell");
});

test("loadLocalEnv applies a Brain Monitor profile named by the ambient file, overriding only ambient keys", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "runtime-binding-"));
  const configFile = path.join(root, "brain-menubar-config.json");
  await fs.writeFile(configFile, JSON.stringify({ brains: [{ brainId: "ai-brain-jem", env: {
    BRAIN_ID: "ai-brain-jem", BRAIN_HOSTED_BASE_URL: "https://jem-brain-mcp.fly.dev",
    BRAIN_REVISION_STORE: "postgres",
    BRAIN_REVISION_DATABASE_URL: `postgresql://brain_jem_sync_user.${JEM_REF}:secret@pooler.example:6543/postgres`,
    BRAIN_EXPECTED_SUPABASE_PROJECT_REF: JEM_REF } }] }));
  await fs.chmod(configFile, 0o600);
  await fs.writeFile(path.join(root, ".env.local"), `BRAIN_MONITOR_CONFIG_FILE=${configFile}\nBRAIN_REVISION_STORE=file\n`);

  const ambientOnly = { BRAIN_ID: "ai-brain-jem" };
  const ambient = loadLocalEnv(root, ambientOnly);
  applyBrainMonitorProfileEnvSync(ambientOnly, { ambientKeys: ambient });
  assert.equal(ambientOnly.BRAIN_REVISION_STORE, "postgres");
  assert.equal(ambientOnly.BRAIN_EXPECTED_SUPABASE_PROJECT_REF, JEM_REF);

  const explicit = { BRAIN_ID: "ai-brain-jem", BRAIN_REVISION_STORE: "file" };
  const ambient2 = loadLocalEnv(root, explicit);
  assert.throws(() => applyBrainMonitorProfileEnvSync(explicit, { ambientKeys: ambient2 }), /conflicts with explicit BRAIN_REVISION_STORE/);
});
