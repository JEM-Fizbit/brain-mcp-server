import { z } from "zod";

export const ReadFileSchema = z.object({
  filename: z
    .string()
    .describe(
      'The filename to read (e.g., "01_identity.md"). Relative to BRAIN_DIR, no path traversal.'
    ),
});

export const UpdateFileSchema = z.object({
  filename: z
    .string()
    .describe("The filename to update. Must end in .md."),
  content: z
    .string()
    .describe("The new content to write to the file."),
  mode: z
    .enum(["replace", "append"])
    .describe('"replace" overwrites the file entirely. "append" adds to the end.'),
});

export const CommitSchema = z.object({
  message: z
    .string()
    .describe("The git commit message."),
  push: z
    .boolean()
    .default(false)
    .describe("Whether to push to remote after committing. Default: false."),
});

export const SearchSchema = z.object({
  query: z
    .string()
    .describe("Search term (case-insensitive substring match across all Brain files)."),
});

export const LogSchema = z.object({
  opType: z
    .enum(["INGEST", "UPDATE", "LINT", "CREATE", "SPLIT", "PRUNE"])
    .describe("The type of operation to log."),
  filesTouched: z
    .array(z.string())
    .describe("List of Brain files affected by this operation."),
  summary: z
    .string()
    .describe("Brief description of what was done."),
});

export const ReadLogSchema = z.object({
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .describe("Number of recent log entries to return. Default: 20."),
});

const sourceCategoryEnum = z.enum([
  "bios",
  "cv",
  "writing_samples",
  "photos",
  "articles",
  "meeting_notes",
  "correspondence",
  "other",
]);

export const IngestSchema = z.object({
  source_content: z
    .string()
    .describe("The text content of the source to ingest."),
  source_label: z
    .string()
    .describe("A short label (e.g. 'CV update April 2026', 'Board meeting notes')."),
  category: sourceCategoryEnum
    .describe("Source category — determines which subfolder in sources/ the file is saved to."),
  dry_run: z
    .boolean()
    .default(true)
    .describe("If true (default), returns analysis plan without saving. If false, saves the source file to sources/{category}/ and returns the saved file path."),
});

export const IngestCompleteSchema = z.object({
  source_label: z
    .string()
    .describe("Label of the source that was ingested."),
  category: sourceCategoryEnum
    .describe("Source category."),
  source_file: z
    .string()
    .describe("Path to the saved source file (returned by brain_ingest with dry_run=false)."),
  files_touched: z
    .array(z.string())
    .describe("Brain files that were updated from this source."),
});
