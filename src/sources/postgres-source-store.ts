import pg from "pg";
import { contentHash } from "../sync/hash.js";
import type {
  CreateSourceInput,
  RecordArtifactTextInput,
  RecordSourceArtifactInput,
  SourceArtifactRecord,
  SourceMetadataStore,
  SourceRecord,
} from "./types.js";
import type {
  StoredArtifactRef,
  SourceArtifactRetentionStatus,
} from "../artifacts/index.js";

const { Pool } = pg;
type Pool = pg.Pool;

interface SourceRow {
  id: string;
  brain_id: string;
  category: string;
  label: string;
  status: SourceRecord["status"];
  source_date: string | null;
  provenance_note: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

interface SourceArtifactRow {
  id: string;
  source_id: string;
  artifact_kind: SourceArtifactRecord["artifactKind"];
  storage_bucket: string | null;
  storage_path: string | null;
  external_url: string | null;
  external_provider: string | null;
  external_id: string | null;
  original_filename: string | null;
  mime_type: string | null;
  byte_size: string | number | null;
  content_sha256: string | null;
  retention_status: SourceArtifactRecord["retentionStatus"];
  metadata: Record<string, unknown>;
  created_at: Date;
}

function sourceFromRow(row: SourceRow): SourceRecord {
  return {
    id: row.id,
    brainId: row.brain_id,
    category: row.category,
    label: row.label,
    status: row.status,
    sourceDate: row.source_date,
    provenanceNote: row.provenance_note,
    metadata: row.metadata,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function artifactFromRow(row: SourceArtifactRow): SourceArtifactRecord {
  return {
    id: row.id,
    sourceId: row.source_id,
    artifactKind: row.artifact_kind,
    storageBucket: row.storage_bucket,
    storagePath: row.storage_path,
    externalUrl: row.external_url,
    externalProvider: row.external_provider,
    externalId: row.external_id,
    originalFilename: row.original_filename,
    mimeType: row.mime_type,
    byteSize: row.byte_size === null ? null : Number(row.byte_size),
    contentSha256: row.content_sha256,
    retentionStatus: row.retention_status,
    metadata: row.metadata,
    createdAt: row.created_at.toISOString(),
  };
}

export class PostgresSourceMetadataStore implements SourceMetadataStore {
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

  async createSource(input: CreateSourceInput): Promise<SourceRecord> {
    const result = await this.pool.query<SourceRow>(
      `
        insert into brain.sources (
          brain_id,
          category,
          label,
          status,
          source_date,
          provenance_note,
          metadata
        )
        values ($1, $2, $3, $4, $5, $6, $7)
        returning *
      `,
      [
        input.brainId,
        input.category,
        input.label,
        input.status ?? "pending",
        input.sourceDate ?? null,
        input.provenanceNote ?? null,
        input.metadata || {},
      ]
    );
    return sourceFromRow(result.rows[0]);
  }

  async recordArtifact(input: RecordSourceArtifactInput): Promise<SourceArtifactRecord> {
    const result = await this.pool.query<SourceArtifactRow>(
      `
        insert into brain.source_artifacts (
          source_id,
          artifact_kind,
          storage_bucket,
          storage_path,
          external_url,
          external_provider,
          external_id,
          original_filename,
          mime_type,
          byte_size,
          content_sha256,
          retention_status,
          metadata
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        returning *
      `,
      [
        input.sourceId,
        input.artifactKind,
        input.storageBucket ?? null,
        input.storagePath ?? null,
        input.externalUrl ?? null,
        input.externalProvider ?? null,
        input.externalId ?? null,
        input.originalFilename ?? null,
        input.mimeType ?? null,
        input.byteSize ?? null,
        input.contentSha256 ?? null,
        input.retentionStatus ?? "active",
        input.metadata || {},
      ]
    );
    return artifactFromRow(result.rows[0]);
  }

  recordStoredArtifact(
    sourceId: string,
    artifact: StoredArtifactRef,
    retentionStatus: SourceArtifactRetentionStatus = "active"
  ): Promise<SourceArtifactRecord> {
    return this.recordArtifact({
      sourceId,
      artifactKind: artifact.artifactKind,
      storageBucket: artifact.storageBucket,
      storagePath: artifact.storagePath,
      originalFilename: artifact.originalFilename,
      mimeType: artifact.mimeType,
      byteSize: artifact.byteSize,
      contentSha256: artifact.contentSha256,
      retentionStatus,
      metadata: artifact.metadata,
    });
  }

  async recordArtifactText(input: RecordArtifactTextInput): Promise<void> {
    await this.pool.query(
      `
        insert into brain.source_artifact_text (
          artifact_id,
          text_format,
          content,
          content_sha256,
          language
        )
        values ($1, $2, $3, $4, $5)
        on conflict (artifact_id) do update
        set text_format = excluded.text_format,
            content = excluded.content,
            content_sha256 = excluded.content_sha256,
            language = excluded.language,
            created_at = now()
      `,
      [
        input.artifactId,
        input.textFormat,
        input.content,
        contentHash(input.content),
        input.language || null,
      ]
    );
  }

  async listArtifacts(sourceId: string): Promise<SourceArtifactRecord[]> {
    const result = await this.pool.query<SourceArtifactRow>(
      `
        select *
        from brain.source_artifacts
        where source_id = $1
        order by created_at desc
      `,
      [sourceId]
    );
    return result.rows.map(artifactFromRow);
  }

  async listSourcePaths(brainId: string, category?: string): Promise<string[]> {
    const result = await this.pool.query<{ path: string }>(
      `
        select distinct
          coalesce(
            a.metadata->>'local_path',
            a.external_id,
            a.storage_path,
            s.metadata->>'local_path',
            s.label
          ) as path
        from brain.sources s
        left join brain.source_artifacts a on a.source_id = s.id
        where s.brain_id = $1
          and ($2::text is null or s.category = $2)
        order by path
      `,
      [brainId, category || null]
    );
    return result.rows.map((row) => row.path).filter(Boolean);
  }
}
