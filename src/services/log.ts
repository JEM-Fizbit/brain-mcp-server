import fs from "node:fs/promises";
import path from "node:path";
import { LOG_FILE, type LogOpType } from "../constants.js";
import { brainDate } from "./date.js";
import { getBrainPaths } from "./registry.js";

export const LOG_HEADER = `# Brain Change Log

Append-only record of ingests, updates, lint passes, and structural changes.
Format: \`## [YYYY-MM-DD] OP_TYPE | Summary\` followed by files touched.
Ordering: newest entry first; insert new entries directly below this preamble.

---
`;

export function formatLogEntry(
  opType: LogOpType,
  filesTouched: string[],
  summary: string,
  date = brainDate()
): string {
  return [
    `## [${date}] ${opType} | ${summary}`,
    `Files: ${filesTouched.join(", ")}`,
    "",
  ].join("\n");
}

export function appendLogEntryToContent(content: string, entry: string): string {
  const base = content.trim().length > 0 ? content : LOG_HEADER;
  const divider = "\n---\n";
  const dividerIndex = base.indexOf(divider);

  if (dividerIndex === -1) {
    const firstEntryMatch = firstRecognizedEntryMatch(base);
    if (firstEntryMatch?.index !== undefined) {
      const prefix = base.slice(0, firstEntryMatch.index).trimEnd();
      const rest = base.slice(firstEntryMatch.index).trimStart();
      return `${prefix}\n\n${entry}\n${rest}`.trimEnd() + "\n";
    }
    return `${entry}\n${base}`.trimEnd() + "\n";
  }

  const insertAt = dividerIndex + divider.length;
  const prefix = base.slice(0, insertAt);
  const rest = base.slice(insertAt).trimStart();
  return rest ? `${prefix}\n${entry}\n${rest}` : `${prefix}\n${entry}`;
}

function isStandardEntryStart(line: string): boolean {
  return /^## \[\d{4}-\d{2}-\d{2}\]/.test(line);
}

function isLegacyEntryStart(line: string): boolean {
  return /^\s*-?\s*\d{4}-\d{2}-\d{2}\s+—/.test(line);
}

function firstRecognizedEntryMatch(content: string): RegExpExecArray | null {
  const matches = [
    /^## \[\d{4}-\d{2}-\d{2}\]/m.exec(content),
    /^\s*-?\s*\d{4}-\d{2}-\d{2}\s+—/m.exec(content),
  ].filter((match): match is RegExpExecArray => Boolean(match));

  return matches.sort((a, b) => a.index - b.index)[0] || null;
}

function isRootHeading(line: string): boolean {
  return /^#(?!#)/.test(line);
}

function parseLogEntries(content: string): string[] {
  const entries: string[] = [];
  let current: string[] = [];
  let currentIsStandard = false;

  const flush = (): void => {
    const entry = current.join("\n").trim();
    if (entry) entries.push(entry);
    current = [];
    currentIsStandard = false;
  };

  for (const line of content.split("\n")) {
    if (isStandardEntryStart(line)) {
      flush();
      current = [line];
      currentIsStandard = true;
      continue;
    }

    if (isLegacyEntryStart(line)) {
      flush();
      current = [line.trim()];
      flush();
      continue;
    }

    if (currentIsStandard && isRootHeading(line)) {
      flush();
      continue;
    }

    if (currentIsStandard) {
      current.push(line);
    }
  }

  flush();
  return entries;
}

export function readLogContent(
  content: string,
  limit: number = 20,
  offset: number = 0
): string {
  const entries = parseLogEntries(content);

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
  const entry = formatLogEntry(opType, filesTouched, summary, date);

  const content = await fs.readFile(filePath, "utf-8");
  await fs.writeFile(filePath, appendLogEntryToContent(content, entry), "utf-8");

  return `Logged: [${date}] ${opType} | ${summary}`;
}

export async function readLog(
  limit: number = 20,
  brainId?: string,
  offset: number = 0
): Promise<string> {
  const filePath = await ensureLogFile(brainId);

  const content = await fs.readFile(filePath, "utf-8");
  return readLogContent(content, limit, offset);
}

/**
 * Parse the most recent entry of a given op type out of LOG.md content.
 *
 * Split out from getLastOpDate so the hosted path can run the same parse over
 * content read through the active Brain store, which has no host filesystem.
 */
export function parseLastOpDate(
  content: string,
  opType: LogOpType
): Date | null {
  const pattern = new RegExp(`^## \\[(\\d{4}-\\d{2}-\\d{2})\\] ${opType}`);

  // Log is newest-first — scan from top, return first match.
  const entries = content.split(/(?=^## \[)/m);
  for (const entry of entries) {
    const match = entry.match(pattern);
    if (match) return new Date(match[1]);
  }

  return null;
}

export async function getLastOpDate(
  opType: LogOpType,
  brainId?: string
): Promise<Date | null> {
  const filePath = await ensureLogFile(brainId);
  const content = await fs.readFile(filePath, "utf-8");
  return parseLastOpDate(content, opType);
}
