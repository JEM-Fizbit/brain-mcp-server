import { contentHash } from "./hash.js";
import { lineMatchesSearchQuery } from "../search-match.js";
import { FileDeletedError } from "./types.js";
import type {
  ChangePage,
  ChangeRecord,
  ConflictInput,
  ConflictRecord,
  ConflictResolutionInput,
  ConflictResolutionResult,
  FileHead,
  ListFilesOptions,
  RevisionContent,
  RevisionDeletionProposal,
  RevisionProposal,
  RevisionProposalResult,
  RevisionRenameProposal,
  RevisionStore,
  SearchOptions,
  SearchResult,
} from "./types.js";

/**
 * Sentinel content hash for tombstone revisions. Not a valid 64-hex sha256, so it
 * can never collide with a real content hash in the identical-content short-circuit.
 */
const TOMBSTONE_HASH = "deleted";

function key(brainId: string, filename: string): string {
  return `${brainId}\0${filename}`;
}

function headOf(revision: RevisionContent): FileHead {
  const deleted = revision.deleted === true;
  return {
    brainId: revision.brainId,
    filename: revision.filename,
    revisionId: revision.revisionId,
    contentHash: revision.contentHash,
    lineCount: deleted ? 0 : revision.content.split("\n").length,
    byteCount: deleted ? 0 : Buffer.byteLength(revision.content, "utf-8"),
    updatedAt: revision.updatedAt,
    origin: revision.origin,
    actor: revision.actor,
    cursor: revision.cursor,
    deleted,
    renamedFrom: revision.renamedFrom,
    renamedTo: revision.renamedTo,
  };
}

export interface MemoryRevisionStoreSnapshot {
  heads: RevisionContent[];
  revisions: RevisionContent[];
  changes: ChangeRecord[];
  conflicts: ConflictRecord[];
  revisionSeq: number;
  cursorSeq: number;
  conflictSeq: number;
}

export class MemoryRevisionStore implements RevisionStore {
  private heads = new Map<string, RevisionContent>();
  private revisions = new Map<string, RevisionContent>();
  private changes: ChangeRecord[] = [];
  private conflicts: ConflictRecord[] = [];
  private revisionSeq = 0;
  private cursorSeq = 0;
  private conflictSeq = 0;

  constructor(snapshot?: MemoryRevisionStoreSnapshot) {
    if (!snapshot) return;
    this.heads = new Map(
      snapshot.heads.map((head) => [key(head.brainId, head.filename), head])
    );
    this.revisions = new Map(
      snapshot.revisions.map((revision) => [revision.revisionId, revision])
    );
    this.changes = [...snapshot.changes];
    this.conflicts = [...snapshot.conflicts];
    this.revisionSeq = snapshot.revisionSeq;
    this.cursorSeq = snapshot.cursorSeq;
    this.conflictSeq = snapshot.conflictSeq;
  }

  snapshot(): MemoryRevisionStoreSnapshot {
    return {
      heads: Array.from(this.heads.values()),
      revisions: Array.from(this.revisions.values()),
      changes: [...this.changes],
      conflicts: [...this.conflicts],
      revisionSeq: this.revisionSeq,
      cursorSeq: this.cursorSeq,
      conflictSeq: this.conflictSeq,
    };
  }

  async getHead(brainId: string, filename: string): Promise<FileHead | null> {
    const head = this.heads.get(key(brainId, filename));
    return head ? headOf(head) : null;
  }

  async readFile(brainId: string, filename: string): Promise<RevisionContent> {
    const head = this.heads.get(key(brainId, filename));
    if (!head) {
      throw new Error(`File not found in hosted revision store: ${filename}`);
    }
    if (head.deleted === true) {
      throw new FileDeletedError(filename);
    }
    return head;
  }

  async listFiles(
    brainId: string,
    options: ListFilesOptions = {}
  ): Promise<FileHead[]> {
    return Array.from(this.heads.values())
      .filter((head) => head.brainId === brainId)
      .filter((head) => options.includeDeleted || head.deleted !== true)
      .map(headOf)
      .sort((a, b) => a.filename.localeCompare(b.filename));
  }

  async searchFiles(
    brainId: string,
    query: string,
    options: SearchOptions = {}
  ): Promise<SearchResult[]> {
    const maxResults = Math.max(1, Math.min(options.maxResults || 50, 500));
    const results: SearchResult[] = [];

    for (const head of Array.from(this.heads.values()).sort((a, b) =>
      a.filename.localeCompare(b.filename)
    )) {
      if (head.brainId !== brainId) continue;
      if (head.deleted === true) continue;
      const lines = head.content.split("\n");
      for (let index = 0; index < lines.length; index += 1) {
        if (!lineMatchesSearchQuery(lines[index], query)) continue;
        results.push({
          filename: head.filename,
          lineNumber: index + 1,
          line: lines[index],
        });
        if (results.length >= maxResults) return results;
      }
    }

    return results;
  }

  async proposeRevision(input: RevisionProposal): Promise<RevisionProposalResult> {
    const fileKey = key(input.brainId, input.filename);
    const current = this.heads.get(fileKey) || null;
    const nextHash = contentHash(input.content);

    // Recreate-over-tombstone (spec 011): writing new content with base=null onto a
    // deleted head is an accepted recreate/undelete, not a conflict.
    const recreatingOverTombstone =
      current?.deleted === true && input.baseRevisionId === null;

    if (current && !current.deleted && current.contentHash === nextHash) {
      return {
        ok: true,
        status: "unchanged",
        head: headOf(current),
        revision: current,
      };
    }

    if (
      !recreatingOverTombstone &&
      ((current && input.baseRevisionId !== current.revisionId) ||
        (!current && input.baseRevisionId !== null))
    ) {
      const conflict = await this.recordConflict({
        brainId: input.brainId,
        filename: input.filename,
        localBaseRevisionId: input.baseRevisionId,
        remoteHeadRevisionId: current?.revisionId || null,
        localContentHash: nextHash,
        remoteContentHash: current?.contentHash || null,
        localOrigin: input.origin,
        remoteOrigin: current?.origin,
        localActor: input.actor,
        remoteActor: current?.actor,
      });
      return {
        ok: false,
        status: "conflict",
        conflict,
        currentHead: current ? headOf(current) : null,
      };
    }

    const revisionId = `rev_${++this.revisionSeq}`;
    const cursor = String(++this.cursorSeq);
    const updatedAt = new Date().toISOString();
    const revision: RevisionContent = {
      brainId: input.brainId,
      filename: input.filename,
      revisionId,
      parentRevisionId: current?.revisionId || null,
      contentHash: nextHash,
      updatedAt,
      origin: input.origin,
      actor: input.actor,
      cursor,
      content: input.content,
    };
    this.revisions.set(revisionId, revision);
    this.heads.set(fileKey, revision);
    this.changes.push({
      cursor,
      brainId: input.brainId,
      filename: input.filename,
      revisionId,
      contentHash: nextHash,
      updatedAt,
      origin: input.origin,
      actor: input.actor,
    });

    return {
      ok: true,
      status: "accepted",
      head: headOf(revision),
      revision,
    };
  }

  async proposeDeletion(
    input: RevisionDeletionProposal
  ): Promise<RevisionProposalResult> {
    const fileKey = key(input.brainId, input.filename);
    const current = this.heads.get(fileKey) || null;

    // Idempotent: re-deleting an already-deleted file is a no-op (spec 011,
    // idempotency on current.deleted — NOT on content hash).
    if (current?.deleted === true) {
      return {
        ok: true,
        status: "unchanged",
        head: headOf(current),
        revision: current,
      };
    }

    // CAS: stale base, or nothing to delete → conflict, never a silent delete.
    if (
      !current ||
      input.baseRevisionId !== current.revisionId
    ) {
      const conflict = await this.recordConflict({
        brainId: input.brainId,
        filename: input.filename,
        localBaseRevisionId: input.baseRevisionId,
        remoteHeadRevisionId: current?.revisionId || null,
        localContentHash: TOMBSTONE_HASH,
        remoteContentHash: current?.contentHash || null,
        localOrigin: input.origin,
        remoteOrigin: current?.origin,
        localActor: input.actor,
        remoteActor: current?.actor,
      });
      return {
        ok: false,
        status: "conflict",
        conflict,
        currentHead: current ? headOf(current) : null,
      };
    }

    const revisionId = `rev_${++this.revisionSeq}`;
    const cursor = String(++this.cursorSeq);
    const updatedAt = new Date().toISOString();
    const revision: RevisionContent = {
      brainId: input.brainId,
      filename: input.filename,
      revisionId,
      parentRevisionId: current.revisionId,
      contentHash: TOMBSTONE_HASH,
      updatedAt,
      origin: input.origin,
      actor: input.actor,
      cursor,
      content: "",
      deleted: true,
    };
    this.revisions.set(revisionId, revision);
    this.heads.set(fileKey, revision);
    this.changes.push({
      cursor,
      brainId: input.brainId,
      filename: input.filename,
      revisionId,
      contentHash: TOMBSTONE_HASH,
      updatedAt,
      origin: input.origin,
      actor: input.actor,
    });

    return {
      ok: true,
      status: "accepted",
      head: headOf(revision),
      revision,
    };
  }

  async proposeRename(
    input: RevisionRenameProposal
  ): Promise<RevisionProposalResult> {
    const fromKey = key(input.brainId, input.from);
    const toKey = key(input.brainId, input.to);
    const fromHead = this.heads.get(fromKey) || null;
    const toHead = this.heads.get(toKey) || null;

    // Source must be live and the base must match (CAS).
    if (
      !fromHead ||
      fromHead.deleted === true ||
      input.baseRevisionId !== fromHead.revisionId
    ) {
      const conflict = await this.recordConflict({
        brainId: input.brainId,
        filename: input.from,
        localBaseRevisionId: input.baseRevisionId,
        remoteHeadRevisionId: fromHead?.revisionId || null,
        localContentHash: TOMBSTONE_HASH,
        remoteContentHash: fromHead?.contentHash || null,
        localOrigin: input.origin,
        remoteOrigin: fromHead?.origin,
        localActor: input.actor,
        remoteActor: fromHead?.actor,
      });
      return {
        ok: false,
        status: "conflict",
        conflict,
        currentHead: fromHead ? headOf(fromHead) : null,
      };
    }

    // Target must not be a live file (a tombstoned target is fine — recreate).
    if (toHead && toHead.deleted !== true) {
      const conflict = await this.recordConflict({
        brainId: input.brainId,
        filename: input.to,
        localBaseRevisionId: null,
        remoteHeadRevisionId: toHead.revisionId,
        localContentHash: fromHead.contentHash,
        remoteContentHash: toHead.contentHash,
        localOrigin: input.origin,
        remoteOrigin: toHead.origin,
        localActor: input.actor,
        remoteActor: toHead.actor,
      });
      return {
        ok: false,
        status: "conflict",
        conflict,
        currentHead: headOf(toHead),
      };
    }

    // Atomic in memory: no awaits between the two head mutations.
    const updatedAt = new Date().toISOString();
    const toRevisionId = `rev_${++this.revisionSeq}`;
    const toCursor = String(++this.cursorSeq);
    const toRevision: RevisionContent = {
      brainId: input.brainId,
      filename: input.to,
      revisionId: toRevisionId,
      parentRevisionId: toHead?.revisionId || null,
      contentHash: fromHead.contentHash,
      updatedAt,
      origin: input.origin,
      actor: input.actor,
      cursor: toCursor,
      content: fromHead.content,
      renamedFrom: input.from,
    };
    const fromRevisionId = `rev_${++this.revisionSeq}`;
    const fromCursor = String(++this.cursorSeq);
    const fromTombstone: RevisionContent = {
      brainId: input.brainId,
      filename: input.from,
      revisionId: fromRevisionId,
      parentRevisionId: fromHead.revisionId,
      contentHash: TOMBSTONE_HASH,
      updatedAt,
      origin: input.origin,
      actor: input.actor,
      cursor: fromCursor,
      content: "",
      deleted: true,
      renamedTo: input.to,
    };

    this.revisions.set(toRevisionId, toRevision);
    this.heads.set(toKey, toRevision);
    this.revisions.set(fromRevisionId, fromTombstone);
    this.heads.set(fromKey, fromTombstone);
    for (const rev of [toRevision, fromTombstone]) {
      this.changes.push({
        cursor: rev.cursor,
        brainId: rev.brainId,
        filename: rev.filename,
        revisionId: rev.revisionId,
        contentHash: rev.contentHash,
        updatedAt: rev.updatedAt,
        origin: rev.origin,
        actor: rev.actor,
      });
    }

    return {
      ok: true,
      status: "accepted",
      head: headOf(toRevision),
      revision: toRevision,
    };
  }

  async readRevision(
    brainId: string,
    revisionId: string
  ): Promise<RevisionContent | null> {
    const revision = this.revisions.get(revisionId);
    return revision && revision.brainId === brainId ? revision : null;
  }

  async listChanges(brainId: string, sinceCursor?: string): Promise<ChangePage> {
    const since = sinceCursor ? Number(sinceCursor) : 0;
    const changes = this.changes.filter(
      (change) => change.brainId === brainId && Number(change.cursor) > since
    );
    return {
      changes,
      nextCursor: changes.at(-1)?.cursor || sinceCursor || null,
    };
  }

  async recordConflict(input: ConflictInput): Promise<ConflictRecord> {
    const conflict: ConflictRecord = {
      ...input,
      conflictId: `conflict_${++this.conflictSeq}`,
      createdAt: new Date().toISOString(),
      status: "open",
    };
    this.conflicts.push(conflict);
    return conflict;
  }

  async listConflicts(
    brainId: string,
    status?: "open" | "resolved" | "superseded"
  ): Promise<ConflictRecord[]> {
    return this.conflicts.filter(
      (conflict) =>
        conflict.brainId === brainId && (!status || conflict.status === status)
    );
  }

  async resolveConflict(
    input: ConflictResolutionInput
  ): Promise<ConflictResolutionResult> {
    const conflict = this.conflicts.find(
      (candidate) =>
        candidate.brainId === input.brainId &&
        candidate.conflictId === input.conflictId
    );
    if (!conflict) {
      throw new Error(`Conflict not found: ${input.conflictId}`);
    }
    if (conflict.status !== "open") {
      throw new Error(`Conflict is not open: ${input.conflictId}`);
    }

    const current = await this.getHead(input.brainId, conflict.filename);
    const resolution = await this.proposeRevision({
      brainId: input.brainId,
      filename: conflict.filename,
      baseRevisionId: current?.revisionId || null,
      content: input.content,
      origin: "hosted_mcp",
      actor: input.actor,
    });
    if (!resolution.ok) {
      throw new Error(
        `Could not resolve conflict ${input.conflictId}: current head changed`
      );
    }

    conflict.status = "resolved";
    conflict.resolutionRevisionId = resolution.revision.revisionId;
    conflict.resolvedAt = new Date().toISOString();
    return { conflict, revision: resolution.revision };
  }
}
