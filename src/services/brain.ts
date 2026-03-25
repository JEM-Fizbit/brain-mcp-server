import fs from "node:fs/promises";
import path from "node:path";
import {
  BRAIN_DIR,
  LOADER_FILE,
  NOW_FILE,
  STALENESS,
  ACTIVE_PATTERNS,
  IDENTITY_PATTERNS,
  MAX_SEARCH_RESULTS,
} from "../constants.js";

export interface BrainFile {
  name: string;
  lines: number;
  bytes: number;
  lastModified: Date;
  staleDays: number | null;
}

function validateFilename(filename: string): void {
  if (path.isAbsolute(filename)) {
    throw new Error("Absolute paths are not allowed");
  }
  if (filename.includes("..")) {
    throw new Error("Path traversal (..) is not allowed");
  }
  if (!filename.endsWith(".md")) {
    throw new Error("Only .md files are supported");
  }
}

function resolveFilePath(filename: string): string {
  validateFilename(filename);
  const resolved = path.resolve(BRAIN_DIR, filename);
  if (!resolved.startsWith(path.resolve(BRAIN_DIR))) {
    throw new Error("Path traversal detected");
  }
  return resolved;
}

export async function loadContext(): Promise<string> {
  const loaderPath = path.join(BRAIN_DIR, LOADER_FILE);
  const nowPath = path.join(BRAIN_DIR, NOW_FILE);

  const [loader, now] = await Promise.all([
    fs.readFile(loaderPath, "utf-8").catch(() => null),
    fs.readFile(nowPath, "utf-8").catch(() => null),
  ]);

  if (!loader || !now) {
    const missing = [];
    if (!loader) missing.push(LOADER_FILE);
    if (!now) missing.push(NOW_FILE);
    throw new Error(
      `Missing required Brain files: ${missing.join(", ")}. ` +
        `Ensure BRAIN_DIR (${BRAIN_DIR}) contains these files.`
    );
  }

  return [
    `--- FILE: ${LOADER_FILE} ---`,
    loader.trim(),
    "",
    `--- FILE: ${NOW_FILE} ---`,
    now.trim(),
  ].join("\n");
}

export async function readFile(filename: string): Promise<string> {
  const filePath = resolveFilePath(filename);

  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    const available = await listFileNames();
    throw new Error(
      `File not found: ${filename}. Available files:\n${available.join("\n")}`
    );
  }
}

export async function updateFile(
  filename: string,
  content: string,
  mode: "replace" | "append"
): Promise<string> {
  const filePath = resolveFilePath(filename);

  if (mode === "append") {
    const existing = await fs.readFile(filePath, "utf-8").catch(() => "");
    const separator = existing.endsWith("\n") ? "" : "\n";
    await fs.writeFile(filePath, existing + separator + content, "utf-8");
  } else {
    await fs.writeFile(filePath, content, "utf-8");
  }

  const stat = await fs.stat(filePath);
  const lines = content.split("\n").length;
  return `Updated ${filename}: ${lines} lines, ${stat.size} bytes`;
}

async function listFileNames(): Promise<string[]> {
  const entries = await fs.readdir(BRAIN_DIR, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(entry.name);
    }
    if (entry.isDirectory()) {
      const subPath = path.join(BRAIN_DIR, entry.name);
      const subEntries = await fs.readdir(subPath, { withFileTypes: true });
      for (const sub of subEntries) {
        if (sub.isFile() && sub.name.endsWith(".md")) {
          files.push(path.join(entry.name, sub.name));
        }
      }
    }
  }

  return files.sort();
}

function getStalenessThreshold(filename: string): number {
  const base = path.basename(filename);
  if (base === NOW_FILE) return STALENESS.NOW;
  if (ACTIVE_PATTERNS.some((p) => p.test(base))) return STALENESS.ACTIVE;
  if (IDENTITY_PATTERNS.some((p) => p.test(base))) return STALENESS.IDENTITY;
  return STALENESS.DEFAULT;
}

export async function listFiles(): Promise<BrainFile[]> {
  const fileNames = await listFileNames();
  const now = Date.now();

  const results = await Promise.all(
    fileNames.map(async (name) => {
      const filePath = path.join(BRAIN_DIR, name);
      const [stat, content] = await Promise.all([
        fs.stat(filePath),
        fs.readFile(filePath, "utf-8"),
      ]);

      const daysSinceModified = Math.floor(
        (now - stat.mtimeMs) / (1000 * 60 * 60 * 24)
      );
      const threshold = getStalenessThreshold(name);
      const staleDays =
        daysSinceModified > threshold ? daysSinceModified : null;

      return {
        name,
        lines: content.split("\n").length,
        bytes: stat.size,
        lastModified: stat.mtime,
        staleDays,
      };
    })
  );

  return results;
}

export async function search(query: string): Promise<string> {
  const fileNames = await listFileNames();
  const lowerQuery = query.toLowerCase();
  const matches: string[] = [];

  for (const name of fileNames) {
    if (matches.length >= MAX_SEARCH_RESULTS) break;

    const filePath = path.join(BRAIN_DIR, name);
    const content = await fs.readFile(filePath, "utf-8");
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      if (matches.length >= MAX_SEARCH_RESULTS) break;
      if (lines[i].toLowerCase().includes(lowerQuery)) {
        matches.push(`${name}:${i + 1}: ${lines[i].trim()}`);
      }
    }
  }

  const result = matches.join("\n");
  const truncated =
    matches.length >= MAX_SEARCH_RESULTS
      ? `\n\n(Results truncated at ${MAX_SEARCH_RESULTS} matches)`
      : "";

  return matches.length > 0
    ? `Found ${matches.length} matches for "${query}":\n\n${result}${truncated}`
    : `No matches found for "${query}"`;
}
