import path from "node:path";
import {
  compactSearchText,
  meaningfulSearchTokens,
  normalizeSearchText,
} from "./search-match.js";

export type SearchResultScope = "brain" | "sources";
export type SearchMatchMechanism =
  | "exact_phrase"
  | "normalized_phrase"
  | "compact_phrase"
  | "token_match"
  | "path_match"
  | "fts";

export interface SearchCandidate {
  filename: string;
  lineNumber: number;
  line: string;
  scope: SearchResultScope;
  /** Optional store-native score, such as Postgres ts_rank_cd. */
  nativeScore?: number;
  nativeMechanism?: "fts";
}

export interface SearchResult extends SearchCandidate {
  score: number;
  mechanism: SearchMatchMechanism;
}

export interface RankSearchOptions {
  maxResults: number;
  /** Permission seam: candidates not visible to the caller never reach ranking. */
  visibleFiles?: ReadonlySet<string>;
}

const OPERATIONAL_BASENAMES = new Set(["log.md", "journal.md"]);
const OPERATIONAL_PREFIXES = ["archive/", "working/"];

/** Default knowledge search excludes operational/history paths before ranking. */
export function isDefaultKnowledgeSearchPath(filename: string): boolean {
  const normalized = filename.replace(/\\/g, "/").replace(/^\.\//, "");
  const lower = normalized.toLowerCase();
  if (OPERATIONAL_BASENAMES.has(path.posix.basename(lower))) return false;
  return !OPERATIONAL_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

function finiteScore(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, Number(value)) : 0;
}

export function scoreSearchCandidate(
  candidate: SearchCandidate,
  query: string
): SearchResult | null {
  const trimmed = query.trim();
  if (!trimmed) return null;

  const lowerLine = candidate.line.toLowerCase();
  const lowerQuery = trimmed.toLowerCase();
  const normalizedLine = normalizeSearchText(candidate.line);
  const normalizedQuery = normalizeSearchText(trimmed);
  const compactLine = compactSearchText(candidate.line);
  const compactQuery = compactSearchText(trimmed);
  const normalizedFilename = normalizeSearchText(candidate.filename);
  const compactFilename = compactSearchText(candidate.filename);
  const tokens = meaningfulSearchTokens(trimmed);

  let mechanism: SearchMatchMechanism | null = null;
  let score = 0;
  if (lowerLine.includes(lowerQuery)) {
    mechanism = "exact_phrase";
    score = 100;
  } else if (normalizedQuery && normalizedLine.includes(normalizedQuery)) {
    mechanism = "normalized_phrase";
    score = 85;
  } else if (compactQuery && compactLine.includes(compactQuery)) {
    mechanism = "compact_phrase";
    score = 75;
  } else if (
    tokens.length > 0 &&
    !(tokens.length === 1 && tokens[0].length < 3) &&
    tokens.every(
      (token) =>
        normalizedLine.includes(token) ||
        compactLine.includes(token) ||
        normalizedFilename.includes(token) ||
        compactFilename.includes(token)
    )
  ) {
    mechanism = candidate.nativeMechanism ?? "token_match";
    score = 55 + Math.min(tokens.length, 10);
  } else if (
    normalizedQuery &&
    (normalizedFilename.includes(normalizedQuery) ||
      compactFilename.includes(compactQuery))
  ) {
    mechanism = "path_match";
    score = 45;
  }

  if (!mechanism) return null;

  if (
    normalizedQuery &&
    (normalizedFilename.includes(normalizedQuery) ||
      (compactQuery && compactFilename.includes(compactQuery)))
  ) {
    score += 15;
  }
  score += Math.min(finiteScore(candidate.nativeScore) * 10, 10);

  return {
    ...candidate,
    score: Number(score.toFixed(6)),
    mechanism,
  };
}

export function rankSearchCandidates(
  candidates: SearchCandidate[],
  query: string,
  options: RankSearchOptions
): SearchResult[] {
  const visible = options.visibleFiles;
  const ranked = candidates
    .filter((candidate) => !visible || visible.has(candidate.filename))
    .map((candidate) => scoreSearchCandidate(candidate, query))
    .filter((candidate): candidate is SearchResult => candidate !== null);

  return sortSearchResults(ranked, options.maxResults);
}

export function sortSearchResults(
  results: SearchResult[],
  maxResults: number
): SearchResult[] {
  return [...results]
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.filename.localeCompare(b.filename) ||
        a.lineNumber - b.lineNumber ||
        a.line.localeCompare(b.line)
    )
    .slice(0, Math.max(1, Math.floor(maxResults)));
}

/** Production ranking entry point used by filesystem search and frozen eval fixtures. */
export function searchMarkdownFiles(
  files: Record<string, string>,
  query: string,
  options: {
    maxResults: number;
    includeOperational?: boolean;
    scope?: SearchResultScope;
  }
): SearchResult[] {
  const scope = options.scope ?? "brain";
  const candidates: SearchCandidate[] = [];
  for (const filename of Object.keys(files).sort()) {
    if (
      scope === "brain" &&
      !options.includeOperational &&
      !isDefaultKnowledgeSearchPath(filename)
    ) {
      continue;
    }
    const lines = files[filename].split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      candidates.push({
        filename,
        lineNumber: index + 1,
        line: lines[index],
        scope,
      });
    }
  }
  return rankSearchCandidates(candidates, query, {
    maxResults: options.maxResults,
  });
}
