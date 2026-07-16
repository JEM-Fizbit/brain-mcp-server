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
    deleted: [],
    deletionsSkipped: [],
  };
}

// Structural files that must be present for the tree to be considered healthy.
// Their absence from a scan means the folder is damaged / unmounted, not that
// the user deleted them (both are protected and never intentionally removable).
const HEALTH_MARKER_FILES = ["00_loader.md", "NOW.md"];

const DEFAULT_MAX_DELETES = 5;
const DEFAULT_MAX_DELETE_PCT = 10;

function positiveIntFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function syncDeleteLimits(): { maxDeletes: number; maxPct: number } {
  return {
    maxDeletes: positiveIntFromEnv("BRAIN_SYNC_MAX_DELETES", DEFAULT_MAX_DELETES),
    maxPct: positiveIntFromEnv("BRAIN_SYNC_MAX_DELETE_PCT", DEFAULT_MAX_DELETE_PCT),
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

    await this.inferGuardedDeletions(report, state, new Set(filenames));

    await timed(report, "push", "state_write", () => this.saveState(state));
    addTiming(report, "push", "total", totalStartedAt);
    return report;
  }

  /**
   * Infer local deletions (tracked files absent from the scan) and propagate
   * them as tombstones — but only behind three defence-in-depth guards
   * (spec 011, review-1 blocker #1). An empty/unmounted folder, a damaged tree
   * missing a structural marker, or an implausibly large batch never tombstones
   * anything; a genuine single deletion must also survive two consecutive scans
   * before it is applied.
   */
  private async inferGuardedDeletions(
    report: LocalSyncReport,
    state: LocalSyncState,
    scannedSet: Set<string>
  ): Promise<void> {
    const trackedNames = Object.keys(state.files);
    const candidates = trackedNames.filter((f) => !scannedSet.has(f));

    if (candidates.length === 0) {
      // Nothing is missing — reset any stale debounce memory.
      if (state.pendingDeletions && state.pendingDeletions.length > 0) {
        state.pendingDeletions = [];
      }
      return;
    }

    // Guard 1 — folder health. An empty scan or a vanished structural marker
    // means the tree is unmounted/damaged, not that files were deleted.
    const trackedSet = new Set(trackedNames);
    const scanNonEmpty = scannedSet.size > 0;
    const markersIntact = HEALTH_MARKER_FILES.every(
      (marker) => !trackedSet.has(marker) || scannedSet.has(marker)
    );
    if (!scanNonEmpty || !markersIntact) {
      report.deletionsSkipped.push(...candidates);
      report.guardTripped = !scanNonEmpty
        ? "empty_scan: no Markdown files found where files were tracked; refusing to infer deletions"
        : "health_marker_missing: a structural marker (00_loader.md/NOW.md) is absent; refusing to infer deletions";
      state.pendingDeletions = []; // an unhealthy scan must not arm the debounce
      return;
    }

    // Guard 2 — debounce. Only files absent on two consecutive scans qualify.
    const prevPending = new Set(state.pendingDeletions ?? []);
    const confirmed = candidates.filter((f) => prevPending.has(f));

    // Guard 3 — mass-delete threshold on the confirmed batch.
    const { maxDeletes, maxPct } = syncDeleteLimits();
    const pct = trackedNames.length
      ? (confirmed.length / trackedNames.length) * 100
      : 0;
    const overThreshold = confirmed.length > maxDeletes || pct > maxPct;

    if (confirmed.length > 0 && overThreshold) {
      report.deletionsSkipped.push(...confirmed);
      report.guardTripped =
        `mass_delete: ${confirmed.length} confirmed deletion(s) ` +
        `(${pct.toFixed(0)}% of ${trackedNames.length}) exceeds the limit ` +
        `(max ${maxDeletes} files or ${maxPct}%); operator review required`;
    } else {
      for (const filename of confirmed) {
        const tracked = state.files[filename];
        const result = await timed(report, "push", "revision_store_write", () =>
          this.options.store.proposeDeletion({
            brainId: this.options.brainId,
            filename,
            baseRevisionId: tracked.revisionId,
            origin: "local_agent",
            actor: this.options.actor,
          })
        );
        if (result.ok) {
          delete state.files[filename];
          report.deleted.push(filename);
        } else {
          report.conflicts.push(result.conflict);
        }
      }
    }

    // Debounce memory for the next scan: candidates still absent and still
    // tracked (i.e. not tombstoned this cycle).
    state.pendingDeletions = candidates.filter((f) => state.files[f]);
  }

  async pullHostedChanges(): Promise<LocalSyncReport> {
    const report = emptyReport();
    const totalStartedAt = performance.now();
    const state = await timed(report, "pull", "state_read", () => this.loadState());
    const heads = await timed(report, "pull", "revision_store_list", async () =>
      filterIncludedHeads(
        this.options,
        await this.options.store.listFiles(this.options.brainId, {
          includeDeleted: true,
        })
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

      // A hosted tombstone is an explicit deletion signal (not inference):
      // apply it by removing a clean local copy, refuse if the copy has
      // unsynced edits, and never touch a protected structural file.
      if (head.deleted) {
        maxCursor = Math.max(maxCursor, Number(head.cursor));
        if (HEALTH_MARKER_FILES.includes(filename)) {
          continue; // never unlink 00_loader.md / NOW.md from a remote tombstone
        }
        if (localHash === null) {
          delete state.files[filename]; // already gone locally — reconcile only
          continue;
        }
        const clean = tracked ? localHash === tracked.localHash : false;
        if (!clean) {
          const conflict = await this.recordPullConflict(
            filename,
            tracked?.revisionId ?? null,
            head.revisionId,
            localHash,
            head.contentHash
          );
          report.conflicts.push(conflict);
          continue;
        }
        await timed(report, "pull", "local_write", () =>
          fs.rm(fullPath, { force: true })
        );
        delete state.files[filename];
        report.deleted.push(filename);
        continue;
      }

      if (tracked?.revisionId === head.revisionId) {
        // A tracked file missing locally is NOT resurrected: local absence is
        // owned by the guarded push-side deletion path (spec 011). Leave it
        // absent and let push decide whether it is a real deletion.
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
    const report: LocalSyncReport = {
      pushed: pushed.pushed,
      pulled: pulled.pulled,
      unchanged: [...pushed.unchanged, ...pulled.unchanged],
      conflicts: [...pushed.conflicts, ...pulled.conflicts],
      timings: [...pushed.timings, ...pulled.timings],
      deleted: [...pushed.deleted, ...pulled.deleted],
      deletionsSkipped: [...pushed.deletionsSkipped, ...pulled.deletionsSkipped],
      guardTripped: pushed.guardTripped ?? pulled.guardTripped,
    };
    addTiming(report, "sync", "total", startedAt);
    if (this.options.store.recordSyncHeartbeat) {
      try {
        await this.options.store.recordSyncHeartbeat({
          brainId: this.options.brainId,
          report,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[sync-heartbeat] Could not record heartbeat: ${message.slice(0, 180)}`);
      }
    }
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
