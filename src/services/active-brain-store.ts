import { LOADER_FILE, NOW_FILE } from "../constants.js";
import { filesystemBrainStore, type BrainStore, type FileMetadata } from "./brain-store.js";
import { RevisionBrainStore } from "./revision-brain-store.js";
import { revisionBrainStoreFromFile } from "./revision-brain-store.js";
import { PostgresRevisionStore } from "../sync/postgres-revision-store.js";
import { PostgresSourceMetadataStore } from "../sources/postgres-source-store.js";

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
    store = new RevisionBrainStore(
      new PostgresRevisionStore(databaseUrl),
      new PostgresSourceMetadataStore(databaseUrl)
    );
  } else {
    const filePath = revisionStoreFile();
    store = filePath ? revisionBrainStoreFromFile(filePath) : filesystemBrainStore;
  }

  cachedStore = { key, store };
  return store;
}

export async function loadContextFromActiveStore(brainId: string): Promise<string> {
  const store = activeBrainStore();
  const [loader, now] = await Promise.all([
    store.readFile(brainId, LOADER_FILE).catch(() => null),
    store.readFile(brainId, NOW_FILE).catch(() => null),
  ]);

  if (!loader || !now) {
    const missing = [];
    if (!loader) missing.push(LOADER_FILE);
    if (!now) missing.push(NOW_FILE);
    throw new Error(`Missing required Brain files: ${missing.join(", ")}`);
  }

  return [
    `--- FILE: ${LOADER_FILE} ---`,
    loader.trim(),
    "",
    `--- FILE: ${NOW_FILE} ---`,
    now.trim(),
  ].join("\n");
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
