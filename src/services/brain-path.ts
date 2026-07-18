/**
 * Sibling operator namespaces that are not part of the Markdown Brain vault.
 * Source ingestion, inbox processing, and sync state have their own bounded
 * workflows and must never be created through ordinary Brain file operations.
 */
const RESERVED_EXTERNAL_ROOTS = new Set(["sources", "inbox", ".brain-sync"]);

export function assertBrainVaultPath(filename: string): void {
  const portable = filename.replaceAll("\\", "/").replace(/^(\.\/)+/, "");
  const root = portable.split("/", 1)[0]?.toLowerCase();
  if (!root || !RESERVED_EXTERNAL_ROOTS.has(root)) return;
  throw new Error(
    `Reserved external Brain path: ${filename}. ${root}/ is not part of the Brain vault; use its dedicated source, inbox, or sync workflow.`
  );
}
