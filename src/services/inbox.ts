import fs from "node:fs/promises";
import path from "node:path";
import { BRAIN_DIR, INBOX_DIR } from "../constants.js";

export interface InboxFile {
  name: string;
  size: number;
  modified: Date;
}

/**
 * Resolve the inbox directory path (sibling to brain/, like sources/).
 */
function getInboxPath(): string {
  return path.resolve(BRAIN_DIR, "..", INBOX_DIR);
}

/**
 * Scan the Brain inbox for pending files.
 * Creates the inbox directory if it doesn't exist.
 * Filters out hidden files, .gitkeep, and directories.
 * Returns files sorted by modified date (newest first).
 */
export async function scanInbox(): Promise<InboxFile[]> {
  const inboxPath = getInboxPath();

  // Create inbox dir if missing (no-op if exists)
  await fs.mkdir(inboxPath, { recursive: true });

  const entries = await fs.readdir(inboxPath, { withFileTypes: true });

  const files: InboxFile[] = [];
  for (const entry of entries) {
    // Skip directories, hidden files, and .gitkeep
    if (entry.isDirectory()) continue;
    if (entry.name.startsWith(".")) continue;
    if (entry.name === ".gitkeep") continue;

    const filePath = path.join(inboxPath, entry.name);
    const stat = await fs.stat(filePath);
    files.push({
      name: entry.name,
      size: stat.size,
      modified: stat.mtime,
    });
  }

  // Newest first
  files.sort((a, b) => b.modified.getTime() - a.modified.getTime());
  return files;
}
