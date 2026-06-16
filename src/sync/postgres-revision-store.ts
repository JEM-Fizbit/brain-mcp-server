import pg from "pg";
import { contentHash } from "./hash.js";
import type {
  ChangePage,
  ChangeRecord,
  ConflictInput,
  ConflictRecord,
  ConflictResolutionInput,
  ConflictResolutionResult,
  FileHead,
  RevisionActor,
  RevisionContent,
  RevisionOrigin,
  RevisionProposal,
  RevisionProposalResult,
  RevisionStore,
  SearchOptions,
  SearchResult,
} from "./types.js";

const { Pool } = pg;
type Pool = pg.Pool;
type PoolClient = pg.PoolClient;

interface RevisionRow {
  id: string;
  brain_id: string;
  filename: string;
  parent_revision_id: string | null;
  content: string;
  content_sha256: string;
  origin: RevisionOrigin;
  actor_provider: string | null;
  actor_id: string | null;
  actor_name: string | null;
  actor_email: string | null;
  created_at: Date;
}

interface HeadRow extends RevisionRow {
  updated_at: Date;
}

interface ConflictRow {
  id: string;
  brain_id: string;
  filename: string;
  local_base_revision_id: string | null;
  remote_head_revision_id: string | null;
  local_content_sha256: string;
  remote_content_sha256: string | null;
  local_origin: RevisionOrigin;
  remote_origin: RevisionOrigin | null;
  local_actor_provider: string | null;
  local_actor_id: string | null;
  remote_actor_provider: string | null;
  remote_actor_id: string | null;
  status: "open" | "resolved" | "superseded";
  resolution_revision_id: string | null;
  created_at: Date;
  resolved_at: Date | null;
}

function actorFromRow(row: RevisionRow): RevisionActor | undefined {
  if (!row.actor_provider || !row.actor_id) return undefined;
  return {
    provider: row.actor_provider,
    id: row.actor_id,
    name: row.actor_name || undefined,
    email: row.actor_email || undefined,
  };
}

function lineCount(content: string): number {
  return content.split("\n").length;
}

function byteCount(content: string): number {
  return Buffer.byteLength(content, "utf-8");
}

function revisionFromRow(row: RevisionRow): RevisionContent {
  return {
    brainId: row.brain_id,
    filename: row.filename,
    revisionId: row.id,
    parentRevisionId: row.parent_revision_id,
    contentHash: row.content_sha256,
    updatedAt: row.created_at.toISOString(),
    origin: row.origin,
    actor: actorFromRow(row),
    cursor: row.created_at.toISOString(),
    content: row.content,
  };
}

function headFromRow(row: HeadRow | RevisionRow): FileHead {
  const updatedAt =
    "updated_at" in row ? row.updated_at.toISOString() : row.created_at.toISOString();
  return {
    brainId: row.brain_id,
    filename: row.filename,
    revisionId: row.id,
    contentHash: row.content_sha256,
    lineCount: lineCount(row.content),
    byteCount: byteCount(row.content),
    updatedAt,
    origin: row.origin,
    actor: actorFromRow(row),
    cursor: row.created_at.toISOString(),
  };
}

function conflictFromRow(row: ConflictRow): ConflictRecord {
  return {
    conflictId: row.id,
    brainId: row.brain_id,
    filename: row.filename,
    localBaseRevisionId: row.local_base_revision_id,
    remoteHeadRevisionId: row.remote_head_revision_id,
    localContentHash: row.local_content_sha256,
    remoteContentHash: row.remote_content_sha256,
    localOrigin: row.local_origin,
    remoteOrigin: row.remote_origin || undefined,
    localActor:
      row.local_actor_provider && row.local_actor_id
        ? { provider: row.local_actor_provider, id: row.local_actor_id }
        : undefined,
    remoteActor:
      row.remote_actor_provider && row.remote_actor_id
        ? { provider: row.remote_actor_provider, id: row.remote_actor_id }
        : undefined,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    resolutionRevisionId: row.resolution_revision_id || undefined,
    resolvedAt: row.resolved_at?.toISOString(),
  };
}

async function transaction<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export class PostgresRevisionStore implements RevisionStore {
  readonly pool: Pool;

  constructor(poolOrConnectionString: Pool | string) {
    this.pool =
      typeof poolOrConnectionString === "string"
        ? new Pool({ connectionString: poolOrConnectionString })
        : poolOrConnectionString;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async getHead(brainId: string, filename: string): Promise<FileHead | null> {
    const result = await this.pool.query<HeadRow>(
      `
        select r.*, f.updated_at
        from brain.brain_files f
        join brain.brain_file_revisions r on r.id = f.current_revision_id
        where f.brain_id = $1 and f.filename = $2
      `,
      [brainId, filename]
    );
    return result.rows[0] ? headFromRow(result.rows[0]) : null;
  }

  async readFile(brainId: string, filename: string): Promise<RevisionContent> {
    const result = await this.pool.query<RevisionRow>(
      `
        select r.*
        from brain.brain_files f
        join brain.brain_file_revisions r on r.id = f.current_revision_id
        where f.brain_id = $1 and f.filename = $2
      `,
      [brainId, filename]
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error(`File not found in Postgres revision store: ${filename}`);
    }
    return revisionFromRow(row);
  }

  async listFiles(brainId: string): Promise<FileHead[]> {
    const result = await this.pool.query<HeadRow>(
      `
        select r.*, f.updated_at
        from brain.brain_files f
        join brain.brain_file_revisions r on r.id = f.current_revision_id
        where f.brain_id = $1
        order by f.filename
      `,
      [brainId]
    );
    return result.rows.map(headFromRow);
  }

  async searchFiles(
    brainId: string,
    query: string,
    options: SearchOptions = {}
  ): Promise<SearchResult[]> {
    const maxResults = Math.max(1, Math.min(options.maxResults || 50, 500));
    const lowerQuery = query.toLowerCase();
    const files = await this.pool.query<RevisionRow>(
      `
        select r.*
        from brain.brain_files f
        join brain.brain_file_revisions r on r.id = f.current_revision_id
        where f.brain_id = $1
        order by f.filename
      `,
      [brainId]
    );
    const results: SearchResult[] = [];
    for (const row of files.rows) {
      const lines = row.content.split("\n");
      for (let index = 0; index < lines.length; index += 1) {
        if (!lines[index].toLowerCase().includes(lowerQuery)) continue;
        results.push({
          filename: row.filename,
          lineNumber: index + 1,
          line: lines[index],
        });
        if (results.length >= maxResults) return results;
      }
    }
    return results;
  }

  async proposeRevision(input: RevisionProposal): Promise<RevisionProposalResult> {
    return transaction(this.pool, async (client) => {
      const currentResult = await client.query<HeadRow>(
        `
          select r.*, f.updated_at
          from brain.brain_files f
          left join brain.brain_file_revisions r on r.id = f.current_revision_id
          where f.brain_id = $1 and f.filename = $2
          for update of f
        `,
        [input.brainId, input.filename]
      );
      const current = currentResult.rows[0] || null;
      const nextHash = contentHash(input.content);

      if (current?.id && current.content_sha256 === nextHash) {
        return {
          ok: true,
          status: "unchanged",
          head: headFromRow(current),
          revision: revisionFromRow(current),
        };
      }

      if (
        (current?.id && input.baseRevisionId !== current.id) ||
        (!current && input.baseRevisionId !== null)
      ) {
        const conflict = await this.insertConflict(client, {
          brainId: input.brainId,
          filename: input.filename,
          localBaseRevisionId: input.baseRevisionId,
          remoteHeadRevisionId: current?.id || null,
          localContentHash: nextHash,
          remoteContentHash: current?.content_sha256 || null,
          localOrigin: input.origin,
          remoteOrigin: current?.origin,
          localActor: input.actor,
          remoteActor: current ? actorFromRow(current) : undefined,
        });
        return {
          ok: false,
          status: "conflict",
          conflict,
          currentHead: current?.id ? headFromRow(current) : null,
        };
      }

      if (!current) {
        await client.query(
          `
            insert into brain.brain_files (brain_id, filename)
            values ($1, $2)
            on conflict (brain_id, filename) do nothing
          `,
          [input.brainId, input.filename]
        );
      }

      const revisionResult = await client.query<RevisionRow>(
        `
          insert into brain.brain_file_revisions (
            brain_id,
            filename,
            parent_revision_id,
            content,
            content_sha256,
            origin,
            actor_provider,
            actor_id,
            actor_name,
            actor_email
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          returning *
        `,
        [
          input.brainId,
          input.filename,
          current?.id || null,
          input.content,
          nextHash,
          input.origin,
          input.actor?.provider || null,
          input.actor?.id || null,
          input.actor?.name || null,
          input.actor?.email || null,
        ]
      );
      const revision = revisionResult.rows[0];
      await client.query(
        `
          update brain.brain_files
          set current_revision_id = $3,
              current_content_sha256 = $4,
              updated_at = now()
          where brain_id = $1 and filename = $2
        `,
        [input.brainId, input.filename, revision.id, revision.content_sha256]
      );

      return {
        ok: true,
        status: "accepted",
        head: headFromRow(revision),
        revision: revisionFromRow(revision),
      };
    });
  }

  async listChanges(brainId: string, sinceCursor?: string): Promise<ChangePage> {
    const result = await this.pool.query<RevisionRow>(
      `
        select *
        from brain.brain_file_revisions
        where brain_id = $1
          and ($2::timestamptz is null or created_at > $2::timestamptz)
        order by created_at, id
      `,
      [brainId, sinceCursor || null]
    );
    const changes: ChangeRecord[] = result.rows.map((row) => ({
      cursor: row.created_at.toISOString(),
      brainId: row.brain_id,
      filename: row.filename,
      revisionId: row.id,
      contentHash: row.content_sha256,
      updatedAt: row.created_at.toISOString(),
      origin: row.origin,
      actor: actorFromRow(row),
    }));
    return {
      changes,
      nextCursor: changes.at(-1)?.cursor || sinceCursor || null,
    };
  }

  async recordConflict(input: ConflictInput): Promise<ConflictRecord> {
    return transaction(this.pool, (client) => this.insertConflict(client, input));
  }

  async listConflicts(
    brainId: string,
    status?: "open" | "resolved" | "superseded"
  ): Promise<ConflictRecord[]> {
    const result = await this.pool.query<ConflictRow>(
      `
        select *
        from brain.sync_conflicts
        where brain_id = $1
          and ($2::text is null or status = $2)
        order by created_at desc
      `,
      [brainId, status || null]
    );
    return result.rows.map(conflictFromRow);
  }

  async resolveConflict(
    input: ConflictResolutionInput
  ): Promise<ConflictResolutionResult> {
    return transaction(this.pool, async (client) => {
      const conflictResult = await client.query<ConflictRow>(
        `
          select *
          from brain.sync_conflicts
          where brain_id = $1 and id = $2
          for update
        `,
        [input.brainId, input.conflictId]
      );
      const conflict = conflictResult.rows[0];
      if (!conflict) {
        throw new Error(`Conflict not found: ${input.conflictId}`);
      }
      if (conflict.status !== "open") {
        throw new Error(`Conflict is not open: ${input.conflictId}`);
      }

      const currentResult = await client.query<HeadRow>(
        `
          select r.*, f.updated_at
          from brain.brain_files f
          left join brain.brain_file_revisions r on r.id = f.current_revision_id
          where f.brain_id = $1 and f.filename = $2
          for update of f
        `,
        [input.brainId, conflict.filename]
      );
      const current = currentResult.rows[0] || null;
      const nextHash = contentHash(input.content);

      if (!current) {
        await client.query(
          `
            insert into brain.brain_files (brain_id, filename)
            values ($1, $2)
            on conflict (brain_id, filename) do nothing
          `,
          [input.brainId, conflict.filename]
        );
      }

      const revisionResult = await client.query<RevisionRow>(
        `
          insert into brain.brain_file_revisions (
            brain_id,
            filename,
            parent_revision_id,
            content,
            content_sha256,
            origin,
            actor_provider,
            actor_id,
            actor_name,
            actor_email
          )
          values ($1, $2, $3, $4, $5, 'hosted_mcp', $6, $7, $8, $9)
          returning *
        `,
        [
          input.brainId,
          conflict.filename,
          current?.id || null,
          input.content,
          nextHash,
          input.actor?.provider || null,
          input.actor?.id || null,
          input.actor?.name || null,
          input.actor?.email || null,
        ]
      );
      const revision = revisionResult.rows[0];

      await client.query(
        `
          update brain.brain_files
          set current_revision_id = $3,
              current_content_sha256 = $4,
              updated_at = now()
          where brain_id = $1 and filename = $2
        `,
        [input.brainId, conflict.filename, revision.id, revision.content_sha256]
      );

      const resolvedResult = await client.query<ConflictRow>(
        `
          update brain.sync_conflicts
          set status = 'resolved',
              resolution_revision_id = $3,
              resolved_at = now()
          where brain_id = $1 and id = $2
          returning *
        `,
        [input.brainId, input.conflictId, revision.id]
      );

      return {
        conflict: conflictFromRow(resolvedResult.rows[0]),
        revision: revisionFromRow(revision),
      };
    });
  }

  private async insertConflict(
    client: PoolClient,
    input: ConflictInput
  ): Promise<ConflictRecord> {
    const result = await client.query<ConflictRow>(
      `
        insert into brain.sync_conflicts (
          brain_id,
          filename,
          local_base_revision_id,
          remote_head_revision_id,
          local_content_sha256,
          remote_content_sha256,
          local_origin,
          remote_origin,
          local_actor_provider,
          local_actor_id,
          remote_actor_provider,
          remote_actor_id
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        returning *
      `,
      [
        input.brainId,
        input.filename,
        input.localBaseRevisionId,
        input.remoteHeadRevisionId,
        input.localContentHash,
        input.remoteContentHash,
        input.localOrigin,
        input.remoteOrigin || null,
        input.localActor?.provider || null,
        input.localActor?.id || null,
        input.remoteActor?.provider || null,
        input.remoteActor?.id || null,
      ]
    );
    return conflictFromRow(result.rows[0]);
  }
}
