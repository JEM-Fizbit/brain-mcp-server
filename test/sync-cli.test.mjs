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
const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "brain-sync-cli-test-"));
const cliPath = path.join(__dirname, "..", "dist", "sync", "cli.js");

const { FileRevisionStore } = await import(
  path.join(__dirname, "..", "dist", "sync", "index.js")
);

after(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

function dirs(name) {
  const root = path.join(tmpRoot, name);
  return {
    brainDir: path.join(root, "brain"),
    stateFile: path.join(root, ".brain-sync", "state.json"),
    lockFile: path.join(root, ".brain-sync", "state.json.lock"),
    healthFile: path.join(root, ".brain-sync", "state.json.health.json"),
    storeFile: path.join(root, "hosted", "revision-store.json"),
  };
}

async function writeBrainFile(brainDir, filename, content) {
  const fullPath = path.join(brainDir, filename);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, "utf-8");
}

async function readBrainFile(brainDir, filename) {
  return fs.readFile(path.join(brainDir, filename), "utf-8");
}

async function runCli(command, config, args = []) {
  const { stdout } = await exec(process.execPath, [cliPath, command, ...args], {
    env: {
      ...process.env,
      BRAIN_ID: "ai-brain-jem",
      BRAIN_DIR: config.brainDir,
      BRAIN_SYNC_STATE_FILE: config.stateFile,
      BRAIN_SYNC_LOCK_FILE: config.lockFile,
      BRAIN_SYNC_HEALTH_FILE: config.healthFile,
      BRAIN_SYNC_STORE_FILE: config.storeFile,
      BRAIN_REVISION_STORE: "file",
      BRAIN_REVISION_DATABASE_URL: "",
    },
  });
  return JSON.parse(stdout);
}

async function runCliWithEnv(command, config, env) {
  const { stdout } = await exec(process.execPath, [cliPath, command], {
    env: {
      ...process.env,
      BRAIN_ID: "ai-brain-jem",
      BRAIN_DIR: config.brainDir,
      BRAIN_SYNC_STATE_FILE: config.stateFile,
      BRAIN_SYNC_LOCK_FILE: config.lockFile,
      BRAIN_SYNC_HEALTH_FILE: config.healthFile,
      BRAIN_SYNC_STORE_FILE: config.storeFile,
      BRAIN_REVISION_STORE: "file",
      BRAIN_REVISION_DATABASE_URL: "",
      ...env,
    },
  });
  return JSON.parse(stdout);
}

function envWithoutSyncConfig() {
  const env = { ...process.env };
  for (const key of [
    "BRAIN_ID",
    "BRAIN_DIR",
    "BRAIN_SYNC_STATE_FILE",
    "BRAIN_SYNC_LOCK_FILE",
    "BRAIN_SYNC_HEALTH_FILE",
    "BRAIN_SYNC_STORE_FILE",
    "BRAIN_REVISION_STORE",
    "BRAIN_REVISION_DATABASE_URL",
    "BRAIN_EXPECTED_SUPABASE_PROJECT_REF",
    "BRAIN_SYNC_LOCAL_EDIT_SURFACE",
    "BRAIN_SYNC_LOAD_LOCAL_ENV",
  ]) {
    delete env[key];
  }
  return env;
}

async function accept(result) {
  assert.equal(result.ok, true);
  return result.head;
}

test("sync CLI push writes local Markdown to file-backed revision store", async () => {
  const config = dirs("push");
  await writeBrainFile(config.brainDir, "NOW.md", "CLI local push\n");

  const output = await runCli("push", config);

  assert.equal(output.command, "push");
  assert.equal(output.config.databaseUrl, "missing");
  assert.deepEqual(output.report.pushed, ["NOW.md"]);
  assert.equal(output.report.conflicts.length, 0);
  assert.ok(output.report.timings.some((timing) => timing.phase === "total"));

  const store = new FileRevisionStore(config.storeFile);
  const hosted = await store.readFile("ai-brain-jem", "NOW.md");
  assert.equal(hosted.content, "CLI local push\n");
  assert.equal(hosted.actor.provider, "local_sync_cli");
});

test("sync CLI records SharePoint manual edits without falsely naming the sync operator", async () => {
  const config = dirs("sharepoint-actor");
  await writeBrainFile(config.brainDir, "NOW.md", "Manual SharePoint edit\n");

  const output = await runCliWithEnv("push", config, {
    BRAIN_SYNC_LOCAL_EDIT_SURFACE: "sharepoint",
    USER: "sync-operator-who-is-not-the-editor",
  });

  assert.equal(output.config.localEditSurface, "sharepoint");
  const store = new FileRevisionStore(config.storeFile);
  const hosted = await store.readFile("ai-brain-jem", "NOW.md");
  assert.deepEqual(hosted.actor, {
    provider: "sharepoint_file_plane",
    id: "editor-unresolved",
    name: "SharePoint/OneDrive manual edit (editor in version history)",
  });
  assert.doesNotMatch(JSON.stringify(hosted.actor), /sync-operator/);
});

test("sync CLI rejects an unknown local edit surface", async () => {
  const config = dirs("invalid-edit-surface");

  await assert.rejects(
    exec(process.execPath, [cliPath, "status"], {
      env: {
        ...process.env,
        BRAIN_SYNC_LOAD_LOCAL_ENV: "0",
        BRAIN_ID: "ai-brain-jem",
        BRAIN_DIR: config.brainDir,
        BRAIN_SYNC_STATE_FILE: config.stateFile,
        BRAIN_SYNC_LOCK_FILE: config.lockFile,
        BRAIN_SYNC_HEALTH_FILE: config.healthFile,
        BRAIN_SYNC_STORE_FILE: config.storeFile,
        BRAIN_REVISION_STORE: "file",
        BRAIN_SYNC_LOCAL_EDIT_SURFACE: "somewhere-else",
      },
    }),
    /BRAIN_SYNC_LOCAL_EDIT_SURFACE must be local_filesystem or sharepoint/
  );
});

test("sync CLI pull writes hosted revision into clean local Markdown tree", async () => {
  const config = dirs("pull");
  const store = new FileRevisionStore(config.storeFile);
  await accept(
    await store.proposeRevision({
      brainId: "ai-brain-jem",
      filename: "NOW.md",
      baseRevisionId: null,
      content: "CLI hosted pull\n",
      origin: "hosted_mcp",
    })
  );

  const output = await runCli("pull", config);

  assert.equal(output.command, "pull");
  assert.deepEqual(output.report.pulled, ["NOW.md"]);
  assert.equal(output.report.conflicts.length, 0);
  assert.equal(await readBrainFile(config.brainDir, "NOW.md"), "CLI hosted pull\n");
});

test("sync CLI status reports state, hosted files, and open conflicts", async () => {
  const config = dirs("status");
  await writeBrainFile(config.brainDir, "NOW.md", "CLI status base\n");
  await runCli("push", config);

  const store = new FileRevisionStore(config.storeFile);
  const stale = await store.proposeRevision({
    brainId: "ai-brain-jem",
    filename: "NOW.md",
    baseRevisionId: null,
    content: "stale conflict\n",
    origin: "local_agent",
  });
  assert.equal(stale.ok, false);

  const output = await runCli("status", config);

  assert.equal(output.command, "status");
  assert.equal(output.state.version, 1);
  assert.equal(output.hostedFiles.length, 1);
  assert.equal(output.hostedFiles[0].filename, "NOW.md");
  assert.equal(output.openConflicts.length, 1);
  assert.equal(output.openConflicts[0].filename, "NOW.md");
});

test("sync CLI summary reports compact counts without file payloads", async () => {
  const config = dirs("summary");
  await writeBrainFile(config.brainDir, "NOW.md", "CLI summary base\n");
  await runCli("push", config);

  const output = await runCli("summary", config);

  assert.equal(output.command, "summary");
  assert.equal(output.state.version, 1);
  assert.equal(output.state.trackedFiles, 1);
  assert.equal(output.hostedFiles, 1);
  assert.equal(output.openConflicts, 0);
  assert.equal(typeof output.latestHostedCursor, "string");
  assert.equal("files" in output.state, false);
});

test("sync CLI safely rebases stale local metadata after proving exact parity", async () => {
  const config = dirs("rebase-state");
  await writeBrainFile(config.brainDir, "NOW.md", "Exact parity\n");
  await runCli("push", config);

  const state = JSON.parse(await fs.readFile(config.stateFile, "utf-8"));
  state.files["sources/old.md"] = {
    revisionId: "stale",
    contentHash: "stale",
    localHash: "stale",
  };
  state.pendingDeletions = ["sources/old.md"];
  await fs.writeFile(config.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf-8");

  const dryRun = await runCli("rebase-state", config);
  assert.equal(dryRun.result.applied, false);
  assert.equal(dryRun.result.previousTrackedFiles, 2);
  assert.equal(dryRun.result.nextTrackedFiles, 1);
  assert.deepEqual(dryRun.result.forgottenFiles, ["sources/old.md"]);
  assert.equal(
    Object.keys(JSON.parse(await fs.readFile(config.stateFile, "utf-8")).files)
      .length,
    2
  );

  const applied = await runCli("rebase-state", config, ["--apply"]);
  assert.equal(applied.result.applied, true);
  assert.equal(applied.result.pendingDeletionsCleared, 1);
  assert.ok(applied.result.backupFile);
  const rebased = JSON.parse(await fs.readFile(config.stateFile, "utf-8"));
  assert.deepEqual(Object.keys(rebased.files), ["NOW.md"]);
  assert.deepEqual(rebased.pendingDeletions, []);
  assert.equal(
    JSON.parse(await fs.readFile(applied.result.backupFile, "utf-8")).files[
      "sources/old.md"
    ].revisionId,
    "stale"
  );
});

test("sync CLI loads local env files before reading config", async () => {
  const config = dirs("local-env");
  const cwd = path.dirname(config.brainDir);
  await fs.mkdir(cwd, { recursive: true });
  await fs.writeFile(
    path.join(cwd, ".env.local"),
    [
      "BRAIN_ID=ai-brain-jem",
      `BRAIN_DIR=${config.brainDir}`,
      `BRAIN_SYNC_STATE_FILE=${config.stateFile}`,
      `BRAIN_SYNC_LOCK_FILE=${config.lockFile}`,
      `BRAIN_SYNC_HEALTH_FILE=${config.healthFile}`,
      `BRAIN_SYNC_STORE_FILE=${config.storeFile}`,
      "BRAIN_REVISION_STORE=file",
      "",
    ].join("\n"),
    "utf-8"
  );

  const { stdout } = await exec(process.execPath, [cliPath, "status"], {
    cwd,
    env: envWithoutSyncConfig(),
  });
  const output = JSON.parse(stdout);

  assert.equal(output.command, "status");
  assert.equal(output.config.brainDir, config.brainDir);
  assert.equal(output.config.lockFile, config.lockFile);
  assert.equal(output.config.healthFile, config.healthFile);
  assert.equal(output.config.revisionStore, "file");
});

test("sync CLI can disable ambient local env loading for an explicit supervisor profile", async () => {
  const config = dirs("local-env-disabled");
  const cwd = path.dirname(config.brainDir);
  await fs.mkdir(cwd, { recursive: true });
  await fs.writeFile(
    path.join(cwd, ".env.local"),
    [
      "BRAIN_REVISION_STORE=postgres",
      "BRAIN_REVISION_DATABASE_URL=postgresql://wrong.wrongprojectref12@example.invalid/postgres",
      "",
    ].join("\n"),
    "utf-8"
  );

  const { stdout } = await exec(process.execPath, [cliPath, "status"], {
    cwd,
    env: {
      ...envWithoutSyncConfig(),
      BRAIN_SYNC_LOAD_LOCAL_ENV: "0",
      BRAIN_ID: "ai-brain-jem",
      BRAIN_DIR: config.brainDir,
      BRAIN_SYNC_STATE_FILE: config.stateFile,
      BRAIN_SYNC_LOCK_FILE: config.lockFile,
      BRAIN_SYNC_HEALTH_FILE: config.healthFile,
      BRAIN_SYNC_STORE_FILE: config.storeFile,
    },
  });
  const output = JSON.parse(stdout);

  assert.equal(output.config.revisionStore, "file");
  assert.equal(output.config.databaseUrl, "missing");
});

test("sync CLI reports missing Postgres database URL when provider is postgres", async () => {
  const config = dirs("postgres-missing-url");

  await assert.rejects(
    exec(process.execPath, [cliPath, "status"], {
      env: {
        ...process.env,
        BRAIN_ID: "ai-brain-jem",
        BRAIN_DIR: config.brainDir,
        BRAIN_SYNC_STATE_FILE: config.stateFile,
        BRAIN_SYNC_LOCK_FILE: config.lockFile,
        BRAIN_SYNC_HEALTH_FILE: config.healthFile,
        BRAIN_SYNC_STORE_FILE: config.storeFile,
        BRAIN_REVISION_STORE: "postgres",
        BRAIN_REVISION_DATABASE_URL: "",
      },
    }),
    /BRAIN_REVISION_DATABASE_URL is required/
  );
});

test("sync CLI rejects a Postgres URL for the wrong Supabase project before connecting", async () => {
  const config = dirs("postgres-wrong-project");

  await assert.rejects(
    exec(process.execPath, [cliPath, "status"], {
      env: {
        ...process.env,
        BRAIN_SYNC_LOAD_LOCAL_ENV: "0",
        BRAIN_ID: "ai-brain-jem",
        BRAIN_DIR: config.brainDir,
        BRAIN_SYNC_STATE_FILE: config.stateFile,
        BRAIN_SYNC_LOCK_FILE: config.lockFile,
        BRAIN_SYNC_HEALTH_FILE: config.healthFile,
        BRAIN_REVISION_STORE: "postgres",
        BRAIN_REVISION_DATABASE_URL:
          "postgresql://runtime.wrongprojectref12@example.invalid/postgres",
        BRAIN_EXPECTED_SUPABASE_PROJECT_REF: "rightprojectref12",
      },
    }),
    /does not match BRAIN_EXPECTED_SUPABASE_PROJECT_REF/
  );
});

test("sync CLI can restrict push to explicit include files", async () => {
  const config = dirs("include-files");
  await writeBrainFile(config.brainDir, "NOW.md", "CLI included\n");
  await writeBrainFile(config.brainDir, "TASKS.md", "CLI excluded\n");

  const output = await runCliWithEnv("push", config, {
    BRAIN_SYNC_INCLUDE_FILES: "NOW.md",
  });

  assert.deepEqual(output.config.includeFiles, ["NOW.md"]);
  assert.deepEqual(output.report.pushed, ["NOW.md"]);

  const store = new FileRevisionStore(config.storeFile);
  await assert.rejects(
    store.readFile("ai-brain-jem", "TASKS.md"),
    /File not found/
  );
});

test("sync CLI watch runs finite sync cycles for automation harnesses", async () => {
  const config = dirs("watch");
  await writeBrainFile(config.brainDir, "NOW.md", "Watch local push\n");

  const { stdout } = await exec(process.execPath, [cliPath, "watch"], {
    env: {
      ...process.env,
      BRAIN_ID: "ai-brain-jem",
      BRAIN_DIR: config.brainDir,
      BRAIN_SYNC_STATE_FILE: config.stateFile,
      BRAIN_SYNC_LOCK_FILE: config.lockFile,
      BRAIN_SYNC_HEALTH_FILE: config.healthFile,
      BRAIN_SYNC_STORE_FILE: config.storeFile,
      BRAIN_REVISION_STORE: "file",
      BRAIN_REVISION_DATABASE_URL: "",
      BRAIN_SYNC_INTERVAL_MS: "250",
      BRAIN_SYNC_WATCH_CYCLES: "2",
    },
  });
  const outputs = stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  assert.equal(outputs.length, 2);
  assert.equal(outputs[0].command, "watch");
  assert.equal(outputs[0].cycle, 1);
  assert.equal(outputs[0].config.databaseUrl, "missing");
  assert.equal(outputs[0].config.watchOutput, "summary");
  assert.equal(outputs[0].report.pushed, 1);
  assert.equal(outputs[0].report.pulled, 0);
  assert.equal(outputs[0].report.conflicts, 0);
  assert.deepEqual(outputs[0].report.conflictFiles, []);
  assert.equal(typeof outputs[0].report.totalMs, "number");
  assert.equal(outputs[1].cycle, 2);
  assert.equal(outputs[1].report.conflicts, 0);

  const health = JSON.parse(await fs.readFile(config.healthFile, "utf-8"));
  assert.equal(health.version, 1);
  assert.equal(health.brainId, "ai-brain-jem");
  assert.equal(health.brainDir, config.brainDir);
  assert.equal(health.stateFile, config.stateFile);
  assert.equal(health.command, "watch");
  assert.equal(health.status, "ok");
  assert.equal(health.cycle, 2);
  assert.equal(health.report.pushed, 0);
  assert.equal(health.report.pulled, 0);
  assert.equal(health.report.conflicts, 0);
  assert.deepEqual(health.report.conflictFiles, []);
  assert.equal(typeof health.report.totalMs, "number");
  assert.equal(typeof health.checkedAt, "string");
  assert.equal("files" in health, false);
});

test("sync CLI watch can emit full reports for debugging", async () => {
  const config = dirs("watch-full");
  await writeBrainFile(config.brainDir, "NOW.md", "Watch full local push\n");

  const { stdout } = await exec(process.execPath, [cliPath, "watch"], {
    env: {
      ...process.env,
      BRAIN_ID: "ai-brain-jem",
      BRAIN_DIR: config.brainDir,
      BRAIN_SYNC_STATE_FILE: config.stateFile,
      BRAIN_SYNC_LOCK_FILE: config.lockFile,
      BRAIN_SYNC_HEALTH_FILE: config.healthFile,
      BRAIN_SYNC_STORE_FILE: config.storeFile,
      BRAIN_REVISION_STORE: "file",
      BRAIN_REVISION_DATABASE_URL: "",
      BRAIN_SYNC_INTERVAL_MS: "250",
      BRAIN_SYNC_WATCH_CYCLES: "1",
      BRAIN_SYNC_WATCH_OUTPUT: "full",
    },
  });
  const output = JSON.parse(stdout.trim());

  assert.equal(output.command, "watch");
  assert.equal(output.config.watchOutput, "full");
  assert.deepEqual(output.report.pushed, ["NOW.md"]);
  assert.equal(output.report.conflicts.length, 0);
  assert.ok(output.report.timings.some((timing) => timing.phase === "total"));
});

test("sync CLI fails fast when another active sync lock exists", async () => {
  const config = dirs("lock-exists");
  await writeBrainFile(config.brainDir, "NOW.md", "Locked run\n");
  await fs.mkdir(path.dirname(config.lockFile), { recursive: true });
  const activeLock = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
  };
  await fs.writeFile(
    config.lockFile,
    `${JSON.stringify(activeLock, null, 2)}\n`,
    "utf-8"
  );

  await assert.rejects(
    exec(process.execPath, [cliPath, "push"], {
      env: {
        ...process.env,
        BRAIN_ID: "ai-brain-jem",
        BRAIN_DIR: config.brainDir,
        BRAIN_SYNC_STATE_FILE: config.stateFile,
        BRAIN_SYNC_LOCK_FILE: config.lockFile,
        BRAIN_SYNC_HEALTH_FILE: config.healthFile,
        BRAIN_SYNC_STORE_FILE: config.storeFile,
        BRAIN_REVISION_STORE: "file",
        BRAIN_REVISION_DATABASE_URL: "",
      },
    }),
    /Brain sync is already running/
  );
  assert.deepEqual(
    JSON.parse(await fs.readFile(config.lockFile, "utf-8")),
    activeLock
  );
});

test("sync CLI replaces stale sync locks before running", async () => {
  const config = dirs("stale-lock");
  await writeBrainFile(config.brainDir, "NOW.md", "Recovered lock run\n");
  await fs.mkdir(path.dirname(config.lockFile), { recursive: true });
  await fs.writeFile(config.lockFile, "existing lock\n", "utf-8");

  const output = await runCli("push", config);

  assert.equal(output.command, "push");
  assert.deepEqual(output.report.pushed, ["NOW.md"]);
  await assert.rejects(fs.readFile(config.lockFile, "utf-8"), /ENOENT/);
});
