import fs from "node:fs/promises";
import path from "node:path";
import {
  isDefaultKnowledgeSearchPath,
  rankSearchCandidates,
  type SearchCandidate,
  type SearchResult,
} from "../search-ranking.js";
import type { BrainSearchOptions } from "./brain-store.js";
import { assertBrainVaultPath } from "./brain-path.js";
import {
  NOW_FILE,
  STALENESS,
  ACTIVE_PATTERNS,
  IDENTITY_PATTERNS,
  MAX_SEARCH_RESULTS,
  MAX_SEARCH_RESULTS_CEILING,
  type SourceCategory,
} from "../constants.js";
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
  assertBrainVaultPath(filename);
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
  const results = await searchStructured(
    query,
    { scope, maxResults },
    brainId
  );
  const matches = results.map(
    (result) => `${result.filename}:${result.lineNumber}: ${result.line.trim()}`
  );
  const scopeLabel =
    scope === "brain" ? "Brain" : scope === "sources" ? "sources" : "Brain + sources";
  return matches.length > 0
    ? `Found ${matches.length} matches for "${query}" in ${scopeLabel}:\n\n${matches.join("\n")}`
    : `No matches found for "${query}" in ${scopeLabel}`;
}

export async function searchStructured(
  query: string,
  options: BrainSearchOptions = {},
  brainId?: string
): Promise<SearchResult[]> {
  const { brainDir, sourcesRoot } = await getBrainPaths(brainId);
  const scope = options.scope ?? "brain";
  const cap = Math.min(
    Math.max(1, Math.floor(options.maxResults ?? MAX_SEARCH_RESULTS)),
    MAX_SEARCH_RESULTS_CEILING
  );
  const candidates: SearchCandidate[] = [];

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

  for (const { root, prefix, files } of searchRoots) {
    for (const name of files) {
      if (
        prefix === "" &&
        !options.includeOperational &&
        !isDefaultKnowledgeSearchPath(name)
      ) {
        continue;
      }
      const filePath = path.join(root, name);
      const content = await fs.readFile(filePath, "utf-8").catch(() => "");
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        candidates.push({
          filename: `${prefix}${name}`,
          lineNumber: i + 1,
          line: lines[i],
          scope: prefix ? "sources" : "brain",
        });
      }
    }
  }
  return rankSearchCandidates(candidates, query, {
    maxResults: cap,
    visibleFiles: options.visibleFiles,
  });
}
