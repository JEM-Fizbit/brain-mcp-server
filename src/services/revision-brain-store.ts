import path from "node:path";
import { LOG_FILE, type SourceCategory, type LogOpType } from "../constants.js";
import {
  MAX_SEARCH_RESULTS,
  MAX_SEARCH_RESULTS_CEILING,
} from "../constants.js";
import {
  assertNotProtected,
  assertStructuralWriteAllowed,
  type BrainStore,
  type BrainSearchOptions,
  type CommitResult,
  type FileMetadata,
  type ReadScope,
  type SearchScope,
  type SyncStatus,
  type WriteMode,
} from "./brain-store.js";
import { assertBrainVaultPath } from "./brain-path.js";
import type { BrainRole } from "./registry.js";
import {
  rankSearchCandidates,
  sortSearchResults,
  type SearchCandidate,
  type SearchResult,
} from "../search-ranking.js";
import { FileRevisionStore } from "../sync/file-revision-store.js";
import type {
  ConflictRecord,
  ConflictResolutionResult,
  FileHead,
  RevisionActor,
  RevisionStore,
} from "../sync/types.js";
import type {
  SourceArtifactRecord,
  SourceManifestRecord,
  SourceMetadataStore,
} from "../sources/types.js";
import {
  appendLogEntryToContent,
  formatLogEntry,
  LOG_HEADER,
  readLogContent,
} from "./log.js";

function validateFilename(filename: string): void {
  if (path.isAbsolute(filename)) {
    throw new Error("Absolute paths are not allowed");
  }
  if (filename.includes("..")) {
    throw new Error("Path traversal (..) is not allowed");
  }
  if (!filename.endsWith(".md")) {
    throw new Error("Only .md files are supported");
  }
  assertBrainVaultPath(filename);
}

function lineCount(content: string): number {
  return content.split("\n").length;
}

function byteCount(content: string): number {
  return Buffer.byteLength(content, "utf-8");
}

function clampMaxResults(value?: number): number {
  return Math.min(
    Math.max(1, Math.floor(value || MAX_SEARCH_RESULTS)),
    MAX_SEARCH_RESULTS_CEILING
  );
}

async function fileMetadataFromHead(
  store: RevisionBrainStore,
  brainId: string,
  head: FileHead
): Promise<FileMetadata> {
  if (head.lineCount !== undefined && head.byteCount !== undefined) {
    return {
      name: head.filename,
      lines: head.lineCount,
      bytes: head.byteCount,
      lastModified: new Date(head.updatedAt),
      staleDays: null,
    };
  }

  const content = await store.readFile(brainId, head.filename);
  return {
    name: head.filename,
    lines: lineCount(content),
    bytes: byteCount(content),
    lastModified: new Date(head.updatedAt),
    staleDays: null,
  };
}

function formatArtifact(artifact: SourceArtifactRecord): string {
  return [
    `- kind: ${artifact.artifactKind}`,
    `  original_filename: ${artifact.originalFilename || "-"}`,
    `  mime_type: ${artifact.mimeType || "-"}`,
    `  byte_size: ${artifact.byteSize ?? "-"}`,
    `  retention_status: ${artifact.retentionStatus}`,
    `  storage_bucket: ${artifact.storageBucket || "-"}`,
    `  storage_path: ${artifact.storagePath || "-"}`,
    `  content_sha256: ${artifact.contentSha256 || "-"}`,
    `  external_provider: ${artifact.externalProvider || "-"}`,
    `  external_id: ${artifact.externalId || "-"}`,
  ].join("\n");
}

function formatSourceManifest(manifest: SourceManifestRecord): string {
  return [
    `# Source Manifest: ${manifest.source.label}`,
    "",
    `source_id: ${manifest.source.id}`,
    `category: ${manifest.source.category}`,
    `status: ${manifest.source.status}`,
    `source_date: ${manifest.source.sourceDate || "-"}`,
    `provenance_note: ${manifest.source.provenanceNote || "-"}`,
    `paths: ${manifest.paths.length ? manifest.paths.join(", ") : "-"}`,
    "",
    "Artifacts:",
    manifest.artifacts.length
      ? manifest.artifacts.map(formatArtifact).join("\n")
      : "- none",
    "",
    "Note: hosted source reads currently return metadata only. Original bytes remain in private artifact storage until an explicit download/signed-URL policy is implemented.",
  ].join("\n");
}

export class RevisionBrainStore implements BrainStore {
  constructor(
    private readonly revisionStore: RevisionStore,
    private readonly sourceStore?: SourceMetadataStore
  ) {}

  async brainExists(brainId: string): Promise<boolean> {
    const files = await this.revisionStore.listFiles(brainId);
    return files.length > 0;
  }

  async readFile(
    brainId: string,
    filename: string,
    scope: ReadScope = "brain"
  ): Promise<string> {
    if (scope !== "brain") {
      if (!this.sourceStore) {
        throw new Error("Revision store has no source metadata provider.");
      }
      const requested = filename.replace(/^sources\//, "");
      const manifests = await this.sourceStore.listSourceManifests(brainId);
      const manifest = manifests.find((candidate) =>
        candidate.paths.includes(requested)
      );
      if (!manifest) {
        throw new Error(`Source manifest not found in hosted metadata: ${filename}`);
      }
      return formatSourceManifest(manifest);
    }
    validateFilename(filename);
    return (await this.revisionStore.readFile(brainId, filename)).content;
  }

  async listFiles(
    brainId: string,
    scope: "brain" | "sources" = "brain"
  ): Promise<FileMetadata[] | string[]> {
    if (scope === "sources") return this.listSources(brainId);
    const heads = await this.revisionStore.listFiles(brainId);
    return Promise.all(
      heads.map((head) => fileMetadataFromHead(this, brainId, head))
    );
  }

  async listSources(brainId: string, category?: SourceCategory): Promise<string[]> {
    if (!this.sourceStore) return [];
    return this.sourceStore.listSourcePaths(brainId, category);
  }

  async searchFiles(
    brainId: string,
    query: string,
    options: BrainSearchOptions = {}
  ): Promise<SearchResult[]> {
    const scope: SearchScope = options.scope ?? "brain";
    const cap = clampMaxResults(options.maxResults);
    const ranked: SearchResult[] = [];
    const sourceCandidates: SearchCandidate[] = [];

    if (scope === "brain" || scope === "all") {
      const results = await this.revisionStore.searchFiles(brainId, query, {
        maxResults: cap,
        includeOperational: options.includeOperational,
        visibleFiles: options.visibleFiles
          ? Array.from(options.visibleFiles)
          : undefined,
      });
      ranked.push(
        ...results.map((result) => ({
          ...result,
          scope: "brain" as const,
        }))
      );
    }

    if (
      this.sourceStore &&
      (scope === "sources" || scope === "all")
    ) {
      const textMatches = await this.sourceStore.searchArtifactText(
        brainId,
        query,
        cap
      );
      sourceCandidates.push(
        ...textMatches.map((result) => ({
          filename: `sources/${result.path}`,
          lineNumber: result.lineNumber,
          line: result.line,
          scope: "sources" as const,
        }))
      );
    }

    if (
      this.sourceStore &&
      (scope === "sources" || scope === "all")
    ) {
      const lowerQuery = query.toLowerCase();
      const paths = await this.sourceStore.listSourcePaths(brainId);
      for (const sourcePath of paths) {
        if (!sourcePath.toLowerCase().includes(lowerQuery)) continue;
        sourceCandidates.push({
          filename: `sources/${sourcePath}`,
          lineNumber: 0,
          line: sourcePath,
          scope: "sources",
        });
        if (sourceCandidates.length >= cap * 2) break;
      }
    }

    ranked.push(
      ...rankSearchCandidates(sourceCandidates, query, {
        maxResults: cap,
        visibleFiles: options.visibleFiles,
      })
    );
    return sortSearchResults(ranked, cap);
  }

  async writeFile(
    brainId: string,
    filename: string,
    content: string,
    mode: WriteMode,
    oldContent?: string,
    actor?: RevisionActor,
    role?: BrainRole
  ): Promise<string> {
    validateFilename(filename);
    assertStructuralWriteAllowed(filename, role);
    const current = await this.revisionStore.getHead(brainId, filename);
    let nextContent = content;

    if (mode === "patch") {
      if (!oldContent) {
        throw new Error("patch mode requires old_content parameter");
      }
      const existing = await this.readFile(brainId, filename);
      const occurrences = existing.split(oldContent).length - 1;
      if (occurrences === 0) {
        throw new Error(
          `old_content not found in ${filename}. Ensure the text matches exactly (including whitespace and newlines).`
        );
      }
      if (occurrences > 1) {
        throw new Error(
          `old_content found ${occurrences} times in ${filename}. It must be unique. Provide more surrounding context to disambiguate.`
        );
      }
      // Function replacer: a plain-string replacement would interpret
      // $-patterns ($$, $&, $`, $') and silently corrupt the file.
      nextContent = existing.replace(oldContent, () => content);
    } else if (mode === "append") {
      const existing = current ? await this.readFile(brainId, filename) : "";
      const separator = existing.endsWith("\n") || existing.length === 0 ? "" : "\n";
      nextContent = existing + separator + content;
    }

    const result = await this.revisionStore.proposeRevision({
      brainId,
      filename,
      baseRevisionId: current?.revisionId || null,
      content: nextContent,
      origin: "hosted_mcp",
      actor,
    });

    if (!result.ok) {
      throw new Error(
        `Revision conflict for ${filename}: current head is ${result.currentHead?.revisionId || "none"}`
      );
    }

    return `Updated ${filename}: ${lineCount(nextContent)} lines, ${byteCount(nextContent)} bytes`;
  }

  async deleteFile(
    brainId: string,
    filename: string,
    actor?: RevisionActor
  ): Promise<string> {
    validateFilename(filename);
    assertNotProtected(filename, "delete");
    const current = await this.revisionStore.getHead(brainId, filename);
    if (!current || current.deleted === true) {
      throw new Error(`File not found: ${filename}`);
    }
    const result = await this.revisionStore.proposeDeletion({
      brainId,
      filename,
      baseRevisionId: current.revisionId,
      origin: "hosted_mcp",
      actor,
    });
    if (!result.ok) {
      throw new Error(
        `Delete conflict for ${filename}: current head is ${result.currentHead?.revisionId || "none"} (edited concurrently)`
      );
    }
    return `Deleted ${filename}`;
  }

  async renameFile(
    brainId: string,
    from: string,
    to: string,
    actor?: RevisionActor,
    role?: BrainRole
  ): Promise<string> {
    validateFilename(from);
    validateFilename(to);
    assertNotProtected(from, "rename");
    assertStructuralWriteAllowed(to, role);
    const current = await this.revisionStore.getHead(brainId, from);
    if (!current || current.deleted === true) {
      throw new Error(`File not found: ${from}`);
    }
    const result = await this.revisionStore.proposeRename({
      brainId,
      from,
      to,
      baseRevisionId: current.revisionId,
      origin: "hosted_mcp",
      actor,
    });
    if (!result.ok) {
      throw new Error(
        `Rename conflict: ${from} -> ${to} — the target may already exist or ${from} changed concurrently`
      );
    }
    return `Renamed ${from} -> ${to}`;
  }

  async restoreFile(
    brainId: string,
    filename: string,
    actor?: RevisionActor,
    role?: BrainRole
  ): Promise<string> {
    validateFilename(filename);
    assertStructuralWriteAllowed(filename, role);
    const current = await this.revisionStore.getHead(brainId, filename);
    if (!current || current.deleted !== true) {
      throw new Error(`File is not deleted (nothing to restore): ${filename}`);
    }
    const tombstone = await this.revisionStore.readRevision(
      brainId,
      current.revisionId
    );
    const priorId = tombstone?.parentRevisionId;
    if (!priorId) {
      throw new Error(`No prior revision to restore for ${filename}`);
    }
    const prior = await this.revisionStore.readRevision(brainId, priorId);
    if (!prior || prior.deleted === true) {
      throw new Error(`No live prior content to restore for ${filename}`);
    }
    // Recreate over the tombstone (base=null is the accepted-recreate path).
    const result = await this.revisionStore.proposeRevision({
      brainId,
      filename,
      baseRevisionId: null,
      content: prior.content,
      origin: "hosted_mcp",
      actor,
    });
    if (!result.ok) {
      throw new Error(`Restore conflict for ${filename}: current head changed`);
    }
    return `Restored ${filename}: ${lineCount(prior.content)} lines`;
  }

  async appendLog(
    brainId: string,
    opType: LogOpType,
    filesTouched: string[],
    summary: string,
    actor?: RevisionActor
  ): Promise<string> {
    const current = await this.revisionStore.getHead(brainId, LOG_FILE);
    const existing = current
      ? (await this.revisionStore.readFile(brainId, LOG_FILE)).content
      : LOG_HEADER;
    const nextContent = appendLogEntryToContent(
      existing,
      formatLogEntry(opType, filesTouched, summary)
    );

    const result = await this.revisionStore.proposeRevision({
      brainId,
      filename: LOG_FILE,
      baseRevisionId: current?.revisionId || null,
      content: nextContent,
      origin: "hosted_mcp",
      actor,
    });

    if (!result.ok) {
      throw new Error(
        `Revision conflict for ${LOG_FILE}: current head is ${result.currentHead?.revisionId || "none"}`
      );
    }

    return `Updated ${LOG_FILE}: ${lineCount(nextContent)} lines, ${byteCount(nextContent)} bytes`;
  }

  async readLog(brainId: string, limit = 20, offset = 0): Promise<string> {
    const content = await this.readFile(brainId, LOG_FILE);
    return readLogContent(content, limit, offset);
  }

  async commit(
    _brainId: string,
    _message: string,
    _authorIdentity?: string,
    _push = false
  ): Promise<CommitResult> {
    return {
      message:
        "Revision store harness does not commit to git; git export is intentionally out of the hot path.",
    };
  }

  async syncStatus(brainId: string): Promise<SyncStatus> {
    const [files, openConflicts] = await Promise.all([
      this.revisionStore.listFiles(brainId),
      this.revisionStore.listConflicts(brainId, "open"),
    ]);
    const latestCursor =
      files
        .map((file) => file.cursor)
        .filter(Boolean)
        .sort()
        .at(-1) || null;
    return {
      provider: "revision",
      hostedFiles: files.length,
      openConflicts: openConflicts.length,
      latestCursor,
    };
  }

  listConflicts(
    brainId: string,
    status?: "open" | "resolved" | "superseded"
  ): Promise<ConflictRecord[]> {
    return this.revisionStore.listConflicts(brainId, status);
  }

  async resolveConflict(
    brainId: string,
    conflictId: string,
    content: string,
    actor?: RevisionActor,
    role?: BrainRole
  ): Promise<ConflictResolutionResult> {
    const conflict = (await this.revisionStore.listConflicts(brainId)).find(
      (candidate) => candidate.conflictId === conflictId
    );
    if (!conflict) throw new Error(`Conflict not found: ${conflictId}`);
    assertStructuralWriteAllowed(conflict.filename, role);
    return this.revisionStore.resolveConflict({
      brainId,
      conflictId,
      content,
      actor,
    });
  }
}

export function revisionBrainStoreFromFile(filePath: string): RevisionBrainStore {
  return new RevisionBrainStore(new FileRevisionStore(filePath));
}
