import fs from "node:fs/promises";
import path from "node:path";
import { BRAIN_DIR, LOG_FILE, type LogOpType } from "../constants.js";

const LOG_PATH = path.join(BRAIN_DIR, LOG_FILE);

const LOG_HEADER = `# Brain Change Log

Append-only record of ingests, updates, lint passes, and structural changes.
Format: \`## [YYYY-MM-DD] OP_TYPE | Summary\` followed by files touched.

---
`;

async function ensureLogFile(): Promise<void> {
  try {
    await fs.access(LOG_PATH);
  } catch {
    await fs.writeFile(LOG_PATH, LOG_HEADER, "utf-8");
  }
}

function formatDate(): string {
  return new Date().toISOString().split("T")[0];
}

export async function appendLog(
  opType: LogOpType,
  filesTouched: string[],
  summary: string
): Promise<string> {
  await ensureLogFile();

  const entry = [
    "",
    `## [${formatDate()}] ${opType} | ${summary}`,
    `Files: ${filesTouched.join(", ")}`,
    "",
  ].join("\n");

  await fs.appendFile(LOG_PATH, entry, "utf-8");
  return `Logged: [${formatDate()}] ${opType} | ${summary}`;
}

export async function readLog(limit: number = 20): Promise<string> {
  await ensureLogFile();

  const content = await fs.readFile(LOG_PATH, "utf-8");
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
  opType: LogOpType
): Promise<Date | null> {
  await ensureLogFile();

  const content = await fs.readFile(LOG_PATH, "utf-8");
  const pattern = new RegExp(
    `^## \\[(\\d{4}-\\d{2}-\\d{2})\\] ${opType}`,
    "gm"
  );

  let lastDate: string | null = null;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    lastDate = match[1];
  }

  return lastDate ? new Date(lastDate) : null;
}
