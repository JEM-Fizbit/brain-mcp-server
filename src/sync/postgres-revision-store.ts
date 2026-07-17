import pg from "pg";
import { contentHash } from "./hash.js";
import { attachPoolErrorLogger } from "../services/pg-pool.js";
import {
  meaningfulSearchTokens,
  normalizeSearchText,
} from "../search-match.js";
import {
  rankSearchCandidates,
  type SearchCandidate,
} from "../search-ranking.js";
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
  RevisionActor,
  RevisionContent,
  RevisionDeletionProposal,
  RevisionOrigin,
  RevisionProposal,
  RevisionProposalResult,
  RevisionRenameProposal,
  RevisionStore,
  SearchOptions,
  SearchResult,
  SyncHeartbeatInput,
} from "./types.js";

/** Sentinel hash for tombstone revisions — never a valid 64-hex sha256. */
const TOMBSTONE_HASH = "deleted";

const { Pool } = pg;
type Pool = pg.Pool;
type PoolClient = pg.PoolClient;

export function positiveNumberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function postgresPoolOptions(
  connectionString: string,
  options: { maxEnv?: string; defaultMax?: number; allowExitOnIdle?: boolean } = {}
): pg.PoolConfig {
  const queryTimeoutMs = positiveNumberEnv("BRAIN_PG_QUERY_TIMEOUT_MS", 30_000);
  const poolOptions: pg.PoolConfig = {
    connectionString,
    max: positiveNumberEnv(options.maxEnv || "BRAIN_PG_POOL_MAX", options.defaultMax ?? 4),
    connectionTimeoutMillis: positiveNumberEnv("BRAIN_PG_CONNECTION_TIMEOUT_MS", 5_000),
    idleTimeoutMillis: positiveNumberEnv("BRAIN_PG_IDLE_TIMEOUT_MS", 10_000),
    query_timeout: queryTimeoutMs,
    statement_timeout: positiveNumberEnv("BRAIN_PG_STATEMENT_TIMEOUT_MS", queryTimeoutMs),
  };
  if (options.allowExitOnIdle !== undefined) {
    poolOptions.allowExitOnIdle = options.allowExitOnIdle;
  }
  return poolOptions;
}

interface RevisionRow {
  id: string;
  brain_id: string;
  filename: string;
  parent_revision_id: string | null;
  content: string | null;
  content_sha256: string | null;
  deleted: boolean;
  metadata: { renamedFrom?: string; renamedTo?: string } | null;
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

interface SearchRevisionRow extends RevisionRow {
  search_rank: number | string;
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
    contentHash: row.content_sha256 ?? TOMBSTONE_HASH,
    updatedAt: row.created_at.toISOString(),
    origin: row.origin,
    actor: actorFromRow(row),
    cursor: row.created_at.toISOString(),
    content: row.content ?? "",
    deleted: row.deleted === true,
    renamedFrom: row.metadata?.renamedFrom,
    renamedTo: row.metadata?.renamedTo,
  };
}

function headFromRow(row: HeadRow | RevisionRow): FileHead {
  const updatedAt =
    "updated_at" in row ? row.updated_at.toISOString() : row.created_at.toISOString();
  const deleted = row.deleted === true;
  return {
    brainId: row.brain_id,
    filename: row.filename,
    revisionId: row.id,
    contentHash: row.content_sha256 ?? TOMBSTONE_HASH,
    lineCount: deleted || row.content === null ? 0 : lineCount(row.content),
    byteCount: deleted || row.content === null ? 0 : byteCount(row.content),
    updatedAt,
    origin: row.origin,
    actor: actorFromRow(row),
    cursor: row.created_at.toISOString(),
    deleted,
    renamedFrom: row.metadata?.renamedFrom,
    renamedTo: row.metadata?.renamedTo,
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
        ? attachPoolErrorLogger(
            new Pool(postgresPoolOptions(poolOrConnectionString)),
            "revision_store"
          )
        : poolOrConnectionString;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async recordSyncHeartbeat(input: SyncHeartbeatInput): Promise<void> {
    const counts = {
      pushed: input.report.pushed.length,
      pulled: input.report.pulled.length,
      unchanged: input.report.unchanged.length,
      conflicts: input.report.conflicts.length,
      deleted: input.report.deleted.length,
      deletionsSkipped: input.report.deletionsSkipped.length,
    };
    const durationMs = input.report.timings.find(
      (timing) => timing.operation === "sync" && timing.phase === "total"
    )?.ms ?? null;
    const metadata = {
      version: 1,
      source: "local_sync_agent",
      timingLayer: "sync_cycle",
      durationType: "sync_cycle",
      ok: true,
      counts,
      guardTripped: Boolean(input.report.guardTripped),
    };

    try {
      await this.pool.query(
        `
          insert into brain.sync_events (
            brain_id,
            event_type,
            duration_ms,
            metadata,
            created_at
          )
          values ($1, $2, $3, $4::jsonb, now())
        `,
        [
          input.brainId,
          "sync_heartbeat",
          durationMs,
          JSON.stringify(metadata),
        ]
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[sync-heartbeat] Could not record heartbeat: ${message.slice(0, 180)}`);
    }
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
    if (row.deleted === true) {
      throw new FileDeletedError(filename);
    }
    return revisionFromRow(row);
  }

  async listFiles(
    brainId: string,
    options: ListFilesOptions = {}
  ): Promise<FileHead[]> {
    const result = await this.pool.query<HeadRow>(
      `
        select r.*, f.updated_at
        from brain.brain_files f
        join brain.brain_file_revisions r on r.id = f.current_revision_id
        where f.brain_id = $1 and ($2 or r.deleted = false)
        order by f.filename
      `,
      [brainId, options.includeDeleted === true]
    );
    return result.rows.map(headFromRow);
  }

  async searchFiles(
    brainId: string,
    query: string,
    options: SearchOptions = {}
  ): Promise<SearchResult[]> {
    const maxResults = Math.max(1, Math.min(options.maxResults || 50, 500));
    const ftsQuery =
      meaningfulSearchTokens(query).join(" ") || normalizeSearchText(query);
    if (!ftsQuery) return [];
    const visibleFiles = options.visibleFiles
      ? Array.from(new Set(options.visibleFiles))
      : null;
    if (visibleFiles && visibleFiles.length === 0) return [];
    const ftsFiles = await this.pool.query<SearchRevisionRow>(
      `
        with search_query as (
          select websearch_to_tsquery('simple', $2) as value
        )
        select
          r.*,
          ts_rank_cd(
            to_tsvector('simple', coalesce(r.filename, '') || ' ' || coalesce(r.content, '')),
            q.value,
            32
          ) as search_rank
        from brain.brain_files f
        join brain.brain_file_revisions r on r.id = f.current_revision_id
        cross join search_query q
        where f.brain_id = $1
          and r.deleted = false
          and q.value @@ to_tsvector(
            'simple',
            coalesce(r.filename, '') || ' ' || coalesce(r.content, '')
          )
          and (
            $4::boolean
            or (
              lower(r.filename) !~ '(^|/)(log|journal)\\.md$'
              and lower(r.filename) not like 'archive/%'
              and lower(r.filename) not like 'working/%'
            )
          )
          and ($5::text[] is null or r.filename = any($5::text[]))
        order by search_rank desc, r.filename
        limit $3
      `,
      [
        brainId,
        ftsQuery,
        Math.max(maxResults * 4, 20),
        options.includeOperational === true,
        visibleFiles,
      ]
    );
    const rankRows = (
      rows: SearchRevisionRow[],
      nativeFts: boolean
    ): SearchResult[] => {
      const candidates: SearchCandidate[] = [];
      for (const row of rows) {
        const lines = (row.content ?? "").split("\n");
        for (let index = 0; index < lines.length; index += 1) {
          candidates.push({
            filename: row.filename,
            lineNumber: index + 1,
            line: lines[index],
            scope: "brain",
            nativeScore: nativeFts ? Number(row.search_rank) : undefined,
            nativeMechanism: nativeFts ? "fts" : undefined,
          });
        }
      }
      return rankSearchCandidates(candidates, query, {
        maxResults,
        visibleFiles: visibleFiles ? new Set(visibleFiles) : undefined,
      }).map(({ filename, lineNumber, line, score, mechanism }) => ({
        filename,
        lineNumber,
        line,
        score,
        mechanism,
      }));
    };

    const ftsRanked = rankRows(ftsFiles.rows, true);
    if (ftsRanked.length > 0) return ftsRanked;

    // Normalized/camel-case compatibility fallback. FTS is the production
    // primary path; when its tokenization yields no line-level result (for
    // example `c net id` vs `CNetID`), fetch the bounded visible knowledge set
    // and run the same deterministic scorer used by local search/evals.
    const fallbackFiles = await this.pool.query<SearchRevisionRow>(
        `
          select r.*, 0::double precision as search_rank
          from brain.brain_files f
          join brain.brain_file_revisions r on r.id = f.current_revision_id
          where f.brain_id = $1
            and r.deleted = false
            and (
              $2::boolean
              or (
                lower(r.filename) !~ '(^|/)(log|journal)\\.md$'
                and lower(r.filename) not like 'archive/%'
                and lower(r.filename) not like 'working/%'
              )
            )
            and ($3::text[] is null or r.filename = any($3::text[]))
          order by r.filename
          limit 500
        `,
        [brainId, options.includeOperational === true, visibleFiles]
      );
    return rankRows(fallbackFiles.rows, false);
  }

  async proposeRevision(input: RevisionProposal): Promise<RevisionProposalResult> {
    return transaction(this.pool, async (client) => {
      // Serialize writers per (brain, filename). The head-row lock below
      // cannot lock a row that does not exist yet, so two concurrent first
      // creations would otherwise both be accepted and one head silently
      // displaced with no conflict recorded.
      await client.query(
        `select pg_advisory_xact_lock(hashtextextended($1 || '/' || $2, 0))`,
        [input.brainId, input.filename]
      );
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

      // Recreate-over-tombstone (spec 011): new content with base=null onto a
      // deleted head is an accepted recreate, not a conflict.
      const recreatingOverTombstone =
        current?.id && current.deleted === true && input.baseRevisionId === null;

      if (
        current?.id &&
        current.deleted !== true &&
        current.content_sha256 === nextHash
      ) {
        return {
          ok: true,
          status: "unchanged",
          head: headFromRow(current),
          revision: revisionFromRow(current),
        };
      }

      if (
        !recreatingOverTombstone &&
        ((current?.id && input.baseRevisionId !== current.id) ||
          (!current && input.baseRevisionId !== null))
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

  async proposeDeletion(
    input: RevisionDeletionProposal
  ): Promise<RevisionProposalResult> {
    return transaction(this.pool, async (client) => {
      await client.query(
        `select pg_advisory_xact_lock(hashtextextended($1 || '/' || $2, 0))`,
        [input.brainId, input.filename]
      );
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

      // Idempotent: already deleted (idempotency on deleted, not on a hash).
      if (current?.id && current.deleted === true) {
        return {
          ok: true,
          status: "unchanged",
          head: headFromRow(current),
          revision: revisionFromRow(current),
        };
      }

      // CAS: stale base, or nothing to delete → conflict, never a silent delete.
      if (!current?.id || input.baseRevisionId !== current.id) {
        const conflict = await this.insertConflict(client, {
          brainId: input.brainId,
          filename: input.filename,
          localBaseRevisionId: input.baseRevisionId,
          remoteHeadRevisionId: current?.id || null,
          localContentHash: TOMBSTONE_HASH,
          remoteContentHash: current?.content_sha256 || null,
          localOrigin: input.origin,
          remoteOrigin: current?.origin,
          localActor: input.actor,
          remoteActor: current?.id ? actorFromRow(current) : undefined,
        });
        return {
          ok: false,
          status: "conflict",
          conflict,
          currentHead: current?.id ? headFromRow(current) : null,
        };
      }

      const revisionResult = await client.query<RevisionRow>(
        `
          insert into brain.brain_file_revisions (
            brain_id,
            filename,
            parent_revision_id,
            content,
            content_sha256,
            deleted,
            origin,
            actor_provider,
            actor_id,
            actor_name,
            actor_email
          )
          values ($1, $2, $3, null, null, true, $4, $5, $6, $7, $8)
          returning *
        `,
        [
          input.brainId,
          input.filename,
          current.id,
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
              current_content_sha256 = null,
              updated_at = now()
          where brain_id = $1 and filename = $2
        `,
        [input.brainId, input.filename, revision.id]
      );

      return {
        ok: true,
        status: "accepted",
        head: headFromRow(revision),
        revision: revisionFromRow(revision),
      };
    });
  }

  async proposeRename(
    input: RevisionRenameProposal
  ): Promise<RevisionProposalResult> {
    return transaction(this.pool, async (client) => {
      // Lock both keys in a deterministic order to avoid deadlock.
      for (const name of [input.from, input.to].sort()) {
        await client.query(
          `select pg_advisory_xact_lock(hashtextextended($1 || '/' || $2, 0))`,
          [input.brainId, name]
        );
      }
      const headQuery = `
        select r.*, f.updated_at
        from brain.brain_files f
        left join brain.brain_file_revisions r on r.id = f.current_revision_id
        where f.brain_id = $1 and f.filename = $2
        for update of f
      `;
      const from = (await client.query<HeadRow>(headQuery, [input.brainId, input.from])).rows[0] || null;
      const to = (await client.query<HeadRow>(headQuery, [input.brainId, input.to])).rows[0] || null;

      // Source must be live and the base must match (CAS).
      if (!from?.id || from.deleted === true || input.baseRevisionId !== from.id) {
        const conflict = await this.insertConflict(client, {
          brainId: input.brainId,
          filename: input.from,
          localBaseRevisionId: input.baseRevisionId,
          remoteHeadRevisionId: from?.id || null,
          localContentHash: TOMBSTONE_HASH,
          remoteContentHash: from?.content_sha256 || null,
          localOrigin: input.origin,
          remoteOrigin: from?.origin,
          localActor: input.actor,
          remoteActor: from?.id ? actorFromRow(from) : undefined,
        });
        return {
          ok: false,
          status: "conflict",
          conflict,
          currentHead: from?.id ? headFromRow(from) : null,
        };
      }

      // Target must not be a live file (a tombstoned target is fine — recreate).
      if (to?.id && to.deleted !== true) {
        const conflict = await this.insertConflict(client, {
          brainId: input.brainId,
          filename: input.to,
          localBaseRevisionId: null,
          remoteHeadRevisionId: to.id,
          localContentHash: from.content_sha256 || TOMBSTONE_HASH,
          remoteContentHash: to.content_sha256 || null,
          localOrigin: input.origin,
          remoteOrigin: to.origin,
          localActor: input.actor,
          remoteActor: actorFromRow(to),
        });
        return {
          ok: false,
          status: "conflict",
          conflict,
          currentHead: headFromRow(to),
        };
      }

      await client.query(
        `insert into brain.brain_files (brain_id, filename)
         values ($1, $2) on conflict (brain_id, filename) do nothing`,
        [input.brainId, input.to]
      );

      const actorArgs = [
        input.origin,
        input.actor?.provider || null,
        input.actor?.id || null,
        input.actor?.name || null,
        input.actor?.email || null,
      ];

      const toRev = (
        await client.query<RevisionRow>(
          `insert into brain.brain_file_revisions (
             brain_id, filename, parent_revision_id, content, content_sha256,
             deleted, metadata, origin, actor_provider, actor_id, actor_name, actor_email
           ) values ($1, $2, $3, $4, $5, false, $6::jsonb, $7, $8, $9, $10, $11)
           returning *`,
          [
            input.brainId,
            input.to,
            to?.id || null,
            from.content,
            from.content_sha256,
            JSON.stringify({ renamedFrom: input.from }),
            ...actorArgs,
          ]
        )
      ).rows[0];
      await client.query(
        `update brain.brain_files set current_revision_id = $3,
           current_content_sha256 = $4, updated_at = now()
         where brain_id = $1 and filename = $2`,
        [input.brainId, input.to, toRev.id, toRev.content_sha256]
      );

      const fromTomb = (
        await client.query<RevisionRow>(
          `insert into brain.brain_file_revisions (
             brain_id, filename, parent_revision_id, content, content_sha256,
             deleted, metadata, origin, actor_provider, actor_id, actor_name, actor_email
           ) values ($1, $2, $3, null, null, true, $4::jsonb, $5, $6, $7, $8, $9)
           returning *`,
          [
            input.brainId,
            input.from,
            from.id,
            JSON.stringify({ renamedTo: input.to }),
            ...actorArgs,
          ]
        )
      ).rows[0];
      await client.query(
        `update brain.brain_files set current_revision_id = $3,
           current_content_sha256 = null, updated_at = now()
         where brain_id = $1 and filename = $2`,
        [input.brainId, input.from, fromTomb.id]
      );

      return {
        ok: true,
        status: "accepted",
        head: headFromRow(toRev),
        revision: revisionFromRow(toRev),
      };
    });
  }

  async readRevision(
    brainId: string,
    revisionId: string
  ): Promise<RevisionContent | null> {
    const result = await this.pool.query<RevisionRow>(
      `select * from brain.brain_file_revisions where brain_id = $1 and id = $2`,
      [brainId, revisionId]
    );
    return result.rows[0] ? revisionFromRow(result.rows[0]) : null;
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
      contentHash: row.content_sha256 ?? TOMBSTONE_HASH,
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
