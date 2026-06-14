import path from "node:path";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import { BRAIN_DIR } from "../constants.js";
import { FileRevisionStore } from "./file-revision-store.js";
import { LocalSyncAgent } from "./local-sync-agent.js";
import { PostgresRevisionStore } from "./postgres-revision-store.js";
import type { LocalSyncReport, RevisionStore } from "./types.js";

type SyncCommand = "push" | "pull" | "once" | "status" | "summary" | "watch";
type RevisionStoreProvider = "file" | "postgres";

interface SyncCliConfig {
  brainId: string;
  brainDir: string;
  stateFile: string;
  lockFile: string;
  storeFile: string;
  revisionStore: RevisionStoreProvider;
  databaseUrl?: string;
  includeFiles?: string[];
  watchIntervalMs: number;
  watchCycles?: number;
  watchOutput: "summary" | "full";
}

interface StoreHandle {
  store: RevisionStore;
  close(): Promise<void>;
}

function parseEnvLine(line: string): [string, string] | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const equals = trimmed.indexOf("=");
  if (equals === -1) return null;
  const key = trimmed.slice(0, equals).trim();
  let value = trimmed.slice(equals + 1).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return null;
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return [key, value];
}

function loadLocalEnv(rootDir = process.cwd()): void {
  for (const filename of [".env.local", ".env"]) {
    const envPath = path.join(rootDir, filename);
    if (!fsSync.existsSync(envPath)) continue;
    const raw = fsSync.readFileSync(envPath, "utf-8");
    for (const line of raw.split(/\r?\n/)) {
      const parsed = parseEnvLine(line);
      if (!parsed) continue;
      const [key, value] = parsed;
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}

function usage(): string {
  return [
    "Usage: node dist/sync/cli.js <push|pull|once|status|summary|watch>",
    "",
    "Environment:",
    "  BRAIN_ID                  Brain id (default: ai-brain-jem)",
    "  BRAIN_DIR                 Local Markdown Brain directory",
    "  BRAIN_SYNC_STATE_FILE     Local sync metadata JSON path",
    "  BRAIN_SYNC_LOCK_FILE      Local sync lock path",
    "  BRAIN_SYNC_STORE_FILE     File-backed hosted revision store path",
    "  BRAIN_SYNC_INCLUDE_FILES  Optional comma-separated .md file list",
    "  BRAIN_SYNC_INTERVAL_MS    Watch interval in milliseconds (default: 5000)",
    "  BRAIN_SYNC_WATCH_CYCLES   Optional finite watch cycles for tests/jobs",
    "  BRAIN_SYNC_WATCH_OUTPUT   Watch output mode: summary|full (default: summary)",
    "  BRAIN_REVISION_STORE      Revision store provider: file|postgres",
    "  BRAIN_REVISION_DATABASE_URL",
    "                            Required when BRAIN_REVISION_STORE=postgres",
  ].join("\n");
}

function defaultStateFile(brainDir: string): string {
  return path.resolve(brainDir, "..", ".brain-sync", "state.json");
}

function defaultStoreFile(brainDir: string): string {
  return path.resolve(brainDir, "..", ".brain-sync", "hosted-revisions.json");
}

function defaultLockFile(stateFile: string): string {
  return `${stateFile}.lock`;
}

function readConfig(): SyncCliConfig {
  const revisionStore =
    process.env.BRAIN_REVISION_STORE === "postgres" ? "postgres" : "file";
  const includeFiles = process.env.BRAIN_SYNC_INCLUDE_FILES
    ?.split(",")
    .map((file) => file.trim())
    .filter(Boolean);
  return {
    brainId: process.env.BRAIN_ID || "ai-brain-jem",
    brainDir: process.env.BRAIN_DIR || BRAIN_DIR,
    stateFile:
      process.env.BRAIN_SYNC_STATE_FILE ||
      defaultStateFile(process.env.BRAIN_DIR || BRAIN_DIR),
    lockFile:
      process.env.BRAIN_SYNC_LOCK_FILE ||
      defaultLockFile(
        process.env.BRAIN_SYNC_STATE_FILE ||
          defaultStateFile(process.env.BRAIN_DIR || BRAIN_DIR)
      ),
    storeFile:
      process.env.BRAIN_SYNC_STORE_FILE ||
      defaultStoreFile(process.env.BRAIN_DIR || BRAIN_DIR),
    revisionStore,
    databaseUrl: process.env.BRAIN_REVISION_DATABASE_URL,
    includeFiles: includeFiles && includeFiles.length > 0 ? includeFiles : undefined,
    watchIntervalMs: Math.max(
      250,
      Number(process.env.BRAIN_SYNC_INTERVAL_MS || 5000)
    ),
    watchCycles: process.env.BRAIN_SYNC_WATCH_CYCLES
      ? Math.max(1, Number(process.env.BRAIN_SYNC_WATCH_CYCLES))
      : undefined,
    watchOutput:
      process.env.BRAIN_SYNC_WATCH_OUTPUT === "full" ? "full" : "summary",
  };
}

function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function writeJsonLine(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function outputConfig(config: SyncCliConfig): Omit<SyncCliConfig, "databaseUrl"> & {
  databaseUrl: "set" | "missing";
} {
  return {
    ...config,
    databaseUrl: config.databaseUrl ? "set" : "missing",
  };
}

function summarizeReport(report: LocalSyncReport) {
  const totalTiming = report.timings.find(
    (timing) => timing.operation === "sync" && timing.phase === "total"
  );
  return {
    pushed: report.pushed.length,
    pulled: report.pulled.length,
    unchanged: report.unchanged.length,
    conflicts: report.conflicts.length,
    conflictFiles: report.conflicts.map((conflict) => conflict.filename),
    totalMs: totalTiming?.ms ?? null,
  };
}

function createStore(config: SyncCliConfig): StoreHandle {
  if (config.revisionStore === "postgres") {
    if (!config.databaseUrl) {
      throw new Error(
        "BRAIN_REVISION_DATABASE_URL is required when BRAIN_REVISION_STORE=postgres"
      );
    }
    const store = new PostgresRevisionStore(config.databaseUrl);
    return {
      store,
      close: () => store.close(),
    };
  }

  return {
    store: new FileRevisionStore(config.storeFile),
    close: async () => undefined,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withLock<T>(
  lockFile: string,
  fn: () => Promise<T>
): Promise<T> {
  await fs.mkdir(path.dirname(lockFile), { recursive: true });
  try {
    const handle = await fs.open(lockFile, "wx");
    await handle.writeFile(
      JSON.stringify(
        {
          pid: process.pid,
          startedAt: new Date().toISOString(),
        },
        null,
        2
      ) + "\n",
      "utf-8"
    );
    await handle.close();
  } catch (error: any) {
    if (error?.code === "EEXIST") {
      throw new Error(
        `Brain sync is already running or a stale lock exists: ${lockFile}`
      );
    }
    throw error;
  }

  try {
    return await fn();
  } finally {
    await fs.rm(lockFile, { force: true }).catch(() => undefined);
  }
}

async function run(command: SyncCommand): Promise<void> {
  const config = readConfig();
  await withLock(config.lockFile, () => runWithConfig(command, config));
}

async function runWithConfig(
  command: SyncCommand,
  config: SyncCliConfig
): Promise<void> {
  const storeHandle = createStore(config);
  const store = storeHandle.store;
  const agent = new LocalSyncAgent({
    brainId: config.brainId,
    brainDir: config.brainDir,
    stateFile: config.stateFile,
    store,
    includeFiles: config.includeFiles,
    actor: {
      provider: "local_sync_cli",
      id: process.env.USER || "local",
      name: process.env.USER || "local",
    },
  });

  try {
    if (command === "push") {
      writeJson({
        command,
        config: outputConfig(config),
        report: await agent.pushLocalChanges(),
      });
      return;
    }

    if (command === "pull") {
      writeJson({
        command,
        config: outputConfig(config),
        report: await agent.pullHostedChanges(),
      });
      return;
    }

    if (command === "once") {
      writeJson({
        command,
        config: outputConfig(config),
        report: await agent.syncOnce(),
      });
      return;
    }

    if (command === "watch") {
      let stopped = false;
      const stop = () => {
        stopped = true;
      };
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
      try {
        let cycle = 0;
        while (!stopped) {
          cycle += 1;
          const report = await agent.syncOnce();
          writeJsonLine({
            command,
            cycle,
            config: outputConfig(config),
            report:
              config.watchOutput === "full" ? report : summarizeReport(report),
          });
          if (config.watchCycles && cycle >= config.watchCycles) break;
          await sleep(config.watchIntervalMs);
        }
      } finally {
        process.off("SIGINT", stop);
        process.off("SIGTERM", stop);
      }
      return;
    }

    const [state, hostedFiles, openConflicts] = await Promise.all([
      agent.loadState(),
      store.listFiles(config.brainId),
      store.listConflicts(config.brainId, "open"),
    ]);
    if (command === "summary") {
      writeJson({
        command,
        config: outputConfig(config),
        state: {
          version: state.version,
          clientId: state.clientId,
          cursor: state.cursor,
          trackedFiles: Object.keys(state.files).length,
        },
        hostedFiles: hostedFiles.length,
        openConflicts: openConflicts.length,
        latestHostedCursor:
          hostedFiles
            .map((file) => file.cursor)
            .filter(Boolean)
            .sort()
            .at(-1) || null,
      });
      return;
    }
    writeJson({
      command,
      config: outputConfig(config),
      state,
      hostedFiles,
      openConflicts,
    });
  } finally {
    await storeHandle.close();
  }
}

async function main(): Promise<void> {
  loadLocalEnv();
  const command = process.argv[2] as SyncCommand | undefined;
  if (
    !command ||
    !["push", "pull", "once", "status", "summary", "watch"].includes(command)
  ) {
    process.stderr.write(`${usage()}\n`);
    process.exitCode = 2;
    return;
  }

  await run(command);
}

main().catch((error) => {
  process.stderr.write(`[brain-sync] Fatal error: ${error?.message || error}\n`);
  process.exit(1);
});
