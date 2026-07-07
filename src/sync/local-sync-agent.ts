import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { contentHash } from "./hash.js";
import type {
  ConflictRecord,
  LocalSyncReport,
  LocalSyncState,
  RevisionActor,
  RevisionStore,
  SyncOperation,
  SyncTimingPhase,
} from "./types.js";

export interface LocalSyncAgentOptions {
  brainId: string;
  brainDir: string;
  stateFile: string;
  store: RevisionStore;
  actor?: RevisionActor;
  includeFiles?: string[];
}

const BRAIN_LOADER_FILENAME = "00_loader.md";
const NESTED_BRAIN_DIRNAME = "brain";

function emptyReport(): LocalSyncReport {
  return {
    pushed: [],
    pulled: [],
    unchanged: [],
    conflicts: [],
    timings: [],
  };
}

function addTiming(
  report: LocalSyncReport,
  operation: SyncOperation,
  phase: SyncTimingPhase,
  startedAt: number
): void {
  report.timings.push({
    operation,
    phase,
    ms: Number((performance.now() - startedAt).toFixed(3)),
  });
}

async function timed<T>(
  report: LocalSyncReport,
  operation: SyncOperation,
  phase: SyncTimingPhase,
  fn: () => Promise<T>
): Promise<T> {
  const startedAt = performance.now();
  try {
    return await fn();
  } finally {
    addTiming(report, operation, phase, startedAt);
  }
}

function safeMarkdownPath(root: string, filename: string): string {
  if (path.isAbsolute(filename)) {
    throw new Error(`Absolute sync paths are not allowed: ${filename}`);
  }
  if (filename.includes("..")) {
    throw new Error(`Path traversal is not allowed in sync paths: ${filename}`);
  }
  if (!filename.endsWith(".md")) {
    throw new Error(`Only Markdown files can be synced: ${filename}`);
  }
  const fullPath = path.resolve(root, filename);
  const resolvedRoot = path.resolve(root);
  if (!fullPath.startsWith(resolvedRoot + path.sep) && fullPath !== resolvedRoot) {
    throw new Error(`Sync path escaped Brain root: ${filename}`);
  }
  return fullPath;
}

function toPortablePath(root: string, fullPath: string): string {
  return path.relative(root, fullPath).split(path.sep).join("/");
}

async function isFile(filePath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(filePath);
    return stats.isFile();
  } catch (error: any) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return false;
    throw error;
  }
}

async function readFileHash(filePath: string): Promise<string | null> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return contentHash(content);
  } catch (error: any) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

type GuardedWriteResult = { ok: true } | { ok: false; currentHash: string | null };

// Write via temp file + rename (atomic, no torn files on crash), re-checking
// the target hash immediately before the rename so a local edit that landed
// after the caller's clean-hash decision is never silently overwritten.
async function writeLocalFileGuarded(
  fullPath: string,
  content: string,
  expectedHash: string | null
): Promise<GuardedWriteResult> {
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  const tmpPath = `${fullPath}.brain-sync-tmp-${process.pid}-${Date.now().toString(36)}`;
  await fs.writeFile(tmpPath, content, "utf-8");
  const currentHash = await readFileHash(fullPath);
  if (currentHash !== expectedHash) {
    await fs.rm(tmpPath, { force: true });
    return { ok: false, currentHash };
  }
  await fs.rename(tmpPath, fullPath);
  return { ok: true };
}

async function scanPolicy(root: string): Promise<{ skipNestedBrainDir: string | null }> {
  const rootLoaderPath = path.join(root, BRAIN_LOADER_FILENAME);
  const nestedBrainDir = path.join(root, NESTED_BRAIN_DIRNAME);
  const nestedLoaderPath = path.join(nestedBrainDir, BRAIN_LOADER_FILENAME);
  const rootHasLoader = await isFile(rootLoaderPath);
  const nestedHasLoader = await isFile(nestedLoaderPath);

  if (!rootHasLoader && nestedHasLoader) {
    throw new Error(
      `BRAIN_DIR appears to point at a parent container, not the Brain root. ` +
        `Use ${nestedBrainDir} as BRAIN_DIR.`
    );
  }

  return {
    skipNestedBrainDir: rootHasLoader && nestedHasLoader ? nestedBrainDir : null,
  };
}

async function scanMarkdownFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const policy = await scanPolicy(root);

  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (policy.skipNestedBrainDir === fullPath) continue;
        await walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        files.push(toPortablePath(root, fullPath));
      }
    }
  }

  await walk(root);
  return files.sort();
}

function includedMarkdownFiles(options: LocalSyncAgentOptions): Promise<string[]> {
  if (!options.includeFiles || options.includeFiles.length === 0) {
    return scanMarkdownFiles(options.brainDir);
  }
  const unique = Array.from(new Set(options.includeFiles));
  for (const filename of unique) {
    safeMarkdownPath(options.brainDir, filename);
  }
  return Promise.resolve(unique.sort());
}

function filterIncludedHeads<T extends { filename: string }>(
  options: LocalSyncAgentOptions,
  heads: T[]
): T[] {
  if (!options.includeFiles || options.includeFiles.length === 0) return heads;
  const included = new Set(options.includeFiles);
  return heads.filter((head) => included.has(head.filename));
}

export class LocalSyncAgent {
  constructor(private readonly options: LocalSyncAgentOptions) {}

  async loadState(): Promise<LocalSyncState> {
    try {
      const raw = await fs.readFile(this.options.stateFile, "utf-8");
      return JSON.parse(raw) as LocalSyncState;
    } catch (error: any) {
      if (error?.code !== "ENOENT") throw error;
      return {
        version: 1,
        clientId: randomUUID(),
        cursor: null,
        files: {},
      };
    }
  }

  async saveState(state: LocalSyncState): Promise<void> {
    await fs.mkdir(path.dirname(this.options.stateFile), { recursive: true });
    const tmpPath = `${this.options.stateFile}.tmp`;
    await fs.writeFile(tmpPath, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
    await fs.rename(tmpPath, this.options.stateFile);
  }

  async pushLocalChanges(): Promise<LocalSyncReport> {
    const report = emptyReport();
    const totalStartedAt = performance.now();
    const state = await timed(report, "push", "state_read", () => this.loadState());
    const filenames = await timed(report, "push", "local_scan", () =>
      includedMarkdownFiles(this.options)
    );

    for (const filename of filenames) {
      const fullPath = safeMarkdownPath(this.options.brainDir, filename);
      const content = await timed(report, "push", "local_read", () =>
        fs.readFile(fullPath, "utf-8")
      );
      const localHash = contentHash(content);
      const tracked = state.files[filename];

      if (tracked && tracked.localHash === localHash) {
        report.unchanged.push(filename);
        continue;
      }

      const result = await timed(report, "push", "revision_store_write", () =>
        this.options.store.proposeRevision({
          brainId: this.options.brainId,
          filename,
          baseRevisionId: tracked?.revisionId || null,
          content,
          origin: "local_agent",
          actor: this.options.actor,
        })
      );

      if (!result.ok) {
        report.conflicts.push(result.conflict);
        continue;
      }

      state.files[filename] = {
        revisionId: result.head.revisionId,
        contentHash: result.head.contentHash,
        localHash,
      };

      if (result.status === "accepted") {
        report.pushed.push(filename);
      } else {
        report.unchanged.push(filename);
      }
    }

    await timed(report, "push", "state_write", () => this.saveState(state));
    addTiming(report, "push", "total", totalStartedAt);
    return report;
  }

  async pullHostedChanges(): Promise<LocalSyncReport> {
    const report = emptyReport();
    const totalStartedAt = performance.now();
    const state = await timed(report, "pull", "state_read", () => this.loadState());
    const heads = await timed(report, "pull", "revision_store_list", async () =>
      filterIncludedHeads(
        this.options,
        await this.options.store.listFiles(this.options.brainId)
      )
    );
    let maxCursor = state.cursor ? Number(state.cursor) : 0;

    for (const head of heads) {
      const filename = head.filename;
      const fullPath = safeMarkdownPath(this.options.brainDir, filename);
      const tracked = state.files[filename];
      const localHash = await timed(report, "pull", "local_read", () =>
        readFileHash(fullPath)
      );

      if (tracked?.revisionId === head.revisionId) {
        if (localHash === null) {
          const remote = await timed(report, "pull", "revision_store_read", () =>
            this.options.store.readFile(this.options.brainId, filename)
          );
          const guarded = await timed(report, "pull", "local_write", () =>
            writeLocalFileGuarded(fullPath, remote.content, null)
          );
          if (!guarded.ok) {
            const conflict = await this.recordPullConflict(
              filename,
              tracked?.revisionId ?? null,
              head.revisionId,
              guarded.currentHash,
              head.contentHash
            );
            report.conflicts.push(conflict);
            continue;
          }
          state.files[filename] = {
            revisionId: head.revisionId,
            contentHash: head.contentHash,
            localHash: head.contentHash,
          };
          report.pulled.push(filename);
          maxCursor = Math.max(maxCursor, Number(head.cursor));
          continue;
        }
        report.unchanged.push(filename);
        maxCursor = Math.max(maxCursor, Number(head.cursor));
        continue;
      }

      if (localHash === head.contentHash) {
        state.files[filename] = {
          revisionId: head.revisionId,
          contentHash: head.contentHash,
          localHash,
        };
        report.unchanged.push(filename);
        maxCursor = Math.max(maxCursor, Number(head.cursor));
        continue;
      }

      if (tracked && localHash !== tracked.localHash) {
        const conflict = await this.recordPullConflict(
          filename,
          tracked.revisionId,
          head.revisionId,
          localHash,
          head.contentHash
        );
        report.conflicts.push(conflict);
        continue;
      }

      if (!tracked && localHash !== null) {
        const conflict = await this.recordPullConflict(
          filename,
          null,
          head.revisionId,
          localHash,
          head.contentHash
        );
        report.conflicts.push(conflict);
        continue;
      }

      const remote = await timed(report, "pull", "revision_store_read", () =>
        this.options.store.readFile(this.options.brainId, filename)
      );
      const guarded = await timed(report, "pull", "local_write", () =>
        writeLocalFileGuarded(fullPath, remote.content, localHash)
      );
      if (!guarded.ok) {
        const conflict = await this.recordPullConflict(
          filename,
          tracked?.revisionId ?? null,
          head.revisionId,
          guarded.currentHash,
          head.contentHash
        );
        report.conflicts.push(conflict);
        continue;
      }
      state.files[filename] = {
        revisionId: head.revisionId,
        contentHash: head.contentHash,
        localHash: head.contentHash,
      };
      report.pulled.push(filename);
      maxCursor = Math.max(maxCursor, Number(head.cursor));
    }

    state.cursor = maxCursor > 0 ? String(maxCursor) : state.cursor;
    await timed(report, "pull", "state_write", () => this.saveState(state));
    addTiming(report, "pull", "total", totalStartedAt);
    return report;
  }

  async syncOnce(): Promise<LocalSyncReport> {
    const startedAt = performance.now();
    const pushed = await this.pushLocalChanges();
    const pulled = await this.pullHostedChanges();
    const report = {
      pushed: pushed.pushed,
      pulled: pulled.pulled,
      unchanged: [...pushed.unchanged, ...pulled.unchanged],
      conflicts: [...pushed.conflicts, ...pulled.conflicts],
      timings: [...pushed.timings, ...pulled.timings],
    };
    addTiming(report, "sync", "total", startedAt);
    return report;
  }

  private async recordPullConflict(
    filename: string,
    localBaseRevisionId: string | null,
    remoteHeadRevisionId: string,
    localHash: string | null,
    remoteContentHash: string
  ): Promise<ConflictRecord> {
    return this.options.store.recordConflict({
      brainId: this.options.brainId,
      filename,
      localBaseRevisionId,
      remoteHeadRevisionId,
      localContentHash: localHash || "<missing>",
      remoteContentHash,
      localOrigin: "local_agent",
      remoteOrigin: "hosted_mcp",
      localActor: this.options.actor,
    });
  }
}
