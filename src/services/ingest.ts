import { listFileNames } from "./brain.js";
import * as log from "./log.js";

export interface IngestAnalysis {
  sourceLabel: string;
  fileCount: number;
  files: string[];
  instructions: string;
}

/**
 * Analyze the current Brain file inventory for an ingest operation.
 * Returns the list of all Brain files so Claude can determine which
 * ones the source content touches and what changes to make.
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
    "### Next steps:",
    "- Use `brain_read_file` to read any files you expect the source touches",
    "- Use `brain_update_file` to make changes (get human approval first)",
    "- Use `brain_log` to record the ingest when complete",
    "- Run `brain_lint` after ingesting to check for inconsistencies",
  ].join("\n");

  return { sourceLabel, fileCount: files.length, files, instructions };
}

/**
 * Record a completed ingest in the log.
 */
export async function recordIngest(
  sourceLabel: string,
  filesTouched: string[]
): Promise<string> {
  await log.appendLog("INGEST", filesTouched, `Ingested: ${sourceLabel}`);
  return `Ingest logged: ${sourceLabel} (${filesTouched.length} files touched)`;
}
