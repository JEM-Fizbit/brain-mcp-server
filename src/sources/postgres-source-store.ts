import pg from "pg";
import { contentHash } from "../sync/hash.js";
import { postgresPoolOptions } from "../sync/postgres-revision-store.js";
import type {
  CreateSourceInput,
  RecordArtifactTextInput,
  RecordSourceArtifactInput,
  SourceArtifactRecord,
  SourceManifestRecord,
  SourceMetadataStore,
  SourceRecord,
  SourceTextSearchResult,
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

interface SourceManifestRow extends SourceRow {
  source_created_at: Date;
  source_updated_at: Date;
  artifact_id: string | null;
  source_id_row: string | null;
  artifact_kind: SourceArtifactRecord["artifactKind"] | null;
  storage_bucket: string | null;
  storage_path: string | null;
  external_url: string | null;
  external_provider: string | null;
  external_id: string | null;
  original_filename: string | null;
  mime_type: string | null;
  byte_size: string | number | null;
  content_sha256: string | null;
  retention_status: SourceArtifactRecord["retentionStatus"] | null;
  artifact_metadata: Record<string, unknown> | null;
  artifact_created_at: Date | null;
}

interface SourceTextSearchRow {
  source_id: string;
  source_label: string;
  artifact_id: string;
  display_path: string | null;
  text_format: SourceTextSearchResult["textFormat"];
  content: string;
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

function normalizeSourcePath(sourcePath: string): string {
  return sourcePath
    .replace(/^sources\//, "")
    .replace(/^brain\/working\//, "working/");
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function matchingLines(
  content: string,
  query: string,
  maxResults: number
): Array<{ lineNumber: number; line: string }> {
  const lowerQuery = query.toLowerCase();
  const results: Array<{ lineNumber: number; line: string }> = [];
  const lines = content.split("\n");
  for (const [index, line] of lines.entries()) {
    if (!line.toLowerCase().includes(lowerQuery)) continue;
    results.push({ lineNumber: index + 1, line });
    if (results.length >= maxResults) break;
  }
  return results;
}

export class PostgresSourceMetadataStore implements SourceMetadataStore {
  readonly pool: Pool;

  constructor(poolOrConnectionString: Pool | string) {
    this.pool =
      typeof poolOrConnectionString === "string"
        ? new Pool(postgresPoolOptions(poolOrConnectionString))
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
    const manifests = await this.listSourceManifests(brainId, category);
    return Array.from(
      new Set(manifests.flatMap((manifest) => manifest.paths).filter(Boolean))
    ).sort();
  }

  async listSourceManifests(
    brainId: string,
    category?: string
  ): Promise<SourceManifestRecord[]> {
    const result = await this.pool.query<SourceManifestRow>(
      `
        select
          s.id,
          s.brain_id,
          s.category,
          s.label,
          s.status,
          s.source_date,
          s.provenance_note,
          s.metadata,
          s.created_at as source_created_at,
          s.updated_at as source_updated_at,
          a.id as artifact_id,
          a.source_id as source_id_row,
          a.artifact_kind,
          a.storage_bucket,
          a.storage_path,
          a.external_url,
          a.external_provider,
          a.external_id,
          a.original_filename,
          a.mime_type,
          a.byte_size,
          a.content_sha256,
          a.retention_status,
          a.metadata as artifact_metadata,
          a.created_at as artifact_created_at
        from brain.sources s
        left join brain.source_artifacts a on a.source_id = s.id
        where s.brain_id = $1
          and ($2::text is null or s.category = $2)
        order by s.category, s.label, a.created_at desc nulls last
      `,
      [brainId, category || null]
    );

    const manifests = new Map<string, SourceManifestRecord>();
    for (const row of result.rows) {
      let manifest = manifests.get(row.id);
      if (!manifest) {
        manifest = {
          source: sourceFromRow({
            id: row.id,
            brain_id: row.brain_id,
            category: row.category,
            label: row.label,
            status: row.status,
            source_date: row.source_date,
            provenance_note: row.provenance_note,
            metadata: row.metadata,
            created_at: row.source_created_at,
            updated_at: row.source_updated_at,
          }),
          artifacts: [],
          paths: [],
        };
        manifests.set(row.id, manifest);
      }

      if (!row.artifact_id) continue;
      const artifact = artifactFromRow({
        id: row.artifact_id,
        source_id: row.source_id_row || row.id,
        artifact_kind: row.artifact_kind || "original",
        storage_bucket: row.storage_bucket,
        storage_path: row.storage_path,
        external_url: row.external_url,
        external_provider: row.external_provider,
        external_id: row.external_id,
        original_filename: row.original_filename,
        mime_type: row.mime_type,
        byte_size: row.byte_size,
        content_sha256: row.content_sha256,
        retention_status: row.retention_status || "pointer_only",
        metadata: row.artifact_metadata || {},
        created_at: row.artifact_created_at || row.source_created_at,
      });
      manifest.artifacts.push(artifact);
      const displayPath =
        artifact.metadata.local_path ||
        artifact.externalId ||
        artifact.storagePath ||
        manifest.source.metadata.local_path ||
        manifest.source.label;
      if (typeof displayPath === "string" && displayPath) {
        manifest.paths.push(normalizeSourcePath(displayPath));
      }
    }

    for (const manifest of manifests.values()) {
      manifest.paths = Array.from(new Set(manifest.paths)).sort();
    }
    return Array.from(manifests.values());
  }

  async searchArtifactText(
    brainId: string,
    query: string,
    maxResults: number
  ): Promise<SourceTextSearchResult[]> {
    const trimmed = query.trim();
    if (!trimmed || maxResults <= 0) return [];

    const result = await this.pool.query<SourceTextSearchRow>(
      `
        select
          s.id as source_id,
          s.label as source_label,
          a.id as artifact_id,
          coalesce(
            a.metadata->>'local_path',
            a.external_id,
            a.storage_path,
            s.metadata->>'local_path',
            s.label
          ) as display_path,
          t.text_format,
          t.content
        from brain.source_artifact_text t
        join brain.source_artifacts a on a.id = t.artifact_id
        join brain.sources s on s.id = a.source_id
        where s.brain_id = $1
          and t.content ilike $2 escape '\\'
        order by s.category, s.label, t.created_at desc
        limit $3
      `,
      [brainId, `%${escapeLikePattern(trimmed)}%`, Math.max(maxResults * 4, 8)]
    );

    const matches: SourceTextSearchResult[] = [];
    for (const row of result.rows) {
      const path = normalizeSourcePath(row.display_path || row.source_label);
      const remaining = maxResults - matches.length;
      for (const line of matchingLines(row.content, trimmed, remaining)) {
        matches.push({
          sourceId: row.source_id,
          sourceLabel: row.source_label,
          artifactId: row.artifact_id,
          path,
          textFormat: row.text_format,
          lineNumber: line.lineNumber,
          line: line.line,
        });
      }
      if (matches.length >= maxResults) break;
    }
    return matches;
  }
}
