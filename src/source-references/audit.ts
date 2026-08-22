import path from "node:path";

export interface SourceLinkIssue {
  source: string;
  target: string;
  suggestion?: string;
}

export interface SourceLinkAudit {
  brainMarkdownFiles: number;
  sourceCompanions: number;
  directlyLinkedCompanions: string[];
  indexOnlyCompanions: string[];
  unlinkedCompanions: string[];
  companionsWithoutBacklinks: string[];
  brokenLinks: SourceLinkIssue[];
  nonClickableSourceReferences: SourceLinkIssue[];
}

interface MarkdownLink {
  target: string;
}

interface WikiLink {
  target: string;
}

function withoutFencedCodeBlocks(content: string): string {
  let inFence = false;
  let marker = "";
  return content
    .split("\n")
    .map((line) => {
      const fence = line.match(/^ {0,3}(`{3,}|~{3,})/);
      if (fence) {
        if (!inFence) {
          inFence = true;
          marker = fence[1][0];
        } else if (fence[1][0] === marker) {
          inFence = false;
        }
        return "";
      }
      return inFence ? "" : line;
    })
    .join("\n");
}

function markdownLinks(content: string): MarkdownLink[] {
  const links: MarkdownLink[] = [];
  const cleaned = withoutFencedCodeBlocks(content);
  for (const match of cleaned.matchAll(/!?\[[^\]]*\]\((?:<([^>]+)>|([^\s)]+))(?:\s+["'][^"']*["'])?\)/g)) {
    links.push({ target: (match[1] || match[2] || "").trim() });
  }
  return links;
}

function wikiLinks(content: string): WikiLink[] {
  const links: WikiLink[] = [];
  const cleaned = withoutFencedCodeBlocks(content);
  for (const match of cleaned.matchAll(/!?\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g)) {
    const target = match[1].trim();
    if (target) links.push({ target });
  }
  return links;
}

function codeSpanSourceRefs(content: string): string[] {
  const refs: string[] = [];
  const cleaned = withoutFencedCodeBlocks(content);
  for (const match of cleaned.matchAll(/(?<!`)`([^`\n]+\.md)`(?!`)/g)) {
    const raw = match[1].trim();
    if (raw.includes("sources/") && !/[{}]/.test(raw)) refs.push(raw);
  }
  return refs;
}

function internalTarget(target: string): string | null {
  if (!target || target.startsWith("#")) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return null;
  const withoutSuffix = target.split("#", 1)[0].split("?", 1)[0];
  try {
    return decodeURIComponent(withoutSuffix);
  } catch {
    return withoutSuffix;
  }
}

function resolveTarget(source: string, target: string): string {
  return path.posix.normalize(path.posix.join(path.posix.dirname(source), target));
}

function isSubstantiveBrainFile(repoPath: string): boolean {
  if (!repoPath.startsWith("brain/")) return false;
  const relative = repoPath.slice("brain/".length);
  return !(
    relative === "SOURCES.md" ||
    relative === "LOG.md" ||
    relative === "JOURNAL.md" ||
    relative.startsWith("archive/")
  );
}

function isArchivedBrainFile(repoPath: string): boolean {
  return repoPath.startsWith("brain/archive/");
}

function auditedMarkdownTarget(target: string): boolean {
  return target.endsWith(".md") && (target.startsWith("brain/") || target.startsWith("sources/"));
}

function normalizeAbsoluteSourceRef(target: string): string | null {
  const normalized = target.replace(/\\/g, "/");
  const marker = "/sources/";
  const index = normalized.lastIndexOf(marker);
  return index === -1 ? null : normalized.slice(index + 1);
}

function suggestedMarkdownLink(source: string, target: string): string | undefined {
  const normalized = target.startsWith("/")
    ? normalizeAbsoluteSourceRef(target)
    : target.replace(/^\.\//, "");
  if (!normalized) return undefined;
  const repoTarget = normalized.startsWith("sources/") ? normalized : `sources/${normalized}`;
  let relative = path.posix.relative(path.posix.dirname(source), repoTarget);
  if (!relative.startsWith(".")) relative = `./${relative}`;
  const label = path.posix.basename(repoTarget, ".md").replace(/[-_]+/g, " ");
  return `[${label}](${relative})`;
}

export function auditSourceLinks(input: {
  brainFiles: ReadonlyMap<string, string>;
  sourceFiles: ReadonlyMap<string, string>;
}): SourceLinkAudit {
  const files = new Map<string, string>();
  for (const [name, content] of input.brainFiles) files.set(`brain/${name}`, content);
  for (const [name, content] of input.sourceFiles) files.set(`sources/${name}`, content);
  const known = new Set(files.keys());
  const companions = Array.from(input.sourceFiles.keys())
    .filter((name) => name.endsWith(".md"))
    .map((name) => `sources/${name}`)
    .sort();
  const substantiveLinkers = new Map<string, Set<string>>();
  const indexLinkers = new Map<string, Set<string>>();
  const backlinks = new Map<string, Set<string>>();
  const brokenLinks: SourceLinkIssue[] = [];
  const nonClickableSourceReferences: SourceLinkIssue[] = [];

  for (const [source, content] of files) {
    if (isArchivedBrainFile(source)) continue;
    for (const link of markdownLinks(content)) {
      const target = internalTarget(link.target);
      if (target === null) continue;
      const resolved = resolveTarget(source, target);
      if (!known.has(resolved)) {
        const rootCandidate = target.replace(/^\.\//, "");
        if (!auditedMarkdownTarget(resolved) && !auditedMarkdownTarget(rootCandidate)) {
          continue;
        }
        brokenLinks.push({
          source,
          target: link.target,
          suggestion:
            source.startsWith("brain/") && known.has(rootCandidate)
              ? path.posix.relative(path.posix.dirname(source), rootCandidate)
              : undefined,
        });
        continue;
      }
      if (source.startsWith("brain/") && resolved.startsWith("sources/")) {
        const collection = isSubstantiveBrainFile(source) ? substantiveLinkers : indexLinkers;
        const linkers = collection.get(resolved) || new Set<string>();
        linkers.add(source);
        collection.set(resolved, linkers);
      }
      if (source.startsWith("sources/") && resolved.startsWith("brain/")) {
        const targets = backlinks.get(source) || new Set<string>();
        targets.add(resolved);
        backlinks.set(source, targets);
      }
    }

    for (const link of wikiLinks(content)) {
      const target = link.target.endsWith(".md") ? link.target : `${link.target}.md`;
      const resolved = source.startsWith("sources/")
        ? path.posix.normalize(`brain/${target.replace(/^brain\//, "")}`)
        : target.startsWith("sources/")
          ? path.posix.normalize(target)
          : path.posix.normalize(`brain/${target.replace(/^brain\//, "")}`);
      if (!known.has(resolved)) continue;
      if (source.startsWith("brain/") && resolved.startsWith("sources/")) {
        const collection = isSubstantiveBrainFile(source) ? substantiveLinkers : indexLinkers;
        const linkers = collection.get(resolved) || new Set<string>();
        linkers.add(source);
        collection.set(resolved, linkers);
      }
      if (source.startsWith("sources/") && resolved.startsWith("brain/")) {
        const targets = backlinks.get(source) || new Set<string>();
        targets.add(resolved);
        backlinks.set(source, targets);
      }
    }

    if (source.startsWith("brain/")) {
      for (const target of codeSpanSourceRefs(content)) {
        nonClickableSourceReferences.push({
          source,
          target,
          suggestion: suggestedMarkdownLink(source, target),
        });
      }
    }
  }

  const directlyLinkedCompanions = companions.filter((name) => substantiveLinkers.has(name));
  const indexOnlyCompanions = companions.filter(
    (name) => !substantiveLinkers.has(name) && indexLinkers.has(name)
  );
  const unlinkedCompanions = companions.filter(
    (name) => !substantiveLinkers.has(name) && !indexLinkers.has(name)
  );
  const companionsWithoutBacklinks = companions.filter((name) => !backlinks.has(name));

  return {
    brainMarkdownFiles: input.brainFiles.size,
    sourceCompanions: companions.length,
    directlyLinkedCompanions,
    indexOnlyCompanions,
    unlinkedCompanions,
    companionsWithoutBacklinks,
    brokenLinks: brokenLinks.sort(
      (a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target)
    ),
    nonClickableSourceReferences: nonClickableSourceReferences.sort(
      (a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target)
    ),
  };
}
