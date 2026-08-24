import pg from "pg";
import { LOADER_FILE, LOG_FILE, NOW_FILE } from "../constants.js";
import { buildContextNudges } from "./context-nudges.js";
import { getOpenMaintenanceIssues, type OpenIssue } from "./issues.js";
import { scanInbox } from "./inbox.js";
import { parseLastOpDate } from "./log.js";
import { summarizeCaptureQueue, TASKS_FILE } from "./task-intake.js";
import { filesystemBrainStore, type BrainStore, type FileMetadata } from "./brain-store.js";
import { RevisionBrainStore } from "./revision-brain-store.js";
import { revisionBrainStoreFromFile } from "./revision-brain-store.js";
import { PostgresRevisionStore, postgresPoolOptions } from "../sync/postgres-revision-store.js";
import { PostgresSourceMetadataStore } from "../sources/postgres-source-store.js";
import { instrumentPostgresPool } from "./operation-telemetry.js";
import { attachPoolErrorLogger } from "./pg-pool.js";
import { runtimeBrainId } from "./runtime-env.js";

const { Pool } = pg;

export function revisionStoreFile(): string | undefined {
  return process.env.BRAIN_EXPERIMENTAL_REVISION_STORE_FILE;
}

export function revisionStoreProvider(): "filesystem" | "file" | "postgres" {
  if (process.env.BRAIN_REVISION_STORE === "postgres") return "postgres";
  if (revisionStoreFile()) return "file";
  return "filesystem";
}

export function revisionStoreModeEnabled(): boolean {
  return revisionStoreProvider() !== "filesystem";
}

let cachedStore:
  | {
      key: string;
      store: BrainStore;
    }
  | undefined;

function activeBrainStoreCacheKey(): string {
  const provider = revisionStoreProvider();
  if (provider === "postgres") {
    return `postgres:${process.env.BRAIN_REVISION_DATABASE_URL || ""}`;
  }
  if (provider === "file") {
    return `file:${revisionStoreFile() || ""}`;
  }
  return "filesystem";
}

export function activeBrainStore(): BrainStore {
  const key = activeBrainStoreCacheKey();
  if (cachedStore?.key === key) return cachedStore.store;

  let store: BrainStore;
  if (revisionStoreProvider() === "postgres") {
    const databaseUrl = process.env.BRAIN_REVISION_DATABASE_URL;
    if (!databaseUrl) {
      throw new Error(
        "BRAIN_REVISION_DATABASE_URL is required when BRAIN_REVISION_STORE=postgres"
      );
    }
    const pool = instrumentPostgresPool(
      attachPoolErrorLogger(new Pool(postgresPoolOptions(databaseUrl)), "brain_runtime"),
      "brain_runtime"
    );
    store = new RevisionBrainStore(
      new PostgresRevisionStore(pool),
      new PostgresSourceMetadataStore(pool)
    );
  } else {
    const filePath = revisionStoreFile();
    store = filePath ? revisionBrainStoreFromFile(filePath) : filesystemBrainStore;
  }

  cachedStore = { key, store };
  return store;
}

export async function warmActiveBrainStore(
  brainId = runtimeBrainId()
): Promise<void> {
  if (revisionStoreProvider() !== "postgres") return;
  const store = activeBrainStore();
  await Promise.all([
    store.listFiles(brainId),
    store.listSources(brainId),
    store.syncStatus(brainId),
  ]);
}

export async function loadContextFromActiveStore(brainId: string): Promise<string> {
  const store = activeBrainStore();

  // Core files plus the nudge inputs, in one round trip. Every nudge source is
  // independently fault-tolerant: a Brain whose backend cannot answer one of
  // these still gets its loader and NOW.md.
  const [loader, now, logContent, tasksContent, issues, inboxCount] =
    await Promise.all([
      store.readFile(brainId, LOADER_FILE).catch(() => null),
      store.readFile(brainId, NOW_FILE).catch(() => null),
      store.readFile(brainId, LOG_FILE).catch(() => null),
      store.readFile(brainId, TASKS_FILE).catch(() => null),
      getOpenMaintenanceIssues().catch((): OpenIssue[] => []),
      // null distinguishes "no host inbox on this backend" (the S1-guard throws
      // for Postgres-backed Brains) from "inbox exists and is empty". Only a
      // real count can produce a nudge.
      scanInbox(brainId)
        .then((files) => files.length)
        .catch((): null => null),
    ]);

  if (!loader || !now) {
    const missing = [];
    if (!loader) missing.push(LOADER_FILE);
    if (!now) missing.push(NOW_FILE);
    throw new Error(`Missing required Brain files: ${missing.join(", ")}`);
  }

  const parts = [
    `--- FILE: ${LOADER_FILE} ---`,
    loader.trim(),
    "",
    `--- FILE: ${NOW_FILE} ---`,
    now.trim(),
  ];

  parts.push(
    ...buildContextNudges({
      lastLint: logContent ? parseLastOpDate(logContent, "LINT") : null,
      lintKnown: logContent !== null,
      issues,
      inboxCount,
      captureQueue: summarizeCaptureQueue(tasksContent ?? undefined),
    })
  );

  return parts.join("\n");
}

export function asFileMetadata(files: FileMetadata[] | string[]): FileMetadata[] {
  return files.filter((file): file is FileMetadata => typeof file !== "string");
}

export function activeStoreStatus(): string {
  if (revisionStoreProvider() === "postgres") return "Revision store: Postgres";
  const filePath = revisionStoreFile();
  if (!filePath) return "";
  return `Revision store harness: ${filePath}`;
}
