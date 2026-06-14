import path from "node:path";
import { BRAIN_DIR } from "../constants.js";
import { FileRevisionStore } from "./file-revision-store.js";
import { LocalSyncAgent } from "./local-sync-agent.js";
import { PostgresRevisionStore } from "./postgres-revision-store.js";
import type { RevisionStore } from "./types.js";

type SyncCommand = "push" | "pull" | "once" | "status" | "watch";
type RevisionStoreProvider = "file" | "postgres";

interface SyncCliConfig {
  brainId: string;
  brainDir: string;
  stateFile: string;
  storeFile: string;
  revisionStore: RevisionStoreProvider;
  databaseUrl?: string;
  includeFiles?: string[];
  watchIntervalMs: number;
  watchCycles?: number;
}

interface StoreHandle {
  store: RevisionStore;
  close(): Promise<void>;
}

function usage(): string {
  return [
    "Usage: node dist/sync/cli.js <push|pull|once|status|watch>",
    "",
    "Environment:",
    "  BRAIN_ID                  Brain id (default: ai-brain-jem)",
    "  BRAIN_DIR                 Local Markdown Brain directory",
    "  BRAIN_SYNC_STATE_FILE     Local sync metadata JSON path",
    "  BRAIN_SYNC_STORE_FILE     File-backed hosted revision store path",
    "  BRAIN_SYNC_INCLUDE_FILES  Optional comma-separated .md file list",
    "  BRAIN_SYNC_INTERVAL_MS    Watch interval in milliseconds (default: 5000)",
    "  BRAIN_SYNC_WATCH_CYCLES   Optional finite watch cycles for tests/jobs",
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

async function run(command: SyncCommand): Promise<void> {
  const config = readConfig();
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
          writeJsonLine({
            command,
            cycle,
            config: outputConfig(config),
            report: await agent.syncOnce(),
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
  const command = process.argv[2] as SyncCommand | undefined;
  if (!command || !["push", "pull", "once", "status", "watch"].includes(command)) {
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
