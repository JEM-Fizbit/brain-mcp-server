import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  applyBrainMonitorProfileEnv,
  assertHostedRuntimeBinding,
  projectRefFromDatabaseUrl,
} from "../scripts/lib/hosted-runtime-binding.mjs";

const JEM_REF = "gfipcidoyrtgngauzijy";
const ERS_REF = "omnwbcdtmtvxasgdmvwr";

function boundEnv(overrides = {}) {
  return {
    BRAIN_ID: "ai-brain-jem",
    BRAIN_HOSTED_BASE_URL: "https://jem-brain-mcp.fly.dev",
    BRAIN_REVISION_DATABASE_URL:
      `postgresql://brain_jem_sync_user.${JEM_REF}:secret@pooler.example:6543/postgres`,
    BRAIN_EXPECTED_SUPABASE_PROJECT_REF: JEM_REF,
    ...overrides,
  };
}

test("hosted runtime binding recognizes direct and pooler Supabase project refs", () => {
  assert.equal(
    projectRefFromDatabaseUrl(
      `postgresql://postgres:secret@db.${JEM_REF}.supabase.co:5432/postgres`
    ),
    JEM_REF
  );
  assert.equal(
    projectRefFromDatabaseUrl(
      `postgresql://brain_runtime.${JEM_REF}:secret@pooler.example:6543/postgres`
    ),
    JEM_REF
  );
});

test("hosted runtime binding accepts an explicit matching tuple", () => {
  assert.deepEqual(assertHostedRuntimeBinding(boundEnv(), "Test command"), {
    brainId: "ai-brain-jem",
    hostedBaseUrl: "https://jem-brain-mcp.fly.dev",
    expectedProjectRef: JEM_REF,
    actualProjectRef: JEM_REF,
    databaseBound: true,
  });
});

test("hosted runtime binding fails closed on missing or mismatched project identity", () => {
  assert.throws(
    () =>
      assertHostedRuntimeBinding(
        boundEnv({ BRAIN_EXPECTED_SUPABASE_PROJECT_REF: "" }),
        "Test command"
      ),
    /refuses an unbound database URL/
  );
  assert.throws(
    () =>
      assertHostedRuntimeBinding(
        boundEnv({
          BRAIN_REVISION_DATABASE_URL:
            `postgresql://brain_ers_sync_user.${ERS_REF}:secret@pooler.example:6543/postgres`,
        }),
        "Test command"
      ),
    /refuses cross-project access/
  );
  assert.throws(
    () =>
      assertHostedRuntimeBinding(
        boundEnv({ BRAIN_HOSTED_BASE_URL: "http://127.0.0.1:3000" }),
        "Test command"
      ),
    /requires an HTTPS/
  );
});

test("hosted runtime binding permits a database-free read-only profile", () => {
  assert.deepEqual(
    assertHostedRuntimeBinding(
      {
        BRAIN_ID: "ai-brain-jem",
        BRAIN_HOSTED_BASE_URL: "https://jem-brain-mcp.fly.dev",
      },
      "Test command"
    ),
    {
      brainId: "ai-brain-jem",
      hostedBaseUrl: "https://jem-brain-mcp.fly.dev",
      expectedProjectRef: null,
      actualProjectRef: null,
      databaseBound: false,
    }
  );
});

test("owner-only Brain Monitor profile overrides an ambient cross-project database", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hosted-runtime-binding-"));
  const configFile = path.join(root, "brain-menubar-config.json");
  await fs.writeFile(
    configFile,
    JSON.stringify({
      brains: [
        {
          brainId: "ai-brain-jem",
          syncProcess: {
            env: boundEnv({ BRAIN_PROFILE_NAME: "JEM" }),
          },
        },
      ],
    })
  );
  await fs.chmod(configFile, 0o600);
  const env = {
    BRAIN_ID: "ai-brain-jem",
    BRAIN_MONITOR_CONFIG_FILE: configFile,
    BRAIN_HOSTED_BASE_URL: "https://brain.ersgenomics.online",
    BRAIN_REVISION_DATABASE_URL:
      `postgresql://brain_ers_sync_user.${ERS_REF}:secret@pooler.example:6543/postgres`,
  };

  const result = await applyBrainMonitorProfileEnv(env);
  assert.equal(result.source, "brain_monitor");
  assert.equal(env.BRAIN_EXPECTED_SUPABASE_PROJECT_REF, JEM_REF);
  assert.equal(assertHostedRuntimeBinding(env, "Test command").actualProjectRef, JEM_REF);
});

test("local environment example requires one explicit matching runtime tuple", async () => {
  const example = await fs.readFile(
    path.resolve(import.meta.dirname, "..", ".env.local.example"),
    "utf8"
  );
  assert.match(example, /^BRAIN_ID=\S+$/m);
  assert.match(example, /^BRAIN_REVISION_DATABASE_URL=\S+$/m);
  assert.match(example, /^BRAIN_EXPECTED_SUPABASE_PROJECT_REF=\S+$/m);
  assert.match(example, /^BRAIN_HOSTED_BASE_URL=https:\/\/\S+$/m);
  assert.match(example, /^BRAIN_FLY_APP=\S+$/m);
  assert.match(example, /BRAIN_MONITOR_CONFIG_FILE/);
  assert.doesNotMatch(example, /omnwbcdtmtvxasgdmvwr/);
});

test("Brain Monitor selection fails when the requested Brain is absent or inconsistent", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hosted-runtime-binding-"));
  const missingFile = path.join(root, "missing.json");
  await fs.writeFile(missingFile, JSON.stringify({ brains: [] }));
  await fs.chmod(missingFile, 0o600);
  await assert.rejects(
    () =>
      applyBrainMonitorProfileEnv({
        BRAIN_ID: "ai-brain-jem",
        BRAIN_MONITOR_CONFIG_FILE: missingFile,
      }),
    /profile not found/
  );

  const mismatchFile = path.join(root, "mismatch.json");
  await fs.writeFile(
    mismatchFile,
    JSON.stringify({
      brains: [
        {
          brainId: "ai-brain-jem",
          env: { ...boundEnv(), BRAIN_ID: "ers-brain" },
        },
      ],
    })
  );
  await fs.chmod(mismatchFile, 0o600);
  await assert.rejects(
    () =>
      applyBrainMonitorProfileEnv({
        BRAIN_ID: "ai-brain-jem",
        BRAIN_MONITOR_CONFIG_FILE: mismatchFile,
      }),
    /identity mismatch/
  );
});

test("Brain Monitor selection refuses a credential file readable by other users", async () => {
  if (process.platform === "win32") return;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hosted-runtime-binding-"));
  const configFile = path.join(root, "brain-menubar-config.json");
  await fs.writeFile(
    configFile,
    JSON.stringify({ brains: [{ brainId: "ai-brain-jem", env: boundEnv() }] }),
    { mode: 0o644 }
  );
  await assert.rejects(
    () =>
      applyBrainMonitorProfileEnv({
        BRAIN_ID: "ai-brain-jem",
        BRAIN_MONITOR_CONFIG_FILE: configFile,
      }),
    /must be owner-only/
  );
});
