import path from "node:path";
import type { SourceCategory, LogOpType } from "../constants.js";
import {
  MAX_SEARCH_RESULTS,
  MAX_SEARCH_RESULTS_CEILING,
  SEARCH_LINE_CHAR_LIMIT,
} from "../constants.js";
import type {
  BrainStore,
  CommitResult,
  FileMetadata,
  ReadScope,
  SearchScope,
  SyncStatus,
  WriteMode,
} from "./brain-store.js";
import { FileRevisionStore } from "../sync/file-revision-store.js";
import type { ConflictRecord, RevisionStore } from "../sync/types.js";
import type {
  SourceArtifactRecord,
  SourceManifestRecord,
  SourceMetadataStore,
} from "../sources/types.js";

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
      heads.map(async (head) => {
        const content = await this.readFile(brainId, head.filename);
        return {
          name: head.filename,
          lines: lineCount(content),
          bytes: byteCount(content),
          lastModified: new Date(head.updatedAt),
          staleDays: null,
        };
      })
    );
  }

  async listSources(brainId: string, category?: SourceCategory): Promise<string[]> {
    if (!this.sourceStore) return [];
    return this.sourceStore.listSourcePaths(brainId, category);
  }

  async searchFiles(
    brainId: string,
    query: string,
    scope: SearchScope = "brain",
    maxResults?: number
  ): Promise<string> {
    const cap = clampMaxResults(maxResults);
    const lines: string[] = [];

    if (scope === "brain" || scope === "all") {
      const results = await this.revisionStore.searchFiles(brainId, query, {
        maxResults: cap,
      });
      lines.push(
        ...results.map((result) => {
          const rawLine =
            result.line.length > SEARCH_LINE_CHAR_LIMIT
              ? `${result.line.slice(0, SEARCH_LINE_CHAR_LIMIT)}...`
              : result.line;
          return `${result.filename}:${result.lineNumber}: ${rawLine}`;
        })
      );
    }

    if (
      lines.length < cap &&
      this.sourceStore &&
      (scope === "sources" || scope === "all")
    ) {
      const lowerQuery = query.toLowerCase();
      const paths = await this.sourceStore.listSourcePaths(brainId);
      for (const sourcePath of paths) {
        if (!sourcePath.toLowerCase().includes(lowerQuery)) continue;
        lines.push(`sources:${sourcePath}`);
        if (lines.length >= cap) break;
      }
    }

    if (lines.length === 0) return "No matches found.";
    return lines.join("\n");
  }

  async writeFile(
    brainId: string,
    filename: string,
    content: string,
    mode: WriteMode,
    oldContent?: string
  ): Promise<string> {
    validateFilename(filename);
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
      nextContent = existing.replace(oldContent, content);
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
    });

    if (!result.ok) {
      throw new Error(
        `Revision conflict for ${filename}: current head is ${result.currentHead?.revisionId || "none"}`
      );
    }

    return `Updated ${filename}: ${lineCount(nextContent)} lines, ${byteCount(nextContent)} bytes`;
  }

  async appendLog(
    brainId: string,
    opType: LogOpType,
    filesTouched: string[],
    summary: string
  ): Promise<string> {
    const line = `${new Date().toISOString().slice(0, 10)} — ${opType} — ${filesTouched.join(", ")} — ${summary}`;
    return this.writeFile(brainId, "LOG.md", `${line}\n`, "append");
  }

  async readLog(brainId: string, limit = 20): Promise<string> {
    const content = await this.readFile(brainId, "LOG.md");
    return content
      .split("\n")
      .filter(Boolean)
      .slice(-limit)
      .reverse()
      .join("\n");
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
}

export function revisionBrainStoreFromFile(filePath: string): RevisionBrainStore {
  return new RevisionBrainStore(new FileRevisionStore(filePath));
}
