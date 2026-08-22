import path from "node:path";
import {
  SourceReferenceManifestSchema,
  type SourceReferenceManifest,
} from "./schema.js";

export interface SourceReferenceQueryable {
  query(
    text: string,
    values?: unknown[]
  ): Promise<{ rowCount: number | null; rows?: Array<Record<string, unknown>> }>;
}

export interface SourceReferencePersistenceReceipt {
  schema: "brain.source-persistence-receipt/v1";
  brainId: string;
  sourceId: string;
  artifactIds: string[];
  brainFiles: string[];
}

function assertOwnedUpsert(
  kind: string,
  id: string,
  result: { rowCount: number | null }
): void {
  if (result.rowCount !== 1) {
    throw new Error(`${kind} ${id} already belongs to a different source or Brain`);
  }
}

export async function persistSourceReference(
  client: SourceReferenceQueryable,
  input: unknown
): Promise<SourceReferencePersistenceReceipt> {
  const manifest: SourceReferenceManifest = SourceReferenceManifestSchema.parse(input);
  const sourceResult = await client.query(
    `
      insert into brain.sources (
        id, brain_id, category, label, status, source_date,
        provenance_note, companion_path, metadata
      )
      values ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9)
      on conflict (id) do update
      set category = excluded.category,
          label = excluded.label,
          status = excluded.status,
          source_date = excluded.source_date,
          provenance_note = excluded.provenance_note,
          companion_path = excluded.companion_path,
          metadata = brain.sources.metadata || excluded.metadata,
          updated_at = now()
      where brain.sources.brain_id = excluded.brain_id
      returning id
    `,
    [
      manifest.sourceId,
      manifest.brainId,
      manifest.category,
      manifest.label,
      manifest.status,
      manifest.sourceDate || null,
      manifest.provenanceNote,
      manifest.companionPath,
      {
        schema: manifest.schema,
        evidenceTier: manifest.evidenceTier,
        evidenceLimitation: manifest.evidenceLimitation || null,
        sourceUrls: manifest.sourceUrls,
        summary: manifest.summary || null,
      },
    ]
  );
  assertOwnedUpsert("Source", manifest.sourceId, sourceResult);

  for (const artifact of manifest.artifacts) {
    const artifactResult = await client.query(
      `
        insert into brain.source_artifacts (
          id, source_id, artifact_kind, storage_bucket, storage_path,
          external_url, external_provider, external_id, provider_revision,
          root_alias, relative_path, observed_at, original_filename, mime_type,
          byte_size, content_sha256, retention_status, metadata
        )
        values (
          $1::uuid, $2::uuid, $3, null, null,
          $4, $5, $6, $7, $8, $9, $10, $11, $12,
          $13, $14, 'pointer_only', $15
        )
        on conflict (id) do update
        set artifact_kind = excluded.artifact_kind,
            external_url = excluded.external_url,
            external_provider = excluded.external_provider,
            external_id = excluded.external_id,
            provider_revision = excluded.provider_revision,
            root_alias = excluded.root_alias,
            relative_path = excluded.relative_path,
            observed_at = excluded.observed_at,
            original_filename = excluded.original_filename,
            mime_type = excluded.mime_type,
            byte_size = excluded.byte_size,
            content_sha256 = excluded.content_sha256,
            retention_status = excluded.retention_status,
            metadata = brain.source_artifacts.metadata || excluded.metadata
        where brain.source_artifacts.source_id = excluded.source_id
        returning id
      `,
      [
        artifact.id,
        manifest.sourceId,
        artifact.kind,
        artifact.webUrl || null,
        artifact.provider || null,
        artifact.providerId || null,
        artifact.providerRevision || null,
        artifact.rootAlias || null,
        artifact.relativePath || null,
        artifact.observedAt || null,
        artifact.relativePath ? path.posix.basename(artifact.relativePath) : artifact.label,
        artifact.mimeType || null,
        artifact.byteSize ?? null,
        artifact.contentSha256 || null,
        { schema: manifest.schema, label: artifact.label },
      ]
    );
    assertOwnedUpsert("Artifact", artifact.id, artifactResult);
  }

  await client.query(
    `
      delete from brain.source_brain_links existing
      where existing.source_id = $1::uuid
        and existing.metadata ->> 'schema' = $2
        and existing.metadata ->> 'declared' = 'true'
        and not exists (
          select 1
          from jsonb_to_recordset($3::jsonb) as desired(
            brain_filename text,
            relation text,
            anchor text
          )
          where desired.brain_filename = existing.brain_filename
            and desired.relation = existing.relation
            and desired.anchor = existing.anchor
        )
    `,
    [
      manifest.sourceId,
      manifest.schema,
      JSON.stringify(
        manifest.brainLinks.map((link) => ({
          brain_filename: link.filename,
          relation: link.relation,
          anchor: link.anchor || "",
        }))
      ),
    ]
  );

  for (const link of manifest.brainLinks) {
    await client.query(
      `
        insert into brain.source_brain_links (
          source_id, brain_filename, relation, label, anchor, metadata
        )
        values ($1::uuid, $2, $3, $4, $5, $6)
        on conflict (source_id, brain_filename, relation, anchor) do update
        set label = excluded.label,
            metadata = excluded.metadata,
            updated_at = now()
      `,
      [
        manifest.sourceId,
        link.filename,
        link.relation,
        link.label || null,
        link.anchor || "",
        { schema: manifest.schema, declared: true },
      ]
    );
  }

  return {
    schema: "brain.source-persistence-receipt/v1",
    brainId: manifest.brainId,
    sourceId: manifest.sourceId,
    artifactIds: manifest.artifacts.map((artifact) => artifact.id),
    brainFiles: manifest.brainLinks.map((link) => link.filename),
  };
}
