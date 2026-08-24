import path from "node:path";
import { LOADER_FILE, NOW_FILE } from "../constants.js";
import type { BrainLintConfig } from "./registry.js";

export type GraphEdgeSyntax =
  | "wikilink"
  | "markdown_link"
  | "backtick_file"
  | "backtick_directory"
  | "sharepoint_url";

export interface GraphDiagnostic {
  code:
    | "ambiguous_target"
    | "malformed_encoding"
    | "missing_directory_index"
    | "missing_root"
    | "parent_link_disabled"
    | "path_escape"
    | "unresolved_target";
  source: string;
  syntax: GraphEdgeSyntax | "root";
  target: string;
}

export interface GraphExternalReference {
  reason:
    | "source_boundary"
    | "outside_brain"
    | "unresolved_locator"
    | "directory_locator";
  source: string;
  syntax: GraphEdgeSyntax;
  target: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  syntax: GraphEdgeSyntax;
}

export interface BrainGraphAnalysis {
  roots: string[];
  reachable: string[];
  unreachable: string[];
  exempted: string[];
  edges: GraphEdge[];
  diagnostics: GraphDiagnostic[];
  externalReferences: GraphExternalReference[];
}

interface RawEdge {
  raw: string;
  syntax: GraphEdgeSyntax;
  resolution: "root" | "source" | "root_or_source";
  directory: boolean;
}

/**
 * Route examples inside fenced code blocks are documentation, not graph
 * edges. Removing them also prevents a triple-backtick fence from consuming
 * later inline-code spans in the backtick-reference matcher.
 */
function withoutFencedCodeBlocks(content: string): string {
  let fence: { marker: "`" | "~"; length: number } | null = null;

  return content
    .split("\n")
    .map((line) => {
      if (fence) {
        const closing = line.match(/^ {0,3}(`{3,}|~{3,})\s*$/);
        if (
          closing &&
          closing[1][0] === fence.marker &&
          closing[1].length >= fence.length
        ) {
          fence = null;
        }
        return "";
      }

      const opening = line.match(/^ {0,3}(`{3,}|~{3,})(?:[^`~].*)?$/);
      if (opening) {
        fence = {
          marker: opening[1][0] as "`" | "~",
          length: opening[1].length,
        };
        return "";
      }

      return line;
    })
    .join("\n");
}

function withoutInlineCodeSpans(content: string): string {
  return content.replace(/(?<!`)`[^`\n]+`(?!`)/g, (match) => " ".repeat(match.length));
}

function decodeTarget(raw: string): string | null {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

function stripFragmentAndQuery(value: string): string {
  return value.split("#", 1)[0].split("?", 1)[0].trim();
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\0")
    .replace(/\*/g, "[^/]*")
    .replace(/\0/g, ".*")
    .replace(/\?/g, "[^/]");
  return new RegExp(`^${escaped}$`);
}

function extractRawEdges(
  content: string,
  config: BrainLintConfig
): RawEdge[] {
  const graphContent = withoutFencedCodeBlocks(content);
  const linkContent = withoutInlineCodeSpans(graphContent);
  const backtickContent = graphContent.replace(
    /!?\[[^\]]*\]\((?:<[^>]+>|[^\s)]+)(?:\s+['"][^'"]*['"])?\)/g,
    (match) => " ".repeat(match.length)
  );
  const found: RawEdge[] = [];
  const seen = new Set<string>();
  const add = (edge: RawEdge) => {
    const key = `${edge.syntax}\0${edge.raw}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push(edge);
  };

  for (const match of linkContent.matchAll(/\[\[([^\]]+?)\]\]/g)) {
    const inner = match[1].replace(/\\\|/g, "|");
    const target = inner.split("|", 1)[0].split("#", 1)[0].trim();
    if (target) {
      add({ raw: target, syntax: "wikilink", resolution: "root", directory: target.endsWith("/") });
    }
  }

  for (const match of linkContent.matchAll(/!?\[[^\]]*\]\((?:<([^>]+)>|([^\s)]+))(?:\s+['"][^'"]*['"])?\)/g)) {
    const target = (match[1] || match[2] || "").trim();
    if (!target) continue;
    // Same-document anchors are valid navigation but do not create a graph
    // edge. Other URI schemes (computer:, mailto:, file:, etc.) are external
    // surfaces, not candidate Brain paths.
    if (target.startsWith("#")) continue;
    if (/^https:\/\//i.test(target)) {
      for (const mapping of config.sharepoint_url_mappings || []) {
        if (!target.startsWith(mapping.url_prefix)) continue;
        const remainder = target.slice(mapping.url_prefix.length).replace(/^\/+/, "");
        add({
          raw: path.posix.join(mapping.brain_path_prefix, remainder),
          syntax: "sharepoint_url",
          resolution: "root",
          directory: remainder.endsWith("/"),
        });
      }
      continue;
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
    if (target.endsWith("/")) continue;
    add({
      raw: target,
      syntax: "markdown_link",
      resolution: "source",
      directory: false,
    });
  }

  for (const match of backtickContent.matchAll(/(?<!`)`([^`\n]+)`(?!`)/g)) {
    const target = match[1].trim();
    if (target.endsWith(".md")) {
      add({ raw: target, syntax: "backtick_file", resolution: "root_or_source", directory: false });
    } else if (target.endsWith("/")) {
      add({ raw: target, syntax: "backtick_directory", resolution: "root_or_source", directory: true });
    }
  }

  for (const match of linkContent.matchAll(/https:\/\/[^\s)>\]`"']+/g)) {
    const url = match[0];
    for (const mapping of config.sharepoint_url_mappings || []) {
      if (!url.startsWith(mapping.url_prefix)) continue;
      const remainder = url.slice(mapping.url_prefix.length).replace(/^\/+/, "");
      add({
        raw: path.posix.join(mapping.brain_path_prefix, remainder),
        syntax: "sharepoint_url",
        resolution: "root",
        directory: remainder.endsWith("/"),
      });
    }
  }

  return found;
}

function resolveRawEdge(
  source: string,
  rawEdge: RawEdge,
  files: Set<string>,
  config: BrainLintConfig,
  diagnostics: GraphDiagnostic[],
  externalReferences: GraphExternalReference[]
): string | null {
  const decoded = decodeTarget(stripFragmentAndQuery(rawEdge.raw));
  if (decoded === null) {
    diagnostics.push({
      code: "malformed_encoding",
      source,
      syntax: rawEdge.syntax,
      target: rawEdge.raw,
    });
    return null;
  }
  if (path.posix.isAbsolute(decoded) || /^[A-Za-z]:[\\/]/.test(decoded)) {
    if (rawEdge.syntax === "backtick_file" || rawEdge.syntax === "backtick_directory") {
      externalReferences.push({
        reason: "outside_brain",
        source,
        syntax: rawEdge.syntax,
        target: rawEdge.raw,
      });
    } else {
      diagnostics.push({ code: "path_escape", source, syntax: rawEdge.syntax, target: rawEdge.raw });
    }
    return null;
  }
  if (
    decoded.split("/").includes("..") &&
    config.relative_parent_scope !== "within_brain"
  ) {
    externalReferences.push({
      reason: decoded.replace(/^(?:\.\.\/)+/, "").startsWith("sources/")
        ? "source_boundary"
        : "outside_brain",
      source,
      syntax: rawEdge.syntax,
      target: rawEdge.raw,
    });
    return null;
  }

  const sourceDir = path.posix.dirname(source);
  const rootCandidate = path.posix.normalize(decoded.replace(/^\.\//, ""));
  const relativeCandidate = path.posix.normalize(path.posix.join(sourceDir, decoded));
  const candidates = Array.from(
    new Set(
      rawEdge.resolution === "root"
        ? [rootCandidate]
        : rawEdge.resolution === "source"
          ? [relativeCandidate]
          : [rootCandidate, relativeCandidate]
    )
  ).filter(
    (candidate) => candidate !== ".." && !candidate.startsWith("../")
  );
  if (candidates.length === 0) {
    if (rawEdge.syntax === "backtick_file" || rawEdge.syntax === "backtick_directory") {
      externalReferences.push({
        reason: "outside_brain",
        source,
        syntax: rawEdge.syntax,
        target: rawEdge.raw,
      });
    } else {
      diagnostics.push({ code: "path_escape", source, syntax: rawEdge.syntax, target: rawEdge.raw });
    }
    return null;
  }

  const exact: string[] = [];
  for (const candidate of candidates) {
    if (rawEdge.directory) {
      const readme = path.posix.join(candidate, "README.md");
      const index = path.posix.join(candidate, "INDEX.md");
      if (files.has(readme)) exact.push(readme);
      else if (files.has(index)) exact.push(index);
    } else {
      const expanded = candidate.endsWith(".md") ? candidate : `${candidate}.md`;
      if (files.has(expanded)) exact.push(expanded);
    }
  }
  const uniqueExact = Array.from(new Set(exact));
  if (uniqueExact.length === 1) return uniqueExact[0];
  if (uniqueExact.length > 1) {
    diagnostics.push({ code: "ambiguous_target", source, syntax: rawEdge.syntax, target: rawEdge.raw });
    return null;
  }

  if (rawEdge.syntax === "wikilink" && !decoded.includes("/")) {
    const wanted = `${decoded.replace(/\.md$/, "")}.md`;
    const basenameMatches = Array.from(files).filter(
      (filename) => path.posix.basename(filename) === wanted
    );
    if (basenameMatches.length === 1) return basenameMatches[0];
    if (basenameMatches.length > 1) {
      diagnostics.push({ code: "ambiguous_target", source, syntax: rawEdge.syntax, target: rawEdge.raw });
      return null;
    }
  }

  if (rawEdge.syntax === "backtick_file" || rawEdge.syntax === "backtick_directory") {
    externalReferences.push({
      reason: rawEdge.directory ? "directory_locator" : "unresolved_locator",
      source,
      syntax: rawEdge.syntax,
      target: rawEdge.raw,
    });
  } else {
    diagnostics.push({
      code: rawEdge.directory ? "missing_directory_index" : "unresolved_target",
      source,
      syntax: rawEdge.syntax,
      target: rawEdge.raw,
    });
  }
  return null;
}

export function analyzeBrainGraph(
  contents: ReadonlyMap<string, string>,
  config: BrainLintConfig = {}
): BrainGraphAnalysis {
  const files = new Set(contents.keys());
  const diagnostics: GraphDiagnostic[] = [];
  const externalReferences: GraphExternalReference[] = [];
  const edges: GraphEdge[] = [];
  const roots = Array.from(
    new Set([LOADER_FILE, NOW_FILE, ...(config.graph_roots || [])])
  );
  const exemptMatchers = (config.exempt_globs || []).map(globToRegExp);
  const isExempt = (filename: string) =>
    exemptMatchers.some((matcher) => matcher.test(filename));

  for (const root of roots) {
    if (!files.has(root)) {
      diagnostics.push({ code: "missing_root", source: root, syntax: "root", target: root });
    }
  }

  for (const [source, content] of contents) {
    // Exempt files such as rotated history are outside graph adjudication.
    // They remain valid edge targets, but their historical path-like text must
    // not create current graph diagnostics or routing edges.
    if (isExempt(source)) continue;
    for (const rawEdge of extractRawEdges(content, config)) {
      const target = resolveRawEdge(
        source,
        rawEdge,
        files,
        config,
        diagnostics,
        externalReferences
      );
      if (target) edges.push({ source, target, syntax: rawEdge.syntax });
    }
  }

  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    const targets = adjacency.get(edge.source) || [];
    targets.push(edge.target);
    adjacency.set(edge.source, targets);
  }
  const reachable = new Set<string>();
  const queue = roots.filter((root) => files.has(root));
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (reachable.has(current)) continue;
    reachable.add(current);
    for (const target of adjacency.get(current) || []) {
      if (!reachable.has(target)) queue.push(target);
    }
  }

  const exempted = Array.from(files)
    .filter(isExempt)
    .sort();
  const exemptSet = new Set(exempted);
  const unreachable = Array.from(files)
    .filter((filename) => !reachable.has(filename) && !exemptSet.has(filename))
    .sort();

  return {
    roots,
    reachable: Array.from(reachable).sort(),
    unreachable,
    exempted,
    edges: edges.sort(
      (a, b) =>
        a.source.localeCompare(b.source) ||
        a.target.localeCompare(b.target) ||
        a.syntax.localeCompare(b.syntax)
    ),
    diagnostics: diagnostics.sort(
      (a, b) =>
        a.source.localeCompare(b.source) ||
        a.code.localeCompare(b.code) ||
        a.target.localeCompare(b.target)
    ),
    externalReferences: externalReferences.sort(
      (a, b) =>
        a.source.localeCompare(b.source) ||
        a.reason.localeCompare(b.reason) ||
        a.target.localeCompare(b.target)
    ),
  };
}
