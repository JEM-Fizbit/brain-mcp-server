import fs from "node:fs/promises";
import path from "node:path";
import {
  BRAIN_DIR,
  SOURCES_DIR,
  SOURCES_INDEX,
  SOURCE_CATEGORIES,
  type SourceCategory,
} from "../constants.js";
import { listFileNames } from "./brain.js";
import * as log from "./log.js";

export interface IngestAnalysis {
  sourceLabel: string;
  fileCount: number;
  files: string[];
  categories: readonly string[];
  instructions: string;
}

function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

function formatDate(): string {
  return new Date().toISOString().split("T")[0];
}

/**
 * Analyze the current Brain file inventory for an ingest operation.
 * Returns the list of all Brain files and available source categories
 * so Claude can determine which files the source touches.
 */
export async function analyzeForIngest(
  sourceLabel: string
): Promise<IngestAnalysis> {
  const files = await listFileNames();

  const instructions = [
    `## Ingest Analysis: ${sourceLabel}`,
    "",
    "Review the source content against these Brain files and determine:",
    "1. Which existing files need updates (and what specifically to change)",
    "2. Whether any new files are needed (and what they should contain)",
    "3. Whether any facts contradict existing Brain content",
    "",
    "### Current Brain files:",
    "",
    ...files.map((f) => `- ${f}`),
    "",
    `### Source categories (for saving): ${SOURCE_CATEGORIES.join(", ")}`,
    "",
    "### Next steps:",
    "- Use `brain_read_file` to read any files you expect the source touches",
    "- Get human approval for proposed changes",
    "- Call `brain_ingest` with `dry_run=false` and a `category` to save the source",
    "- Use `brain_update_file` to make changes to Brain files",
    "- Call `brain_ingest_complete` to record provenance (which Brain files were updated)",
    "- Run `brain_lint` after ingesting to check for inconsistencies",
  ].join("\n");

  return {
    sourceLabel,
    fileCount: files.length,
    files,
    categories: SOURCE_CATEGORIES,
    instructions,
  };
}

/**
 * Read source content from a file path.
 * Validates the path exists and is readable.
 */
export async function readSourceFromPath(sourcePath: string): Promise<string> {
  try {
    return await fs.readFile(sourcePath, "utf-8");
  } catch {
    throw new Error(`Cannot read source file: ${sourcePath}`);
  }
}

/**
 * Resolve source content from either inline content or a file path.
 * Exactly one must be provided.
 */
export async function resolveSourceContent(
  sourceContent?: string,
  sourcePath?: string
): Promise<string> {
  if (sourceContent && sourcePath) {
    throw new Error(
      "Provide source_content OR source_path, not both."
    );
  }
  if (!sourceContent && !sourcePath) {
    throw new Error(
      "Provide either source_content (inline text) or source_path (path to file on disk)."
    );
  }
  if (sourcePath) {
    return readSourceFromPath(sourcePath);
  }
  return sourceContent!;
}

/**
 * Save a source file to the sources/ directory under the given category.
 * Creates the category subfolder if it doesn't exist.
 * Returns the relative path to the saved file.
 */
export async function saveSource(
  sourceContent: string,
  sourceLabel: string,
  category: SourceCategory
): Promise<string> {
  const sourcesPath = path.resolve(BRAIN_DIR, "..", SOURCES_DIR);
  const categoryPath = path.join(sourcesPath, category);

  // Create category subfolder if needed
  await fs.mkdir(categoryPath, { recursive: true });

  const filename = `${formatDate()}_${slugify(sourceLabel)}.md`;
  const filePath = path.join(categoryPath, filename);
  const relativePath = path.join(SOURCES_DIR, category, filename);

  await fs.writeFile(filePath, sourceContent, "utf-8");

  return relativePath;
}

/**
 * Record a completed ingest: append to LOG.md and SOURCES.md index.
 */
export async function recordIngest(
  sourceLabel: string,
  category: SourceCategory,
  sourceFile: string,
  filesTouched: string[]
): Promise<string> {
  // Append to LOG.md
  await log.appendLog(
    "INGEST",
    filesTouched,
    `Ingested: ${sourceLabel} (${category})`
  );

  // Append row to SOURCES.md
  const indexPath = path.join(BRAIN_DIR, SOURCES_INDEX);
  const row = `| ${formatDate()} | ${sourceLabel} | ${category} | \`${sourceFile}\` | ${filesTouched.map((f) => `\`${f}\``).join(", ")} |`;

  try {
    const content = await fs.readFile(indexPath, "utf-8");
    // Append after the table header (find the last |...| line or the header separator)
    const updatedContent = content.trimEnd() + "\n" + row + "\n";
    await fs.writeFile(indexPath, updatedContent, "utf-8");
  } catch {
    // SOURCES.md doesn't exist — shouldn't happen but handle gracefully
    const header = [
      "# Source Index",
      "",
      "Registry of all primary sources ingested into the Brain.",
      "Each entry links a source file to the Brain files it informed.",
      "",
      "| Date | Label | Category | File | Brain files touched |",
      "|------|-------|----------|------|-------------------|",
      row,
      "",
    ].join("\n");
    await fs.writeFile(indexPath, header, "utf-8");
  }

  return `Ingest recorded: ${sourceLabel} → ${sourceFile} (${filesTouched.length} Brain files touched)`;
}
