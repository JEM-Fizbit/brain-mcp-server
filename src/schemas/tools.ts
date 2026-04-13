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
    .enum(["replace", "append", "patch"])
    .describe('"replace" overwrites the file entirely. "append" adds to the end. "patch" does find-and-replace: content is the new text, old_content is the text to find and replace.'),
  old_content: z
    .string()
    .optional()
    .describe("Required for patch mode. The exact text to find and replace. Must match uniquely in the file."),
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
  "career_history",
  "assessments",
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
    .optional()
    .describe("Short text only (under 500 words). For larger content, save to sources/ via Desktop Commander and omit this."),
  source_path: z
    .string()
    .optional()
    .describe("Absolute path to a file on disk. Server reads it directly."),
  source_label: z
    .string()
    .describe("A short label (e.g. 'CV update April 2026', 'Board meeting notes')."),
  category: sourceCategoryEnum
    .describe("Source category — determines which subfolder in sources/ the file is saved to."),
  dry_run: z
    .boolean()
    .default(true)
    .describe("If true (default), returns analysis plan — no content needed, you already read the document. If false, saves source .md (requires source_content or source_path)."),
});

export const ScanInboxSchema = z.object({});

export const IngestCompleteSchema = z.object({
  source_label: z
    .string()
    .describe("Label of the source that was ingested."),
  category: sourceCategoryEnum
    .describe("Source category."),
  original_file: z
    .string()
    .optional()
    .describe("Path to original format file in sources/ (e.g. .docx, .pdf). Omit if source was plain text."),
  md_file: z
    .string()
    .describe("Path to the markdown version in sources/."),
  files_touched: z
    .array(z.string())
    .describe("Brain files that were updated from this source."),
  inbox_file: z
    .string()
    .optional()
    .describe("Filename of the original inbox file to delete after ingestion (e.g. 'My Document.pdf'). Relative to inbox/ directory. If provided, the file is deleted from the inbox after provenance is recorded."),
});
