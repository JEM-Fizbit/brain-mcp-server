import fs from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { SupabaseArtifactStore } from "../dist/artifacts/index.js";

const databaseUrl = process.env.BRAIN_REVISION_DATABASE_URL;
const supabaseUrl = process.env.BRAIN_SUPABASE_URL || "https://omnwbcdtmtvxasgdmvwr.supabase.co";
const serviceRoleKey = process.env.BRAIN_SUPABASE_SERVICE_ROLE_KEY;
const bucket = process.env.BRAIN_SUPABASE_STORAGE_BUCKET || "brain-artifacts";
const brainId = process.env.BRAIN_ID || "ai-brain-jem";
const brainRoot =
  process.env.BRAIN_REPO_ROOT || "/Users/johnemilad/Projects/ai-brain-jem";
const limit = process.env.BRAIN_SOURCE_UPLOAD_LIMIT
  ? Number(process.env.BRAIN_SOURCE_UPLOAD_LIMIT)
  : null;

if (!databaseUrl) {
  console.error(
    "BRAIN_REVISION_DATABASE_URL is missing. Set it before uploading source artifacts."
  );
  process.exit(2);
}

if (!serviceRoleKey) {
  console.error(
    "BRAIN_SUPABASE_SERVICE_ROLE_KEY is missing. Store it as a secret and export it only in the shell that runs this upload."
  );
  process.exit(2);
}

const pool = new pg.Pool({ connectionString: databaseUrl });
const artifactStore = new SupabaseArtifactStore({
  supabaseUrl,
  serviceRoleKey,
  bucket,
});

async function pendingArtifacts() {
  const result = await pool.query(
    `
      select
        a.id,
        a.source_id,
        a.artifact_kind,
        a.original_filename,
        a.mime_type,
        a.byte_size,
        a.content_sha256,
        a.external_id,
        a.metadata
      from brain.source_artifacts a
      join brain.sources s on s.id = a.source_id
      where s.brain_id = $1
        and a.retention_status = 'pointer_only'
        and a.storage_bucket is null
        and a.storage_path is null
        and a.external_provider = 'local_filesystem'
        and a.external_id is not null
      order by a.created_at, a.id
    `,
    [brainId]
  );
  return limit ? result.rows.slice(0, limit) : result.rows;
}

async function markUploaded(row, stored) {
  await pool.query(
    `
      update brain.source_artifacts
      set storage_bucket = $2,
          storage_path = $3,
          mime_type = coalesce(mime_type, $4),
          byte_size = coalesce(byte_size, $5),
          content_sha256 = coalesce(content_sha256, $6),
          retention_status = 'active',
          metadata = metadata || $7::jsonb
      where id = $1
    `,
    [
      row.id,
      stored.storageBucket,
      stored.storagePath,
      stored.mimeType,
      stored.byteSize,
      stored.contentSha256,
      JSON.stringify({
        storage_upload_status: "uploaded",
        uploaded_at: new Date().toISOString(),
      }),
    ]
  );
}

try {
  const rows = await pendingArtifacts();
  let uploaded = 0;
  let skippedMissing = 0;

  console.log(`[source-upload] Uploading ${rows.length} pending artifacts to ${bucket}`);
  for (const row of rows) {
    const relativePath = row.external_id;
    const filePath = path.join(brainRoot, relativePath);
    const exists = await fs
      .access(filePath)
      .then(() => true)
      .catch(() => false);
    if (!exists) {
      skippedMissing += 1;
      await pool.query(
        `
          update brain.source_artifacts
          set metadata = metadata || $2::jsonb
          where id = $1
        `,
        [
          row.id,
          JSON.stringify({
            storage_upload_status: "missing_local_file",
            upload_attempted_at: new Date().toISOString(),
          }),
        ]
      );
      continue;
    }

    const stored = await artifactStore.putFile({
      brainId,
      sourceId: row.source_id,
      artifactKind: row.artifact_kind,
      originalFilename: row.original_filename || path.basename(filePath),
      mimeType: row.mime_type || "application/octet-stream",
      filePath,
      metadata: {
        local_path: relativePath,
        source_artifact_id: row.id,
      },
    });
    await markUploaded(row, stored);
    uploaded += 1;
  }

  console.log(
    JSON.stringify(
      {
        attempted: rows.length,
        uploaded,
        skippedMissing,
        bucket,
      },
      null,
      2
    )
  );
  console.log("[source-upload] PASS: pending source artifacts uploaded");
} finally {
  await pool.end();
}
