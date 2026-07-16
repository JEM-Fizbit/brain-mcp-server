import fs from "node:fs/promises";
import path from "node:path";
import { lineMatchesSearchQuery } from "../search-match.js";
import {
  LOADER_FILE,
  NOW_FILE,
  STALENESS,
  ACTIVE_PATTERNS,
  IDENTITY_PATTERNS,
  MAX_SEARCH_RESULTS,
  MAX_SEARCH_RESULTS_CEILING,
  SEARCH_LINE_CHAR_LIMIT,
  SEARCH_TOTAL_CHAR_LIMIT,
  LINT_NUDGE_DAYS,
  type SourceCategory,
} from "../constants.js";
import * as log from "./log.js";
import { getOpenMaintenanceIssues, type OpenIssue } from "./issues.js";
import { scanInbox } from "./inbox.js";
import { getBrainPaths } from "./registry.js";

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

function resolveFilePath(root: string, filename: string): string {
  validateFilename(filename);
  const resolved = path.resolve(root, filename);
  if (!resolved.startsWith(path.resolve(root))) {
    throw new Error("Path traversal detected");
  }
  return resolved;
}

function resolveSourcePath(root: string, filename: string): string {
  validateFilename(filename);
  const resolved = path.resolve(root, filename);
  if (!resolved.startsWith(path.resolve(root))) {
    throw new Error("Path traversal detected");
  }
  return resolved;
}

export type ReadScope = "brain" | "sources";
export type SearchScope = "brain" | "sources" | "all";

async function listSourceFileNames(
  category?: SourceCategory,
  brainId?: string
): Promise<string[]> {
  const files: string[] = [];
  const { sourcesRoot } = await getBrainPaths(brainId);
  try {
    const rootEntries = await fs.readdir(sourcesRoot, { withFileTypes: true });
    for (const entry of rootEntries) {
      if (!entry.isDirectory()) continue;
      if (category && entry.name !== category) continue;
      const subPath = path.join(sourcesRoot, entry.name);
      const subEntries = await fs.readdir(subPath, { withFileTypes: true });
      for (const sub of subEntries) {
        if (sub.isFile() && sub.name.endsWith(".md")) {
          files.push(path.join(entry.name, sub.name));
        }
      }
    }
  } catch {
    // SOURCES_ROOT may not exist; return empty
  }
  return files.sort();
}

export async function listSources(
  category?: SourceCategory,
  brainId?: string
): Promise<string[]> {
  return listSourceFileNames(category, brainId);
}

export async function loadContext(brainId?: string): Promise<string> {
  const { brainDir } = await getBrainPaths(brainId);
  const loaderPath = path.join(brainDir, LOADER_FILE);
  const nowPath = path.join(brainDir, NOW_FILE);

  // Fetch everything in parallel: core files + nudge data
  const [loader, now, lastLint, issues, inboxFiles] = await Promise.all([
    fs.readFile(loaderPath, "utf-8").catch(() => null),
    fs.readFile(nowPath, "utf-8").catch(() => null),
    log.getLastOpDate("LINT", brainId).catch((): null => null),
    getOpenMaintenanceIssues().catch((): OpenIssue[] => []),
    scanInbox(brainId).catch((): [] => []),
  ]);

  if (!loader || !now) {
    const missing = [];
    if (!loader) missing.push(LOADER_FILE);
    if (!now) missing.push(NOW_FILE);
    throw new Error(
      `Missing required Brain files: ${missing.join(", ")}. ` +
        `Ensure Brain directory (${brainDir}) contains these files.`
    );
  }

  const parts = [
    `--- FILE: ${LOADER_FILE} ---`,
    loader.trim(),
    "",
    `--- FILE: ${NOW_FILE} ---`,
    now.trim(),
  ];

  // Lint nudge
  if (!lastLint) {
    parts.push(
      "",
      "⚠️ brain_lint has never been run. Consider running brain_lint to check Brain health."
    );
  } else {
    const daysSince = Math.floor(
      (Date.now() - lastLint.getTime()) / (1000 * 60 * 60 * 24)
    );
    if (daysSince > LINT_NUDGE_DAYS) {
      parts.push(
        "",
        `⚠️ Last brain_lint was ${daysSince} days ago. Consider running brain_lint before proceeding.`
      );
    }
  }

  // Open maintenance issues nudge
  if (issues.length > 0) {
    parts.push(
      "",
      `📋 ${issues.length} open Brain maintenance issue(s) requiring review:`
    );
    for (const issue of issues) {
      parts.push(`  - #${issue.number}: ${issue.title} — ${issue.url}`);
    }
    parts.push(
      "",
      "Ask John if he'd like to review and address these now. With explicit approval, read the issue, implement fixes, and commit/push."
    );
  }

  // Inbox nudge
  if (inboxFiles.length > 0) {
    parts.push(
      "",
      `📥 ${inboxFiles.length} file(s) pending in Brain inbox. Use brain_scan_inbox to review, or wait for scheduled processing.`
    );
  }

  return parts.join("\n");
}

export async function readFile(
  filename: string,
  scope: ReadScope = "brain",
  brainId?: string
): Promise<string> {
  const { brainDir, sourcesRoot } = await getBrainPaths(brainId);
  const filePath =
    scope === "sources"
      ? resolveSourcePath(sourcesRoot, filename)
      : resolveFilePath(brainDir, filename);

  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    const available =
      scope === "sources"
        ? await listSourceFileNames(undefined, brainId)
        : await listFileNames(brainId);
    const label = scope === "sources" ? "source files" : "Brain files";
    throw new Error(
      `File not found in ${label}: ${filename}. Available files:\n${available.join("\n")}`
    );
  }
}

export async function updateFile(
  filename: string,
  content: string,
  mode: "replace" | "append" | "patch",
  old_content?: string,
  brainId?: string
): Promise<string> {
  const { brainDir } = await getBrainPaths(brainId);
  const filePath = resolveFilePath(brainDir, filename);

  if (mode === "patch") {
    if (!old_content) {
      throw new Error("patch mode requires old_content parameter");
    }
    const existing = await fs.readFile(filePath, "utf-8");
    const occurrences = existing.split(old_content).length - 1;
    if (occurrences === 0) {
      throw new Error(
        `old_content not found in ${filename}. Ensure the text matches exactly (including whitespace and newlines).`
      );
    }
    if (occurrences > 1) {
      throw new Error(
        `old_content found ${occurrences} times in ${filename}. It must be unique. Provide more surrounding context to disambiguate.`
      );
    }
    // Function replacer: a plain-string replacement would interpret
    // $-patterns ($$, $&, $`, $') and silently corrupt the file.
    const updated = existing.replace(old_content, () => content);
    await fs.writeFile(filePath, updated, "utf-8");
  } else if (mode === "append") {
    const existing = await fs.readFile(filePath, "utf-8").catch(() => "");
    const separator =
      existing.endsWith("\n") || existing.length === 0 ? "" : "\n";
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, existing + separator + content, "utf-8");
  } else {
    // Ensure the parent directory exists so a new file can be created in a
    // subdirectory (e.g. archive/tasks-done.md) that does not yet exist.
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, "utf-8");
  }

  const [stat, fullContent] = await Promise.all([
    fs.stat(filePath),
    fs.readFile(filePath, "utf-8"),
  ]);
  const lines = fullContent.split("\n").length;
  return `Updated ${filename}: ${lines} lines, ${stat.size} bytes`;
}

export async function deleteFile(
  filename: string,
  brainId?: string
): Promise<string> {
  const { brainDir } = await getBrainPaths(brainId);
  const filePath = resolveFilePath(brainDir, filename);
  try {
    await fs.unlink(filePath);
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      throw new Error(`File not found: ${filename}`);
    }
    throw error;
  }
  return `Deleted ${filename}`;
}

export async function renameFile(
  from: string,
  to: string,
  brainId?: string
): Promise<string> {
  const { brainDir } = await getBrainPaths(brainId);
  const fromPath = resolveFilePath(brainDir, from);
  const toPath = resolveFilePath(brainDir, to);
  const targetExists = await fs.access(toPath).then(
    () => true,
    () => false
  );
  if (targetExists) {
    throw new Error(`Target already exists: ${to}`);
  }
  await fs.mkdir(path.dirname(toPath), { recursive: true });
  try {
    await fs.rename(fromPath, toPath);
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      throw new Error(`File not found: ${from}`);
    }
    throw error;
  }
  return `Renamed ${from} -> ${to}`;
}

export async function listFileNames(brainId?: string): Promise<string[]> {
  const { brainDir } = await getBrainPaths(brainId);
  const entries = await fs.readdir(brainDir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(entry.name);
    }
    if (entry.isDirectory()) {
      const subPath = path.join(brainDir, entry.name);
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

export function getStalenessThreshold(filename: string): number {
  const base = path.basename(filename);
  if (base === NOW_FILE) return STALENESS.NOW;
  if (ACTIVE_PATTERNS.some((p) => p.test(base))) return STALENESS.ACTIVE;
  if (IDENTITY_PATTERNS.some((p) => p.test(base))) return STALENESS.IDENTITY;
  return STALENESS.DEFAULT;
}

export async function listFiles(brainId?: string): Promise<BrainFile[]> {
  const { brainDir } = await getBrainPaths(brainId);
  const fileNames = await listFileNames(brainId);
  const now = Date.now();

  const results = await Promise.all(
    fileNames.map(async (name) => {
      const filePath = path.join(brainDir, name);
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

export async function search(
  query: string,
  scope: SearchScope = "brain",
  maxResults: number = MAX_SEARCH_RESULTS,
  brainId?: string
): Promise<string> {
  const { brainDir, sourcesRoot } = await getBrainPaths(brainId);
  const matches: string[] = [];
  const cap = Math.min(
    Math.max(1, Math.floor(maxResults)),
    MAX_SEARCH_RESULTS_CEILING
  );
  let totalChars = 0;
  let linesTruncated = 0;
  let stoppedByBudget = false;

  const searchRoots: { root: string; prefix: string; files: string[] }[] = [];
  if (scope === "brain" || scope === "all") {
    searchRoots.push({
      root: brainDir,
      prefix: "",
      files: await listFileNames(brainId),
    });
  }
  if (scope === "sources" || scope === "all") {
    searchRoots.push({
      root: sourcesRoot,
      prefix: "sources/",
      files: await listSourceFileNames(undefined, brainId),
    });
  }

  outer: for (const { root, prefix, files } of searchRoots) {
    for (const name of files) {
      if (matches.length >= cap) break outer;
      const filePath = path.join(root, name);
      const content = await fs.readFile(filePath, "utf-8").catch(() => "");
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (matches.length >= cap) break outer;
        const line = lines[i];
        if (!lineMatchesSearchQuery(line, query)) continue;
        let trimmed = line.trim();
        if (trimmed.length > SEARCH_LINE_CHAR_LIMIT) {
          trimmed = trimmed.slice(0, SEARCH_LINE_CHAR_LIMIT) + "…";
          linesTruncated++;
        }
        const entry = `${prefix}${name}:${i + 1}: ${trimmed}`;
        if (totalChars + entry.length + 1 > SEARCH_TOTAL_CHAR_LIMIT) {
          stoppedByBudget = true;
          break outer;
        }
        matches.push(entry);
        totalChars += entry.length + 1;
      }
    }
  }

  const result = matches.join("\n");
  const notes: string[] = [];
  if (stoppedByBudget) {
    notes.push(
      `Results truncated at ${Math.round(SEARCH_TOTAL_CHAR_LIMIT / 1000)}KB total size — narrow your query for full coverage.`
    );
  } else if (matches.length >= cap) {
    notes.push(
      `Results truncated at ${cap} matches — raise max_results (ceiling ${MAX_SEARCH_RESULTS_CEILING}) or narrow your query.`
    );
  }
  if (linesTruncated > 0) {
    notes.push(
      `${linesTruncated} line${linesTruncated === 1 ? "" : "s"} trimmed at ${SEARCH_LINE_CHAR_LIMIT} chars (ends with …) — read the file for full content.`
    );
  }
  const footer = notes.length > 0 ? `\n\n(${notes.join(" ")})` : "";

  const scopeLabel =
    scope === "brain" ? "Brain" : scope === "sources" ? "sources" : "Brain + sources";

  return matches.length > 0
    ? `Found ${matches.length} matches for "${query}" in ${scopeLabel}:\n\n${result}${footer}`
    : `No matches found for "${query}" in ${scopeLabel}`;
}
