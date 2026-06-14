import fs from "node:fs/promises";
import path from "node:path";
import { LOG_FILE, type LogOpType } from "../constants.js";
import { brainDate } from "./date.js";
import { getBrainPaths } from "./registry.js";

const LOG_HEADER = `# Brain Change Log

Append-only record of ingests, updates, lint passes, and structural changes.
Format: \`## [YYYY-MM-DD] OP_TYPE | Summary\` followed by files touched.
Ordering: newest entry first; insert new entries directly below this preamble.

---
`;

async function logPath(brainId?: string): Promise<string> {
  const { brainDir } = await getBrainPaths(brainId);
  return path.join(brainDir, LOG_FILE);
}

async function ensureLogFile(brainId?: string): Promise<string> {
  const filePath = await logPath(brainId);
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, LOG_HEADER, "utf-8");
  }
  return filePath;
}

export async function appendLog(
  opType: LogOpType,
  filesTouched: string[],
  summary: string,
  brainId?: string
): Promise<string> {
  const filePath = await ensureLogFile(brainId);
  const date = brainDate();

  const entry = [
    `## [${date}] ${opType} | ${summary}`,
    `Files: ${filesTouched.join(", ")}`,
    "",
  ].join("\n");

  const content = await fs.readFile(filePath, "utf-8");
  const divider = "\n---\n";
  const dividerIndex = content.indexOf(divider);

  if (dividerIndex === -1) {
    await fs.writeFile(filePath, `${entry}\n${content}`.trimEnd() + "\n", "utf-8");
  } else {
    const insertAt = dividerIndex + divider.length;
    const prefix = content.slice(0, insertAt);
    const rest = content.slice(insertAt).trimStart();
    const next = rest ? `${prefix}\n${entry}\n${rest}` : `${prefix}\n${entry}`;
    await fs.writeFile(filePath, next, "utf-8");
  }

  return `Logged: [${date}] ${opType} | ${summary}`;
}

export async function readLog(
  limit: number = 20,
  brainId?: string,
  offset: number = 0
): Promise<string> {
  const filePath = await ensureLogFile(brainId);

  const content = await fs.readFile(filePath, "utf-8");
  const entries = content.split(/(?=^## \[)/m).filter((e) => e.startsWith("## ["));

  if (entries.length === 0) {
    return "No log entries yet.";
  }

  const start = Math.max(0, offset);
  const recent = entries.slice(start, start + limit);

  if (recent.length === 0) {
    return `No log entries at offset ${start}. Total entries: ${entries.length}.`;
  }

  const end = start + recent.length;
  let header = "";
  if (entries.length > limit || start > 0) {
    header =
      start === 0
        ? `Showing newest ${recent.length} of ${entries.length} entries:\n\n`
        : `Showing entries ${start + 1}-${end} of ${entries.length} (newest first):\n\n`;
  }

  return header + recent.join("\n").trim();
}

export async function getLastOpDate(
  opType: LogOpType,
  brainId?: string
): Promise<Date | null> {
  const filePath = await ensureLogFile(brainId);

  const content = await fs.readFile(filePath, "utf-8");
  const pattern = new RegExp(`^## \\[(\\d{4}-\\d{2}-\\d{2})\\] ${opType}`);

  // Log is newest-first — scan from top, return first match.
  const entries = content.split(/(?=^## \[)/m);
  for (const entry of entries) {
    const match = entry.match(pattern);
    if (match) return new Date(match[1]);
  }

  return null;
}
