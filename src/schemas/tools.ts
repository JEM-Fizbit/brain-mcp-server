import { z } from "zod";

export const BrainIdSchema = z.object({
  brain_id: z
    .string()
    .regex(/^[a-z][a-z0-9-]{1,62}$/)
    .optional()
    .describe(
      "Brain identifier. Optional when you have access to exactly one Brain."
    ),
});

export const LoadContextSchema = BrainIdSchema;
export const ListFilesSchema = BrainIdSchema;
export const LintSchema = BrainIdSchema.extend({
  fix: z
    .boolean()
    .optional()
    .describe(
      "When true, apply the remaining ordinary-content mechanical fixes after reporting: relocate completed [x] tasks into Done (stamped with today's date) and archive Done items stamped more than 30 days ago into archive/tasks-done.md. Lint never auto-edits 00_loader.md or NOW.md. Writes are revision-tracked. Defaults to false (read-only report)."
    ),
  dry_run: z
    .boolean()
    .optional()
    .describe(
      "Only meaningful with fix=true. When true, compute and return the planned fixes without writing anything. Used by the operator confirm step."
    ),
});
export const ScanInboxSchema = BrainIdSchema;
export const ListBrainsSchema = z.object({});
export const DescribeBrainSchema = BrainIdSchema.extend({
  brain_id: z
    .string()
    .regex(/^[a-z][a-z0-9-]{1,62}$/)
    .describe("Brain identifier to describe."),
});

export const ReadFileSchema = BrainIdSchema.extend({
  filename: z
    .string()
    .describe(
      'The filename to read. For scope="brain" (default): relative to BRAIN_DIR (e.g., "01_identity.md", "Reference_ERS_Brain_Context/00_load_first.md"). For scope="sources": relative to SOURCES_ROOT (e.g., "bios/2026-04-15_kruk_trustee_bio.md"). No path traversal.'
    ),
  scope: z
    .enum(["brain", "sources"])
    .default("brain")
    .describe(
      'Where to read from. "brain" (default) reads from the Brain vault. "sources" returns the full stored text for an exact reviewed Markdown source companion when available — e.g., the KRUK bio, a meeting transcript, or an assessment conversion. A binary or pointer-only path returns source/artifact metadata; it never returns original binary bytes or creates a signed URL.'
    ),
});

export const UpdateFileSchema = BrainIdSchema.extend({
  filename: z
    .string()
    .describe("The Brain-vault filename to update. Must end in .md. External namespaces sources/, inbox/, and .brain-sync/ are reserved for their dedicated workflows. Hosted writes to 00_loader.md or NOW.md require owner/admin role."),
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

export const DeleteFileSchema = BrainIdSchema.extend({
  filename: z
    .string()
    .describe(
      "The Brain-vault file to delete (must end in .md; external namespaces are reserved). Soft-delete: recoverable via brain_restore_file. The structural files 00_loader.md and NOW.md cannot be deleted."
    ),
});

export const RenameFileSchema = BrainIdSchema.extend({
  from: z.string().describe("The current Brain-vault filename (must end in .md; external namespaces are reserved)."),
  to: z
    .string()
    .describe("The new Brain-vault filename (must end in .md; must not already exist as a live file; external namespaces are reserved)."),
});

export const RestoreFileSchema = BrainIdSchema.extend({
  filename: z
    .string()
    .describe("A previously-deleted Brain-vault file to restore to its last content (hosted Brain only; external namespaces are reserved)."),
});

export const CommitSchema = BrainIdSchema.extend({
  message: z
    .string()
    .describe("The git commit message."),
  push: z
    .boolean()
    .default(false)
    .describe("Whether to push to remote after committing. Default: false."),
});

export const SearchSchema = BrainIdSchema.extend({
  query: z
    .string()
    .describe(
      "Search term. Exact case-insensitive matches are preferred; normalized fallback handles common spacing, punctuation, camel-case, and lookup-phrase variants."
    ),
  scope: z
    .enum(["brain", "sources", "all"])
    .default("brain")
    .describe(
      'Where to search. "brain" (default) searches Brain files only — fast, focused on summarised knowledge. "sources" searches the sources/ archive (original ingested documents: bios, assessments, meeting notes, writing samples, correspondence, etc.). "all" searches both. Escalate to "sources" or "all" when the query concerns specific documents, past correspondence, assessment details, or when brain_search returns no matches on something you expect to exist.'
    ),
  max_results: z
    .number()
    .int()
    .min(1)
    .max(500)
    .default(50)
    .describe(
      "Maximum number of matches to return. Default 50, ceiling 500. Raise when a default search hits the truncation footer and you need more coverage."
    ),
  include_operational: z
    .boolean()
    .default(false)
    .describe(
      "Include operational/history paths (LOG.md, JOURNAL.md, archive/**, working/**). Defaults to false so ranked knowledge search is not dominated by history."
    ),
});

export const SemanticIndexSchema = BrainIdSchema;

export const SemanticSearchSchema = BrainIdSchema.extend({
  query: z.string().describe("Semantic search query."),
  top_k: z
    .number()
    .int()
    .min(1)
    .max(20)
    .default(5)
    .describe("Number of semantic matches to return. Default 5, ceiling 20."),
});

export const ListSourcesSchema = BrainIdSchema.extend({
  category: z
    .string()
    .optional()
    .describe("Optional category to filter by. If omitted, returns all source files across all categories."),
});

export const SyncStatusSchema = BrainIdSchema;

export const ListConflictsSchema = BrainIdSchema.extend({
  status: z
    .enum(["open", "resolved", "superseded"])
    .default("open")
    .describe("Conflict status to list. Defaults to open."),
});

export const ResolveConflictSchema = BrainIdSchema.extend({
  conflict_id: z
    .string()
    .min(1)
    .describe("The sync conflict id returned by brain_list_conflicts."),
  content: z
    .string()
    .min(1)
    .describe(
      "The reviewed replacement Markdown content to write as the conflict resolution."
    ),
});

export const LogSchema = BrainIdSchema.extend({
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

export const ReadLogSchema = BrainIdSchema.extend({
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .describe("Number of log entries to return from the newest-first stream. Default: 20. Maximum: 100 per page."),
  offset: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe("Number of newest-first log entries to skip before returning results. Use with limit for pagination. Default: 0."),
});

export const CaptureItemSchema = BrainIdSchema.extend({
  kind: z
    .enum([
      "bug",
      "feature",
      "observation",
      "investigation",
      "follow_up",
      "idea",
      "question",
      "reminder",
      "note",
      "routing",
    ])
    .describe("Type of conversationally captured item to triage."),
  title: z
    .string()
    .min(1)
    .describe("Short human-scannable title for the capture item."),
  source: z
    .string()
    .optional()
    .describe("Where the item was reported, e.g. ChatGPT mobile or Claude web."),
  route_hint: z
    .string()
    .optional()
    .describe("Likely onward destination or owning area after triage."),
  target: z
    .string()
    .optional()
    .describe("Compatibility alias for route_hint."),
  details: z
    .string()
    .optional()
    .describe("Brief metadata-only detail. Do not include secrets or long Brain/file content."),
  urgency: z
    .enum(["low", "normal", "high"])
    .default("normal")
    .describe("Triage urgency. Default: normal."),
});

export const ReportItemSchema = CaptureItemSchema;

const sourceCategory = z.string();

export const IngestSchema = BrainIdSchema.extend({
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
  category: sourceCategory
    .describe("Source category — determines which subfolder in sources/ the file is saved to."),
  dry_run: z
    .boolean()
    .default(true)
    .describe("If true (default), returns analysis plan — no content needed, you already read the document. If false, saves source .md (requires source_content or source_path)."),
});

export const IngestCompleteSchema = BrainIdSchema.extend({
  source_label: z
    .string()
    .describe("Label of the source that was ingested."),
  category: sourceCategory
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
