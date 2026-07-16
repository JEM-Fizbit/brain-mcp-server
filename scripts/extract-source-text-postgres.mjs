import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import pg from "pg";
import { loadLocalEnv } from "./lib/load-local-env.mjs";

loadLocalEnv();

const execFileAsync = promisify(execFile);
const databaseUrl = process.env.BRAIN_REVISION_DATABASE_URL;
const brainId = process.env.BRAIN_ID || "ai-brain-jem";
const brainRoot = process.env.BRAIN_REPO_ROOT;
const limit = process.env.BRAIN_SOURCE_TEXT_LIMIT
  ? Number(process.env.BRAIN_SOURCE_TEXT_LIMIT)
  : null;

if (!databaseUrl) {
  console.error(
    "BRAIN_REVISION_DATABASE_URL is missing. Set it before extracting source text."
  );
  process.exit(2);
}

if (!brainRoot) {
  console.error("BRAIN_REPO_ROOT is missing. Set it to the Brain repository root before extracting source text.");
  process.exit(2);
}

const textExtensions = new Set([
  ".csv",
  ".html",
  ".json",
  ".log",
  ".md",
  ".markdown",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);

function sha256Text(content) {
  return createHash("sha256").update(content).digest("hex");
}

function normalizeExtractedText(content) {
  return content.replace(/\u0000/g, "").trim();
}

function isTextLike(row) {
  const ext = path.extname(row.original_filename || row.external_id || "").toLowerCase();
  if (textExtensions.has(ext)) return true;
  return String(row.mime_type || "").startsWith("text/");
}

function isPdf(row) {
  const ext = path.extname(row.original_filename || row.external_id || "").toLowerCase();
  return ext === ".pdf" || row.mime_type === "application/pdf";
}

async function extractText(row, filePath) {
  if (isTextLike(row)) {
    return {
      textFormat: "plain_text",
      content: normalizeExtractedText(await fs.readFile(filePath, "utf8")),
    };
  }

  if (isPdf(row)) {
    const { stdout } = await execFileAsync("pdftotext", ["-layout", filePath, "-"], {
      maxBuffer: 32 * 1024 * 1024,
    });
    return {
      textFormat: "plain_text",
      content: normalizeExtractedText(stdout),
    };
  }

  return null;
}

async function pendingArtifacts(pool) {
  const result = await pool.query(
    `
      select
        a.id,
        a.original_filename,
        a.mime_type,
        a.external_id,
        a.metadata
      from brain.source_artifacts a
      join brain.sources s on s.id = a.source_id
      left join brain.source_artifact_text t on t.artifact_id = a.id
      where s.brain_id = $1
        and a.artifact_kind = 'original'
        and a.external_provider = 'local_filesystem'
        and a.external_id is not null
        and t.artifact_id is null
      order by a.created_at, a.id
    `,
    [brainId]
  );
  return limit ? result.rows.slice(0, limit) : result.rows;
}

async function recordExtractedText(pool, row, extracted) {
  await pool.query(
    `
      insert into brain.source_artifact_text (
        artifact_id,
        text_format,
        content,
        content_sha256,
        language
      )
      values ($1, $2, $3, $4, null)
      on conflict (artifact_id) do update
      set text_format = excluded.text_format,
          content = excluded.content,
          content_sha256 = excluded.content_sha256,
          language = excluded.language,
          created_at = now()
    `,
    [
      row.id,
      extracted.textFormat,
      extracted.content,
      sha256Text(extracted.content),
    ]
  );
}

async function markArtifact(pool, row, status, details = {}) {
  await pool.query(
    `
      update brain.source_artifacts
      set metadata = metadata || $2::jsonb
      where id = $1
    `,
    [
      row.id,
      JSON.stringify({
        text_extraction_status: status,
        text_extraction_checked_at: new Date().toISOString(),
        ...details,
      }),
    ]
  );
}

const pool = new pg.Pool({ connectionString: databaseUrl });

try {
  const rows = await pendingArtifacts(pool);
  let extracted = 0;
  let skippedUnsupported = 0;
  let skippedMissing = 0;
  let skippedEmpty = 0;
  let failed = 0;

  console.log(`[source-text] Checking ${rows.length} source artifacts for text extraction`);
  for (const row of rows) {
    const filePath = path.join(brainRoot, row.external_id);
    const exists = await fs
      .access(filePath)
      .then(() => true)
      .catch(() => false);
    if (!exists) {
      skippedMissing += 1;
      await markArtifact(pool, row, "missing_local_file");
      continue;
    }

    if (!isTextLike(row) && !isPdf(row)) {
      skippedUnsupported += 1;
      await markArtifact(pool, row, "unsupported_mime_type", {
        mime_type: row.mime_type || null,
      });
      continue;
    }

    try {
      const result = await extractText(row, filePath);
      if (!result || !result.content) {
        skippedEmpty += 1;
        await markArtifact(pool, row, "empty_text");
        continue;
      }
      await recordExtractedText(pool, row, result);
      await markArtifact(pool, row, "extracted", {
        text_format: result.textFormat,
        text_sha256: sha256Text(result.content),
      });
      extracted += 1;
    } catch (error) {
      failed += 1;
      await markArtifact(pool, row, "failed", {
        error: error instanceof Error ? error.message.slice(0, 500) : String(error),
      });
    }
  }

  console.log(
    JSON.stringify(
      {
        checked: rows.length,
        extracted,
        skippedUnsupported,
        skippedMissing,
        skippedEmpty,
        failed,
      },
      null,
      2
    )
  );
  if (failed > 0) process.exitCode = 1;
} finally {
  await pool.end();
}
