import { isSourceCompanionPath } from "../source-references/audit.js";

export type SemanticDestinationStatus =
  | "current"
  | "historical"
  | "no_verified_public_website"
  | "incomplete";

export interface BareExternalUrlIssue {
  source: string;
  target: string;
  line: number;
  scope: "brain" | "sources";
}

export interface EntityDestinationRecord {
  source: string;
  status: SemanticDestinationStatus;
  urls: string[];
}

export interface SemanticDestinationAudit {
  brainMarkdownFiles: number;
  sourceCompanions: number;
  entityHubs: EntityDestinationRecord[];
  missingCanonicalDestinationSections: string[];
  incompleteCanonicalDestinationSections: string[];
  bareExternalUrls: BareExternalUrlIssue[];
  sourceOnlyDomains: string[];
}

interface UrlOccurrence {
  target: string;
  index: number;
  kind: "markdown" | "autolink" | "bare";
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

function markdownUrlOccurrences(content: string): UrlOccurrence[] {
  const occurrences: UrlOccurrence[] = [];
  for (const match of content.matchAll(
    /!?\[[^\]]*\]\((?:<([^>]+)>|([^\s)]+))(?:\s+["'][^"']*["'])?\)/g
  )) {
    const target = (match[1] || match[2] || "").trim();
    if (!/^https?:\/\//i.test(target)) continue;
    const offset = match[0].lastIndexOf(target);
    occurrences.push({
      target,
      index: (match.index || 0) + Math.max(0, offset),
      kind: "markdown",
    });
  }
  return occurrences;
}

function autolinkOccurrences(content: string): UrlOccurrence[] {
  const occurrences: UrlOccurrence[] = [];
  for (const match of content.matchAll(/<(https?:\/\/[^>\s]+)>/gi)) {
    occurrences.push({
      target: match[1],
      index: (match.index || 0) + 1,
      kind: "autolink",
    });
  }
  return occurrences;
}

function trimBareUrl(target: string): string {
  return target.replace(/[.,;:!?`'\"]+$/g, "");
}

function externalUrlOccurrences(content: string): UrlOccurrence[] {
  const cleaned = withoutFencedCodeBlocks(content);
  const formatted = [
    ...markdownUrlOccurrences(cleaned),
    ...autolinkOccurrences(cleaned),
  ];
  const formattedStarts = new Set(formatted.map((occurrence) => occurrence.index));
  const bare: UrlOccurrence[] = [];
  for (const match of cleaned.matchAll(/https?:\/\/[^\s<>\])]+/gi)) {
    const index = match.index || 0;
    if (formattedStarts.has(index)) continue;
    const target = trimBareUrl(match[0]);
    if (target) bare.push({ target, index, kind: "bare" });
  }
  return [...formatted, ...bare].sort((a, b) => a.index - b.index);
}

function canonicalDestinationSection(content: string): string | null {
  const match = /^## Canonical destinations\s*$/im.exec(content);
  if (!match || match.index === undefined) return null;
  const start = match.index + match[0].length;
  const remainder = content.slice(start);
  const nextHeading = /^##\s+/m.exec(remainder);
  return nextHeading?.index === undefined
    ? remainder
    : remainder.slice(0, nextHeading.index);
}

function destinationStatus(section: string): SemanticDestinationStatus {
  const markdownUrls = markdownUrlOccurrences(section).map((item) => item.target);
  if (
    /\*\*Official website:\*\*/i.test(section) &&
    markdownUrls.some((target) => target.startsWith("https://"))
  ) {
    return "current";
  }
  if (
    /\*\*Entity status:\*\*[^\n]*\bhistorical\b/i.test(section) &&
    markdownUrls.some((target) => target.startsWith("https://"))
  ) {
    return "historical";
  }
  if (/\*\*Website status:\*\*[^\n]*\bno verified\b/i.test(section)) {
    return "no_verified_public_website";
  }
  return "incomplete";
}

function lineNumber(content: string, index: number): number {
  return content.slice(0, index).split("\n").length;
}

function domainOf(target: string): string | null {
  try {
    return new URL(target).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function isStrictBrainSemanticContent(repoPath: string): boolean {
  return (
    repoPath.startsWith("brain/") &&
    repoPath !== "brain/LOG.md" &&
    repoPath !== "brain/JOURNAL.md" &&
    !repoPath.startsWith("brain/archive/")
  );
}

export function auditSemanticDestinations(input: {
  brainFiles: ReadonlyMap<string, string>;
  sourceFiles?: ReadonlyMap<string, string>;
}): SemanticDestinationAudit {
  const sourceFiles = input.sourceFiles || new Map<string, string>();
  const entityHubs: EntityDestinationRecord[] = [];
  const missingCanonicalDestinationSections: string[] = [];
  const incompleteCanonicalDestinationSections: string[] = [];
  const bareExternalUrls: BareExternalUrlIssue[] = [];
  const brainDomains = new Set<string>();
  const sourceDomains = new Set<string>();

  const inspectUrls = (
    source: string,
    content: string,
    scope: "brain" | "sources",
    domains: Set<string>
  ) => {
    for (const occurrence of externalUrlOccurrences(content)) {
      const domain = domainOf(occurrence.target);
      if (domain) domains.add(domain);
      if (occurrence.kind === "bare") {
        bareExternalUrls.push({
          source,
          target: occurrence.target,
          line: lineNumber(withoutFencedCodeBlocks(content), occurrence.index),
          scope,
        });
      }
    }
  };

  for (const [name, content] of input.brainFiles) {
    const source = `brain/${name}`;
    inspectUrls(source, content, "brain", brainDomains);
    if (!/^>\s*Entity page\b/im.test(content)) continue;
    const section = canonicalDestinationSection(content);
    if (section === null) {
      missingCanonicalDestinationSections.push(source);
      entityHubs.push({ source, status: "incomplete", urls: [] });
      continue;
    }
    const status = destinationStatus(section);
    const urls = markdownUrlOccurrences(section)
      .map((item) => item.target)
      .sort();
    entityHubs.push({ source, status, urls });
    if (status === "incomplete") incompleteCanonicalDestinationSections.push(source);
  }

  for (const [name, content] of sourceFiles) {
    inspectUrls(`sources/${name}`, content, "sources", sourceDomains);
  }

  return {
    brainMarkdownFiles: input.brainFiles.size,
    sourceCompanions: Array.from(sourceFiles.keys()).filter(isSourceCompanionPath).length,
    entityHubs: entityHubs.sort((a, b) => a.source.localeCompare(b.source)),
    missingCanonicalDestinationSections: missingCanonicalDestinationSections.sort(),
    incompleteCanonicalDestinationSections: incompleteCanonicalDestinationSections.sort(),
    bareExternalUrls: bareExternalUrls.sort(
      (a, b) =>
        a.source.localeCompare(b.source) ||
        a.line - b.line ||
        a.target.localeCompare(b.target)
    ),
    sourceOnlyDomains: Array.from(sourceDomains)
      .filter((domain) => !brainDomains.has(domain))
      .sort(),
  };
}
