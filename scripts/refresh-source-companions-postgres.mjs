#!/usr/bin/env node
import path from "node:path";
import pg from "pg";
import { SupabaseArtifactStore } from "../dist/artifacts/index.js";
import { loadLocalEnv } from "./lib/load-local-env.mjs";
import {
  inventoryCompanions,
  loadMonitorProfile,
  planCompanionRefresh,
  projectRefFromDatabaseUrl,
  sha256Bytes,
} from "./lib/source-companion-refresh.mjs";

loadLocalEnv();
const argv = process.argv.slice(2);

function flagValue(name) {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
}

function repeatedFlagValues(name) {
  return argv.flatMap((value, index) =>
    value === name && argv[index + 1] ? [argv[index + 1]] : []
  );
}

const apply = argv.includes("--apply");
const brainId = flagValue("--brain-id") || process.env.BRAIN_ID || "ai-brain-jem";
const brainRoot = path.resolve(
  flagValue("--brain-root") || process.env.BRAIN_REPO_ROOT || process.cwd()
);
const monitorConfig = flagValue("--monitor-config");
const monitorProfile = monitorConfig
  ? await loadMonitorProfile(monitorConfig, brainId)
  : null;
const expectedProjectRef =
  flagValue("--expected-project-ref") || monitorProfile?.expectedProjectRef;
const requestedPaths = repeatedFlagValues("--path");
const databaseUrl =
  monitorProfile?.databaseUrl ||
  process.env.BRAIN_SOURCE_REFERENCE_DATABASE_URL ||
  process.env.BRAIN_REVISION_DATABASE_URL;
const refreshMode = flagValue("--mode") || "pointer_text";

function usage() {
  return [
    "Usage: npm run sources:refresh-companions:postgres -- --brain-root <path> --path <sources/file.md> [--path ...] [--brain-id ai-brain-jem] [--monitor-config <owner-only-config.json>] [--expected-project-ref <ref>] [--mode pointer_text|storage] [--apply]",
    "",
    "Dry-run is the default. pointer_text versions the canonical reviewed Markdown in Postgres without requiring a broad Storage key; storage also snapshots bytes in private Storage.",
  ].join("\n");
}

async function registryRows(pool) {
  const result = await pool.query(
    `
      select distinct on (s.companion_path)
        s.id as source_id,
        s.brain_id,
        s.companion_path,
        a.id as artifact_id,
        a.artifact_kind,
        a.storage_bucket,
        a.storage_path,
        a.external_provider,
        a.external_id,
        a.provider_revision,
        a.root_alias,
        a.relative_path,
        a.original_filename,
        a.mime_type,
        a.content_sha256,
        a.retention_status,
        a.metadata
      from brain.sources s
      join brain.source_artifacts a on a.source_id = s.id
      where s.brain_id = $1
        and s.companion_path = any($2::text[])
        and coalesce(a.external_id, a.metadata->>'local_path') = s.companion_path
      order by s.companion_path, a.created_at desc, a.id desc
    `,
    [brainId, requestedPaths]
  );
  return result.rows;
}

async function refreshOne(pool, artifactStore, item) {
  const { local, current } = item;
  const observedAt = new Date().toISOString();
  const stored = await artifactStore.putFile({
    brainId,
    sourceId: current.source_id,
    artifactKind: current.artifact_kind,
    originalFilename: current.original_filename || path.basename(local.relativePath),
    mimeType: current.mime_type || "text/markdown",
    filePath: local.absolutePath,
    metadata: {
      ...(current.metadata || {}),
      local_path: local.relativePath,
      refreshed_at: observedAt,
      supersedes_artifact_id: current.artifact_id,
    },
  });

  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      `
        update brain.source_artifacts
        set retention_status = 'snapshot',
            metadata = metadata || $3::jsonb
        where source_id = $1::uuid
          and coalesce(external_id, metadata->>'local_path') = $2
          and retention_status = 'active'
      `,
      [
        current.source_id,
        local.relativePath,
        JSON.stringify({ superseded_at: observedAt, superseded_by_sha256: stored.contentSha256 }),
      ]
    );
    const inserted = await client.query(
      `
        insert into brain.source_artifacts (
          source_id, artifact_kind, storage_bucket, storage_path,
          external_provider, external_id, provider_revision, root_alias,
          relative_path, observed_at, original_filename, mime_type, byte_size,
          content_sha256, retention_status, metadata
        )
        values (
          $1::uuid, $2, $3, $4,
          $5, $6, $7, $8,
          $9, $10, $11, $12, $13,
          $14, 'active', $15::jsonb
        )
        returning id
      `,
      [
        current.source_id,
        current.artifact_kind,
        stored.storageBucket,
        stored.storagePath,
        current.external_provider,
        local.relativePath,
        current.provider_revision,
        current.root_alias,
        current.relative_path,
        observedAt,
        stored.originalFilename,
        stored.mimeType,
        stored.byteSize,
        stored.contentSha256,
        JSON.stringify(stored.metadata),
      ]
    );
    const artifactId = inserted.rows[0].id;
    const text = local.content.replace(/\u0000/g, "").trim();
    await client.query(
      `
        insert into brain.source_artifact_text (
          artifact_id, text_format, content, content_sha256, language
        )
        values ($1::uuid, 'markdown', $2, $3, null)
      `,
      [artifactId, text, sha256Bytes(text)]
    );
    await client.query(
      `
        update brain.sources
        set updated_at = now(),
            metadata = metadata || $2::jsonb
        where id = $1::uuid
          and brain_id = $3
      `,
      [current.source_id, JSON.stringify({ companion_refreshed_at: observedAt }), brainId]
    );
    await client.query("commit");
    return { artifactId, storagePath: stored.storagePath };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    await artifactStore.client.storage
      .from(stored.storageBucket)
      .remove([stored.storagePath])
      .catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function refreshPointerText(pool, item) {
  const { local, current } = item;
  const observedAt = new Date().toISOString();
  const text = local.content.replace(/\u0000/g, "").trim();
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      `
        update brain.source_artifacts
        set retention_status = 'snapshot',
            metadata = metadata || $3::jsonb
        where source_id = $1::uuid
          and coalesce(external_id, metadata->>'local_path') = $2
          and retention_status = 'active'
      `,
      [
        current.source_id,
        local.relativePath,
        JSON.stringify({
          superseded_at: observedAt,
          superseded_by_sha256: local.contentSha256,
        }),
      ]
    );
    const inserted = await client.query(
      `
        insert into brain.source_artifacts (
          source_id, artifact_kind, storage_bucket, storage_path,
          external_provider, external_id, provider_revision, root_alias,
          relative_path, observed_at, original_filename, mime_type, byte_size,
          content_sha256, retention_status, metadata
        )
        values (
          $1::uuid, $2, null, null,
          'brain_local', $3, null, null,
          null, $4, $5, 'text/markdown', $6,
          $7, 'active', $8::jsonb
        )
        returning id
      `,
      [
        current.source_id,
        current.artifact_kind || "markdown_conversion",
        local.relativePath,
        observedAt,
        path.basename(local.relativePath),
        local.byteSize,
        local.contentSha256,
        JSON.stringify({
          local_path: local.relativePath,
          refreshed_at: observedAt,
          refresh_mode: "pointer_text",
          text_authority: "brain.source_artifact_text",
          supersedes_artifact_id: current.artifact_id,
        }),
      ]
    );
    const artifactId = inserted.rows[0].id;
    await client.query(
      `
        insert into brain.source_artifact_text (
          artifact_id, text_format, content, content_sha256, language
        )
        values ($1::uuid, 'markdown', $2, $3, null)
      `,
      [artifactId, text, sha256Bytes(text)]
    );
    await client.query(
      `
        update brain.sources
        set updated_at = now(),
            metadata = metadata || $2::jsonb
        where id = $1::uuid
          and brain_id = $3
      `,
      [
        current.source_id,
        JSON.stringify({
          companion_refreshed_at: observedAt,
          companion_refresh_mode: "pointer_text",
        }),
        brainId,
      ]
    );
    await client.query("commit");
    return { artifactId, authority: "brain.source_artifact_text" };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

let pool;
try {
  if (!databaseUrl || requestedPaths.length === 0) {
    console.error(usage());
    if (!databaseUrl) console.error("A source-reference Postgres database URL is required.");
    process.exit(2);
  }
  if (brainId !== "ai-brain-jem") {
    throw new Error("Source companion refresh is JEM-pilot-only; refusing a different Brain id");
  }
  if (!new Set(["pointer_text", "storage"]).has(refreshMode)) {
    throw new Error("--mode must be pointer_text or storage");
  }
  if (
    monitorProfile &&
    flagValue("--expected-project-ref") &&
    flagValue("--expected-project-ref") !== monitorProfile.expectedProjectRef
  ) {
    throw new Error("Brain Monitor profile does not match --expected-project-ref");
  }
  const actualProjectRef = projectRefFromDatabaseUrl(databaseUrl);
  if (expectedProjectRef && actualProjectRef !== expectedProjectRef) {
    throw new Error("Database URL does not match --expected-project-ref");
  }
  if (apply && !expectedProjectRef) {
    throw new Error("--expected-project-ref is required in apply mode");
  }

  const inventory = await inventoryCompanions(brainRoot, requestedPaths);
  pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
  const plan = planCompanionRefresh(inventory, await registryRows(pool));
  const counts = plan.reduce((acc, item) => {
    acc[item.state] = (acc[item.state] || 0) + 1;
    return acc;
  }, {});
  console.log(`${apply ? "APPLY" : "DRY RUN"} source companion refresh for ${brainId}`);
  console.log(JSON.stringify({ projectRef: actualProjectRef, refreshMode, counts }, null, 2));
  for (const item of plan) console.log(`  ${item.state}: ${item.local.relativePath}`);

  const unregistered = plan.filter((item) => item.state === "unregistered");
  if (unregistered.length) {
    throw new Error(`${unregistered.length} requested companion(s) are not registered`);
  }
  if (!apply) {
    console.log("Database and Storage unchanged. Re-run with --apply after review.");
    process.exit(0);
  }

  let artifactStore;
  if (refreshMode === "storage") {
    const supabaseUrl = process.env.BRAIN_SUPABASE_URL;
    const serviceRoleKey = process.env.BRAIN_SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey || process.env.BRAIN_ARTIFACT_BYTE_ACCESS !== "admin") {
      throw new Error(
        "storage mode requires BRAIN_SUPABASE_URL, BRAIN_SUPABASE_SERVICE_ROLE_KEY, and BRAIN_ARTIFACT_BYTE_ACCESS=admin"
      );
    }
    artifactStore = new SupabaseArtifactStore({
      supabaseUrl,
      serviceRoleKey,
      bucket: process.env.BRAIN_SUPABASE_STORAGE_BUCKET || "brain-artifacts",
    });
  }
  const receipts = [];
  for (const item of plan.filter((candidate) => candidate.state === "refresh_required")) {
    const receipt =
      refreshMode === "storage"
        ? await refreshOne(pool, artifactStore, item)
        : await refreshPointerText(pool, item);
    receipts.push({ path: item.local.relativePath, ...receipt });
  }
  console.log(JSON.stringify({ refreshed: receipts.length, receipts }, null, 2));
  console.log("PASS: source companion refresh completed");
} catch (error) {
  console.error(`source companion refresh failed: ${String(error?.message || error)}`);
  process.exitCode = 1;
} finally {
  await pool?.end().catch(() => undefined);
}
