import fs from "node:fs/promises";
import path from "node:path";
import {
  MemoryRevisionStore,
  type MemoryRevisionStoreSnapshot,
} from "./memory-revision-store.js";
import type {
  ChangePage,
  ConflictInput,
  ConflictRecord,
  FileHead,
  RevisionContent,
  RevisionProposal,
  RevisionProposalResult,
  RevisionStore,
  SearchOptions,
  SearchResult,
} from "./types.js";

interface FileRevisionStoreData extends MemoryRevisionStoreSnapshot {
  version: 1;
}

export class FileRevisionStore implements RevisionStore {
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  getHead(brainId: string, filename: string): Promise<FileHead | null> {
    return this.withStore(false, (store) => store.getHead(brainId, filename));
  }

  readFile(brainId: string, filename: string): Promise<RevisionContent> {
    return this.withStore(false, (store) => store.readFile(brainId, filename));
  }

  listFiles(brainId: string): Promise<FileHead[]> {
    return this.withStore(false, (store) => store.listFiles(brainId));
  }

  searchFiles(
    brainId: string,
    query: string,
    options?: SearchOptions
  ): Promise<SearchResult[]> {
    return this.withStore(false, (store) =>
      store.searchFiles(brainId, query, options)
    );
  }

  proposeRevision(input: RevisionProposal): Promise<RevisionProposalResult> {
    return this.withStore(true, (store) => store.proposeRevision(input));
  }

  listChanges(brainId: string, sinceCursor?: string): Promise<ChangePage> {
    return this.withStore(false, (store) => store.listChanges(brainId, sinceCursor));
  }

  recordConflict(input: ConflictInput): Promise<ConflictRecord> {
    return this.withStore(true, (store) => store.recordConflict(input));
  }

  listConflicts(
    brainId: string,
    status?: "open" | "resolved" | "superseded"
  ): Promise<ConflictRecord[]> {
    return this.withStore(false, (store) => store.listConflicts(brainId, status));
  }

  private async withStore<T>(
    write: boolean,
    fn: (store: MemoryRevisionStore) => Promise<T>
  ): Promise<T> {
    const run = this.queue.then(async () => {
      const store = await this.load();
      const result = await fn(store);
      if (write) await this.save(store);
      return result;
    });
    this.queue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  private async load(): Promise<MemoryRevisionStore> {
    try {
      const raw = await fs.readFile(this.filePath, "utf-8");
      const data = JSON.parse(raw) as FileRevisionStoreData;
      if (data.version !== 1) {
        throw new Error(`Unsupported revision store version: ${data.version}`);
      }
      return new MemoryRevisionStore(data);
    } catch (error: any) {
      if (error?.code === "ENOENT") return new MemoryRevisionStore();
      throw error;
    }
  }

  private async save(store: MemoryRevisionStore): Promise<void> {
    const data: FileRevisionStoreData = {
      version: 1,
      ...store.snapshot(),
    };
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    await fs.writeFile(tmpPath, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
    await fs.rename(tmpPath, this.filePath);
  }
}
