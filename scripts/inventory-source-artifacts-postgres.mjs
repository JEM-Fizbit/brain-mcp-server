import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import pg from "pg";
import { loadLocalEnv } from "./lib/load-local-env.mjs";

loadLocalEnv();

const databaseUrl = process.env.BRAIN_REVISION_DATABASE_URL;

if (!databaseUrl) {
  console.error(
    "BRAIN_REVISION_DATABASE_URL is missing. Set it in your shell before running source inventory."
  );
  process.exit(2);
}

const brainId = process.env.BRAIN_ID || "ai-brain-jem";
const brainRoot = process.env.BRAIN_REPO_ROOT;

if (!brainRoot) {
  console.error("BRAIN_REPO_ROOT is missing. Set it to the Brain repository root before source inventory.");
  process.exit(2);
}

const inventoryRoots = [
  { root: path.join(brainRoot, "sources"), categoryPrefix: "" },
  { root: path.join(brainRoot, "brain", "working"), categoryPrefix: "working" },
];

const ignoredNames = new Set([".DS_Store", ".gitkeep"]);
const mimeByExtension = new Map([
  [".doc", "application/msword"],
  [".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".pdf", "application/pdf"],
  [".png", "image/png"],
  [".pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  [".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
]);

function mimeTypeFor(filePath) {
  return mimeByExtension.get(path.extname(filePath).toLowerCase()) || "application/octet-stream";
}

function parseSourceDate(filename) {
  const match = filename.match(/^(\d{4})-(\d{2})-(\d{2})[_-]/);
  if (!match) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

async function sha256File(filePath) {
  const body = await fs.readFile(filePath);
  return createHash("sha256").update(body).digest("hex");
}

async function listFiles(root) {
  const files = [];

  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.name.startsWith(".") && !ignoredNames.has(entry.name)) continue;
      if (ignoredNames.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }

  await walk(root);
  return files.sort();
}

async function sourceIdFor(client, file, category, relativePath, stats, sha256) {
  const existing = await client.query(
    `
      select id
      from brain.sources
      where brain_id = $1
        and metadata->>'local_path' = $2
      order by created_at desc
      limit 1
    `,
    [brainId, relativePath]
  );
  if (existing.rows[0]) return existing.rows[0].id;

  const inserted = await client.query(
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
      values ($1, $2, $3, 'pending', $4, $5, $6)
      returning id
    `,
    [
      brainId,
      category,
      path.basename(file),
      parseSourceDate(path.basename(file)),
      "Local source artifact inventory; binary retention not yet uploaded to Storage.",
      {
        local_path: relativePath,
        byte_size: stats.size,
        content_sha256: sha256,
        inventory_status: "storage_upload_pending",
      },
    ]
  );
  return inserted.rows[0].id;
}

async function recordPointerArtifact(
  client,
  sourceId,
  file,
  relativePath,
  stats,
  sha256
) {
  const exists = await client.query(
    `
      select id
      from brain.source_artifacts
      where source_id = $1
        and external_provider = 'local_filesystem'
        and external_id = $2
      limit 1
    `,
    [sourceId, relativePath]
  );
  if (exists.rows[0]) return { status: "unchanged", id: exists.rows[0].id };

  const inserted = await client.query(
    `
      insert into brain.source_artifacts (
        source_id,
        artifact_kind,
        external_provider,
        external_id,
        original_filename,
        mime_type,
        byte_size,
        content_sha256,
        retention_status,
        metadata
      )
      values (
        $1,
        'original',
        'local_filesystem',
        $2,
        $3,
        $4,
        $5,
        $6,
        'pointer_only',
        $7
      )
      returning id
    `,
    [
      sourceId,
      relativePath,
      path.basename(file),
      mimeTypeFor(file),
      stats.size,
      sha256,
      {
        local_path: relativePath,
        storage_upload_status: "pending",
      },
    ]
  );
  return { status: "inserted", id: inserted.rows[0].id };
}

const pool = new pg.Pool({ connectionString: databaseUrl });

try {
  const files = [];
  for (const rootConfig of inventoryRoots) {
    const rootFiles = await listFiles(rootConfig.root);
    for (const file of rootFiles) {
      const relativePath = path.relative(brainRoot, file).split(path.sep).join("/");
      const relativeToRoot = path.relative(rootConfig.root, file).split(path.sep).join("/");
      const firstSegment = relativeToRoot.split("/")[0];
      const category =
        rootConfig.categoryPrefix || (firstSegment === path.basename(file) ? "uncategorized" : firstSegment);
      files.push({ file, relativePath, category });
    }
  }

  const client = await pool.connect();
  let inserted = 0;
  let unchanged = 0;

  try {
    await client.query("begin");
    for (const item of files) {
      const stats = await fs.stat(item.file);
      const sha256 = await sha256File(item.file);
      const sourceId = await sourceIdFor(
        client,
        item.file,
        item.category,
        item.relativePath,
        stats,
        sha256
      );
      const result = await recordPointerArtifact(
        client,
        sourceId,
        item.file,
        item.relativePath,
        stats,
        sha256
      );
      if (result.status === "inserted") inserted += 1;
      else unchanged += 1;
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  const totalBytes = files.reduce((sum, item) => sum + item.file.length, 0);
  console.log(
    JSON.stringify(
      {
        inventoriedFiles: files.length,
        insertedArtifacts: inserted,
        unchangedArtifacts: unchanged,
        retentionStatus: "pointer_only",
        storageUploadStatus: "pending",
        note: "No binary bytes were uploaded in this step.",
      },
      null,
      2
    )
  );
} finally {
  await pool.end();
}
