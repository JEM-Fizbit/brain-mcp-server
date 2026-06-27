const SEARCH_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "can",
  "could",
  "do",
  "does",
  "find",
  "for",
  "from",
  "get",
  "give",
  "i",
  "in",
  "is",
  "it",
  "john",
  "johns",
  "me",
  "my",
  "of",
  "on",
  "please",
  "show",
  "tell",
  "the",
  "to",
  "what",
  "where",
  "which",
  "who",
  "with",
  "you",
  "your",
]);

function stripDiacritics(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}

function splitCamelCase(value: string): string {
  return stripDiacritics(value)
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2");
}

export function normalizeSearchText(value: string): string {
  return splitCamelCase(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function compactSearchText(value: string): string {
  return stripDiacritics(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

export function meaningfulSearchTokens(query: string): string[] {
  const normalized = normalizeSearchText(query);
  if (!normalized) return [];
  return Array.from(
    new Set(
      normalized
        .split(" ")
        .filter((token) => token && !SEARCH_STOP_WORDS.has(token))
    )
  );
}

export function sourceCandidateSearchTerms(query: string): string[] {
  const terms = [
    query.trim(),
    ...meaningfulSearchTokens(query).filter((token) => token.length >= 3),
  ];
  return Array.from(new Set(terms.filter(Boolean))).slice(0, 6);
}

export function lineMatchesSearchQuery(line: string, query: string): boolean {
  const trimmed = query.trim();
  if (!trimmed) return false;

  const lowerLine = line.toLowerCase();
  const lowerQuery = trimmed.toLowerCase();
  if (lowerLine.includes(lowerQuery)) return true;

  const normalizedLine = normalizeSearchText(line);
  const normalizedQuery = normalizeSearchText(trimmed);
  if (!normalizedQuery) return false;
  if (normalizedLine.includes(normalizedQuery)) return true;

  const compactLine = compactSearchText(line);
  const compactQuery = compactSearchText(trimmed);
  if (compactQuery && compactLine.includes(compactQuery)) return true;

  const tokens = meaningfulSearchTokens(trimmed);
  if (tokens.length === 0) return false;
  if (tokens.length === 1 && tokens[0].length < 3) return false;

  return tokens.every(
    (token) => normalizedLine.includes(token) || compactLine.includes(token)
  );
}
