import fs from "node:fs/promises";
import path from "node:path";
import { LOG_FILE, type LogOpType } from "../constants.js";
import { brainDate } from "./date.js";
import { getBrainPaths } from "./registry.js";

const LOG_HEADER = `# Brain Change Log

Append-only record of ingests, updates, lint passes, and structural changes.
Format: \`## [YYYY-MM-DD] OP_TYPE | Summary\` followed by files touched.

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
    "",
    `## [${date}] ${opType} | ${summary}`,
    `Files: ${filesTouched.join(", ")}`,
    "",
  ].join("\n");

  await fs.appendFile(filePath, entry, "utf-8");
  return `Logged: [${date}] ${opType} | ${summary}`;
}

export async function readLog(
  limit: number = 20,
  brainId?: string
): Promise<string> {
  const filePath = await ensureLogFile(brainId);

  const content = await fs.readFile(filePath, "utf-8");
  const entries = content.split(/(?=^## \[)/m).filter((e) => e.startsWith("## ["));

  if (entries.length === 0) {
    return "No log entries yet.";
  }

  const recent = entries.slice(-limit);
  const header =
    entries.length > limit
      ? `Showing last ${limit} of ${entries.length} entries:\n\n`
      : "";

  return header + recent.join("\n").trim();
}

export async function getLastOpDate(
  opType: LogOpType,
  brainId?: string
): Promise<Date | null> {
  const filePath = await ensureLogFile(brainId);

  const content = await fs.readFile(filePath, "utf-8");
  const pattern = new RegExp(`^## \\[(\\d{4}-\\d{2}-\\d{2})\\] ${opType}`);

  // Log is append-only (newest at bottom) — scan from end, return first match
  const entries = content.split(/(?=^## \[)/m);
  for (let i = entries.length - 1; i >= 0; i--) {
    const match = entries[i].match(pattern);
    if (match) return new Date(match[1]);
  }

  return null;
}
