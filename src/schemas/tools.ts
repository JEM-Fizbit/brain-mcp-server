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
