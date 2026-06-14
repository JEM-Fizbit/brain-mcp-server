import type { SourceCategory, LogOpType } from "../constants.js";
import type { ConflictRecord } from "../sync/types.js";
import * as brain from "./brain.js";
import * as git from "./git.js";
import * as log from "./log.js";

export type ReadScope = "brain" | "sources";
export type SearchScope = "brain" | "sources" | "all";
export type WriteMode = "replace" | "append" | "patch";

export interface FileMetadata {
  name: string;
  lines: number;
  bytes: number;
  lastModified: Date;
  staleDays: number | null;
}

export interface SearchResult {
  text: string;
}

export interface CommitResult {
  message: string;
}

export interface SyncStatus {
  provider: "filesystem" | "revision";
  hostedFiles: number;
  openConflicts: number;
  latestCursor: string | null;
}

export interface BrainStore {
  brainExists(brainId: string): Promise<boolean>;
  readFile(brainId: string, filename: string, scope?: ReadScope): Promise<string>;
  listFiles(brainId: string, scope?: "brain" | "sources"): Promise<FileMetadata[] | string[]>;
  listSources(brainId: string, category?: SourceCategory): Promise<string[]>;
  searchFiles(
    brainId: string,
    query: string,
    scope?: SearchScope,
    maxResults?: number
  ): Promise<string>;
  writeFile(
    brainId: string,
    filename: string,
    content: string,
    mode: WriteMode,
    oldContent?: string
  ): Promise<string>;
  appendLog(
    brainId: string,
    opType: LogOpType,
    filesTouched: string[],
    summary: string
  ): Promise<string>;
  readLog(brainId: string, limit?: number, offset?: number): Promise<string>;
  commit(
    brainId: string,
    message: string,
    authorIdentity?: string,
    push?: boolean
  ): Promise<CommitResult>;
  syncStatus(brainId: string): Promise<SyncStatus>;
  listConflicts(
    brainId: string,
    status?: "open" | "resolved" | "superseded"
  ): Promise<ConflictRecord[]>;
}

export class FilesystemBrainStore implements BrainStore {
  async brainExists(brainId: string): Promise<boolean> {
    try {
      await brain.listFileNames(brainId);
      return true;
    } catch {
      return false;
    }
  }

  readFile(brainId: string, filename: string, scope: ReadScope = "brain"): Promise<string> {
    return brain.readFile(filename, scope, brainId);
  }

  async listFiles(
    brainId: string,
    scope: "brain" | "sources" = "brain"
  ): Promise<FileMetadata[] | string[]> {
    if (scope === "sources") return brain.listSources(undefined, brainId);
    return brain.listFiles(brainId);
  }

  listSources(brainId: string, category?: SourceCategory): Promise<string[]> {
    return brain.listSources(category, brainId);
  }

  searchFiles(
    brainId: string,
    query: string,
    scope: SearchScope = "brain",
    maxResults?: number
  ): Promise<string> {
    return brain.search(query, scope, maxResults, brainId);
  }

  writeFile(
    brainId: string,
    filename: string,
    content: string,
    mode: WriteMode,
    oldContent?: string
  ): Promise<string> {
    return brain.updateFile(filename, content, mode, oldContent, brainId);
  }

  appendLog(
    brainId: string,
    opType: LogOpType,
    filesTouched: string[],
    summary: string
  ): Promise<string> {
    return log.appendLog(opType, filesTouched, summary, brainId);
  }

  readLog(brainId: string, limit?: number, offset?: number): Promise<string> {
    return log.readLog(limit, brainId, offset);
  }

  async commit(
    brainId: string,
    message: string,
    authorIdentity?: string,
    push = false
  ): Promise<CommitResult> {
    return {
      message: await git.commit(message, push, brainId, authorIdentity),
    };
  }

  async syncStatus(_brainId: string): Promise<SyncStatus> {
    return {
      provider: "filesystem",
      hostedFiles: 0,
      openConflicts: 0,
      latestCursor: null,
    };
  }

  async listConflicts(): Promise<ConflictRecord[]> {
    return [];
  }
}

export const filesystemBrainStore = new FilesystemBrainStore();
