#!/usr/bin/env node
import path from "node:path";
import pg from "pg";
import { loadLocalEnv } from "./lib/load-local-env.mjs";
import { collectSourceBrainLinkDeclarations } from "./lib/source-brain-link-backfill.mjs";

loadLocalEnv();
const { Pool } = pg;
const argv = process.argv.slice(2);
const OWNERSHIP_SCHEMA = "brain.source-link-backfill/v1";

function flagValue(name) {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
}

function projectRefFromDatabaseUrl(databaseUrl) {
  const url = new URL(databaseUrl);
  const suffix = decodeURIComponent(url.username).split(".").at(-1);
  if (suffix && suffix !== "postgres" && /^[a-z0-9]{12,32}$/.test(suffix)) return suffix;
  return url.hostname.match(/^db\.([a-z0-9]{12,32})\.supabase\.co$/)?.[1] || null;
}

const brainRoot = path.resolve(
  flagValue("--brain-root") || process.env.BRAIN_REPO_ROOT || process.cwd()
);
const brainId = flagValue("--brain-id") || process.env.BRAIN_ID;
const expectedProjectRef = flagValue("--expected-project-ref");
const apply = argv.includes("--apply");
const createMissing = argv.includes("--create-missing");
const databaseUrl =
  process.env.BRAIN_SOURCE_REFERENCE_DATABASE_URL || process.env.BRAIN_REVISION_DATABASE_URL;

if (!brainId || !databaseUrl) {
  console.error(
    "Usage: npm run sources:backfill-brain-links:postgres -- --brain-root <path> --brain-id <id> [--expected-project-ref <ref>] [--apply]"
  );
  process.exit(2);
}

let pool;
try {
  if (apply && !expectedProjectRef) {
    throw new Error("--expected-project-ref is required in apply mode");
  }
  const actualProjectRef = projectRefFromDatabaseUrl(databaseUrl);
  if (expectedProjectRef && actualProjectRef !== expectedProjectRef) {
    throw new Error("Database URL does not match --expected-project-ref");
  }

  const declarations = await collectSourceBrainLinkDeclarations(brainRoot);
  pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  try {
    const plans = [];
    for (const declaration of declarations) {
      const result = await client.query(
        `
          select distinct s.id
          from brain.sources s
          left join brain.source_artifacts a on a.source_id = s.id
          where s.brain_id = $1
            and (
              s.companion_path = $2
              or s.metadata ->> 'local_path' = $2
              or a.metadata ->> 'local_path' = $2
              or a.external_id = $2
            )
        `,
        [brainId, declaration.companionPath]
      );
      if (result.rowCount !== 1) {
        if (result.rowCount !== 0) {
          throw new Error(
            `${declaration.companionPath} matched ${result.rowCount} source rows; expected at most one`
          );
        }
      }
      plans.push({
        ...declaration,
        sourceId: result.rows[0]?.id || null,
      });
    }

    const linkCount = plans.reduce((sum, plan) => sum + plan.links.length, 0);
    const missing = plans.filter((plan) => !plan.sourceId);
    if (!apply) {
      console.log(`DRY RUN ${brainId} (database unchanged)`);
      console.log(`  companions: ${plans.length}`);
      console.log(`  declared Brain links: ${linkCount}`);
      console.log(`  existing source ids: ${plans.length - missing.length}`);
      console.log(`  missing source ids: ${missing.length}`);
      for (const plan of missing) console.log(`    - ${plan.companionPath}`);
      console.log(
        "  re-run with --apply, --expected-project-ref, and --create-missing when needed to persist transactionally"
      );
      process.exit(0);
    }
    if (missing.length > 0 && !createMissing) {
      throw new Error(
        `${missing.length} companions have no source row; review the dry run and pass --create-missing to inventory them`
      );
    }

    await client.query("begin");
    try {
      for (const plan of plans) {
        if (!plan.sourceId) {
          const parts = plan.companionPath.split("/");
          const category = parts[1] || "uncategorized";
          const filename = parts.at(-1);
          const sourceDate = filename.match(/^(\d{4}-\d{2}-\d{2})[_-]/)?.[1] || null;
          const inserted = await client.query(
            `
              insert into brain.sources (
                brain_id, category, label, status, source_date,
                provenance_note, companion_path, metadata
              )
              values ($1, $2, $3, 'processed', $4, $5, $6, $7)
              returning id
            `,
            [
              brainId,
              category,
              filename,
              sourceDate,
              "Legacy companion inventory backfill from reviewed Brain-link declarations.",
              plan.companionPath,
              {
                local_path: plan.companionPath,
                byte_size: plan.byteSize,
                content_sha256: plan.contentSha256,
                inventory_status: "pointer_only_local",
              },
            ]
          );
          plan.sourceId = inserted.rows[0].id;
          await client.query(
            `
              insert into brain.source_artifacts (
                source_id, artifact_kind, external_provider, external_id,
                original_filename, mime_type, byte_size, content_sha256,
                retention_status, metadata
              )
              values ($1::uuid, 'original', 'local_filesystem', $2, $3,
                'text/markdown', $4, $5, 'pointer_only', $6)
            `,
            [
              plan.sourceId,
              plan.companionPath,
              filename,
              plan.byteSize,
              plan.contentSha256,
              {
                local_path: plan.companionPath,
                storage_upload_status: "pending",
                schema: OWNERSHIP_SCHEMA,
              },
            ]
          );
        }
        const sourceUpdate = await client.query(
          `
            update brain.sources
            set companion_path = $2,
                status = 'processed',
                provenance_note = case
                  when provenance_note = 'Local source artifact inventory; binary retention not yet uploaded to Storage.'
                    and exists (
                      select 1
                      from brain.source_artifacts stored
                      where stored.source_id = brain.sources.id
                        and stored.storage_bucket is not null
                        and stored.storage_path is not null
                    )
                    then 'Local source companion retained in private Storage; current reviewed Brain relationships are stored separately.'
                  else provenance_note
                end,
                metadata = metadata || $4::jsonb,
                updated_at = now()
            where id = $1::uuid
              and brain_id = $3
              and (companion_path is null or companion_path = $2)
            returning id
          `,
          [
            plan.sourceId,
            plan.companionPath,
            brainId,
            JSON.stringify({
              local_path: plan.companionPath,
              byte_size: plan.byteSize,
              content_sha256: plan.contentSha256,
            }),
          ]
        );
        if (sourceUpdate.rowCount !== 1) {
          throw new Error(`Could not bind companion path for ${plan.companionPath}`);
        }

        await client.query(
          `
            update brain.source_artifacts
            set byte_size = $3,
                content_sha256 = $4,
                metadata = metadata || $5::jsonb
            where source_id = $1::uuid
              and external_provider = 'local_filesystem'
              and external_id = $2
              and storage_bucket is null
              and storage_path is null
              and retention_status = 'pointer_only'
          `,
          [
            plan.sourceId,
            plan.companionPath,
            plan.byteSize,
            plan.contentSha256,
            JSON.stringify({ local_path: plan.companionPath }),
          ]
        );

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
            plan.sourceId,
            OWNERSHIP_SCHEMA,
            JSON.stringify(
              plan.links.map((link) => ({
                brain_filename: link.brainFilename,
                relation: link.relation,
                anchor: link.anchor,
              }))
            ),
          ]
        );

        for (const link of plan.links) {
          await client.query(
            `
              insert into brain.source_brain_links (
                source_id, brain_filename, relation, label, anchor, metadata
              )
              values ($1::uuid, $2, $3, $4, $5, $6)
              on conflict (source_id, brain_filename, relation, anchor) do update
              set label = excluded.label,
                  metadata = case
                    when brain.source_brain_links.metadata ->> 'schema' = $7
                      then excluded.metadata
                    else brain.source_brain_links.metadata
                  end,
                  updated_at = now()
            `,
            [
              plan.sourceId,
              link.brainFilename,
              link.relation,
              link.label,
              link.anchor,
              {
                schema: OWNERSHIP_SCHEMA,
                declared: true,
                companionPath: plan.companionPath,
              },
              OWNERSHIP_SCHEMA,
            ]
          );
        }
      }
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    }

    console.log(`APPLIED ${brainId}`);
    console.log(`  companions: ${plans.length}`);
    console.log(`  declared Brain links: ${linkCount}`);
    console.log(`  created source ids: ${missing.length}`);
  } finally {
    client.release();
  }
} catch (error) {
  console.error(`source Brain-link backfill failed: ${String(error?.message || error)}`);
  process.exitCode = 1;
} finally {
  await pool?.end().catch(() => undefined);
}
