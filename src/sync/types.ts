export type RevisionOrigin = "local_agent" | "hosted_mcp" | "import" | "system";

export interface RevisionActor {
  provider: string;
  id: string;
  name?: string;
  email?: string;
}

export interface FileHead {
  brainId: string;
  filename: string;
  revisionId: string;
  contentHash: string;
  lineCount?: number;
  byteCount?: number;
  updatedAt: string;
  origin: RevisionOrigin;
  actor?: RevisionActor;
  cursor: string;
  /** True when the head is a tombstone (spec 011). Absent/false = live file. */
  deleted?: boolean;
  /** On the new head after a rename: the path this file was renamed FROM. */
  renamedFrom?: string;
  /** On the old-path tombstone after a rename: the path it was renamed TO. */
  renamedTo?: string;
}

/** Thrown by readFile when the file's head is a tombstone (deleted). */
export class FileDeletedError extends Error {
  constructor(filename: string) {
    super(`File is deleted in the revision store: ${filename}`);
    this.name = "FileDeletedError";
  }
}

/** Input to propose a deletion (tombstone) — same CAS contract as a revision. */
export interface RevisionDeletionProposal {
  brainId: string;
  filename: string;
  baseRevisionId: string | null;
  origin: RevisionOrigin;
  actor?: RevisionActor;
}

/** Options for listing files. */
export interface ListFilesOptions {
  /** Include tombstoned (deleted) heads. Default false. */
  includeDeleted?: boolean;
}

/**
 * Input to atomically rename a file (spec 011): one operation creates `to`
 * (content of `from`) and tombstones `from`. baseRevisionId is the source head.
 */
export interface RevisionRenameProposal {
  brainId: string;
  from: string;
  to: string;
  baseRevisionId: string | null;
  origin: RevisionOrigin;
  actor?: RevisionActor;
}

export interface RevisionContent extends FileHead {
  parentRevisionId: string | null;
  content: string;
}

export interface RevisionProposal {
  brainId: string;
  filename: string;
  baseRevisionId: string | null;
  content: string;
  origin: RevisionOrigin;
  actor?: RevisionActor;
}

export interface ConflictInput {
  brainId: string;
  filename: string;
  localBaseRevisionId: string | null;
  remoteHeadRevisionId: string | null;
  localContentHash: string;
  remoteContentHash: string | null;
  localOrigin: RevisionOrigin;
  remoteOrigin?: RevisionOrigin;
  localActor?: RevisionActor;
  remoteActor?: RevisionActor;
}

export interface ConflictRecord extends ConflictInput {
  conflictId: string;
  createdAt: string;
  status: "open" | "resolved" | "superseded";
  resolutionRevisionId?: string;
  resolvedAt?: string;
}

export interface RevisionAccepted {
  ok: true;
  status: "accepted" | "unchanged";
  head: FileHead;
  revision: RevisionContent;
}

export interface RevisionConflict {
  ok: false;
  status: "conflict";
  conflict: ConflictRecord;
  currentHead: FileHead | null;
}

export type RevisionProposalResult = RevisionAccepted | RevisionConflict;

export interface ConflictResolutionInput {
  brainId: string;
  conflictId: string;
  content: string;
  actor?: RevisionActor;
}

export interface ConflictResolutionResult {
  conflict: ConflictRecord;
  revision: RevisionContent;
}

export interface SearchOptions {
  maxResults?: number;
}

export interface SearchResult {
  filename: string;
  lineNumber: number;
  line: string;
}

export interface ChangeRecord {
  cursor: string;
  brainId: string;
  filename: string;
  revisionId: string;
  contentHash: string;
  updatedAt: string;
  origin: RevisionOrigin;
  actor?: RevisionActor;
}

export interface ChangePage {
  changes: ChangeRecord[];
  nextCursor: string | null;
}

export interface RevisionStore {
  getHead(brainId: string, filename: string): Promise<FileHead | null>;
  readFile(brainId: string, filename: string): Promise<RevisionContent>;
  listFiles(brainId: string, options?: ListFilesOptions): Promise<FileHead[]>;
  searchFiles(
    brainId: string,
    query: string,
    options?: SearchOptions
  ): Promise<SearchResult[]>;
  proposeRevision(input: RevisionProposal): Promise<RevisionProposalResult>;
  proposeDeletion(input: RevisionDeletionProposal): Promise<RevisionProposalResult>;
  proposeRename(input: RevisionRenameProposal): Promise<RevisionProposalResult>;
  /** Read a specific revision by id (including tombstones) — used for restore/history. */
  readRevision(brainId: string, revisionId: string): Promise<RevisionContent | null>;
  listChanges(brainId: string, sinceCursor?: string): Promise<ChangePage>;
  recordConflict(input: ConflictInput): Promise<ConflictRecord>;
  listConflicts(
    brainId: string,
    status?: "open" | "resolved" | "superseded"
  ): Promise<ConflictRecord[]>;
  resolveConflict(input: ConflictResolutionInput): Promise<ConflictResolutionResult>;
}

export interface LocalFileSyncState {
  revisionId: string | null;
  contentHash: string | null;
  localHash: string | null;
}

export interface LocalSyncState {
  version: 1;
  clientId: string;
  cursor: string | null;
  files: Record<string, LocalFileSyncState>;
  /**
   * Files that were tracked but absent on the previous scan (spec 011 guarded
   * sync). A local deletion is only inferred after a file is absent on two
   * consecutive scans (debounce), so a transient half-synced scan cannot
   * tombstone anything.
   */
  pendingDeletions?: string[];
}

export type SyncOperation = "push" | "pull" | "sync";
export type SyncTimingPhase =
  | "total"
  | "state_read"
  | "state_write"
  | "local_scan"
  | "local_read"
  | "local_write"
  | "revision_store_read"
  | "revision_store_write"
  | "revision_store_list";

export interface SyncTiming {
  operation: SyncOperation;
  phase: SyncTimingPhase;
  ms: number;
}

export interface LocalSyncReport {
  pushed: string[];
  pulled: string[];
  unchanged: string[];
  conflicts: ConflictRecord[];
  timings: SyncTiming[];
  /** Files tombstoned this cycle from inferred local deletions (spec 011). */
  deleted: string[];
  /** Deletion candidates held back by a guard (debounce/health/mass-delete). */
  deletionsSkipped: string[];
  /** Human-readable reason a delete-inference guard fired this cycle, if any. */
  guardTripped?: string;
}
