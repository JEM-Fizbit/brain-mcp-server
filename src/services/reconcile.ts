/**
 * Reconcile lint: detection-only cross-file contradiction candidates.
 *
 * The Brain deliberately repeats load-bearing facts in hubs and detail files
 * (e.g. capital raised in 01_identity.md, quanta.md and ref_capital_deals.md).
 * When one copy is corrected and another is not, the Brain contradicts itself.
 * This module extracts quantified claims (money, counts, percentages,
 * multiples), attributes each to a subject, and pairs claims in different
 * files that describe the same subject and metric but carry incompatible
 * values. It never edits content and never decides which copy is right:
 * candidates are handed to the calling agent (and the owner) to adjudicate.
 *
 * Deterministic and dependency-free so it runs identically on filesystem and
 * revision-backed stores. See docs/specs/025-reconcile-lint.md.
 */

export type ReconcileQuantityKind = "money" | "count" | "percent" | "multiple";
export type ReconcileBound = "exact" | "approx" | "lower" | "upper";

export interface ReconcileClaim {
  file: string;
  line: number;
  raw: string;
  excerpt: string;
  kind: ReconcileQuantityKind;
  unit: string;
  value: number;
  bound: ReconcileBound;
  subject: string;
  terms: string[];
}

export interface ReconcileCandidate {
  subject: string;
  kind: ReconcileQuantityKind;
  unit: string;
  relation: "different_values" | "different_lower_bounds";
  sharedTerms: string[];
  left: Omit<ReconcileClaim, "terms" | "subject" | "kind" | "unit">;
  right: Omit<ReconcileClaim, "terms" | "subject" | "kind" | "unit">;
}

export interface ReconcileReport {
  mode: "advisory";
  filesScanned: number;
  claimsScanned: number;
  candidates: ReconcileCandidate[];
  omittedCandidates: number;
}

export const RECONCILE_CANDIDATE_LIMIT = 40;
const OWNER_SUBJECT = "(brain owner)";

/**
 * Operational and historical files legitimately hold superseded values
 * ("previously X", dated log entries), so they are never compared.
 */
const EXCLUDED_FILE_PATTERNS: RegExp[] = [
  /(^|\/)(LOG|JOURNAL|TASKS|SOURCES|README|BUSINESS_IDEAS)\.md$/i,
  /(^|\/)(00_loader|NOW|12_brain_operations)\.md$/i,
  /^(archive|working|acceptance|test|inbox)\//i,
  /(^|\/)\./,
];

const STOPWORDS = new Set(
  (
    "the a an and or of to in on for with by from at as is are was were be been " +
    "it its this that these those than then into over under across about around " +
    "including incl include includes plus per via also more most less only each " +
    "both all any some such other who whom which what when where while during " +
    "after before since until his her their our your not but has have had " +
    "see note notes total approx approximately roughly circa nearly almost up " +
    "multiple several various new first last largest-ever largest ever"
  ).split(/\s+/)
);

const COUNT_UNIT_ALIASES: Record<string, string> = {
  person: "people",
  people: "people",
  employee: "people",
  staff: "people",
  fte: "people",
  headcount: "people",
  member: "people",
  year: "years",
  yr: "years",
};

/** Units that describe configuration or document mechanics, not facts. */
const IGNORED_COUNT_UNITS = new Set([
  "day", "week", "month", "hour", "minute", "second", "ms", "line", "word",
  "character", "char", "byte", "kb", "mb", "gb", "token", "page", "file",
  "item", "step", "row", "column", "file", "result", "match", "call",
  "attempt", "time", "x", "am", "pm", "st", "nd", "rd", "th",
  // Dates ("9 Dec 2016") are not counts.
  "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "sept", "oct",
  "nov", "dec", "january", "february", "march", "april", "june", "july",
  "august", "september", "october", "november", "december",
]);

const MONEY_SCALE: Record<string, number> = {
  k: 1e3,
  thousand: 1e3,
  m: 1e6,
  mm: 1e6,
  mn: 1e6,
  million: 1e6,
  b: 1e9,
  bn: 1e9,
  billion: 1e9,
};

const CURRENCY: Record<string, string> = {
  "$": "USD",
  "£": "GBP",
  "€": "EUR",
  usd: "USD",
  gbp: "GBP",
  eur: "EUR",
};

const PREFIX =
  "(?:(over|more than|at least|>|up to|under|less than|<|~|c\\.|circa|approx\\.?|approximately|about|around|nearly|almost)\\s*)?";
const MONEY_RE = new RegExp(
  PREFIX +
    "([$£€])\\s?(\\d{1,3}(?:,\\d{3})+|\\d+(?:\\.\\d+)?)\\s?(thousand|million|billion|mm|mn|bn|k|m|b)?(?![a-z0-9])(\\+)?",
  "gi"
);
const PERCENT_RE = new RegExp(PREFIX + "(?<![\\d.–—-])(\\d+(?:\\.\\d+)?)\\s?%(\\+)?", "gi");
const MULTIPLE_RE = new RegExp(
  PREFIX + "(?<![\\w.])(\\d+(?:\\.\\d+)?)x(?![a-z0-9])(\\+)?",
  "gi"
);
const COUNT_RE = new RegExp(
  PREFIX +
    "(?<![\\w.$£€/:#–—-])(\\d{1,3}(?:,\\d{3})+|\\d+)(\\+)?(?:\\s|-)([a-z]+)",
  "gi"
);

function boundFromPrefix(prefix: string | undefined, plus: string | undefined): ReconcileBound {
  if (plus) return "lower";
  const p = (prefix || "").toLowerCase().replace(/\s+/g, " ");
  if (!p) return "exact";
  if (["over", "more than", "at least", ">"].includes(p)) return "lower";
  if (["up to", "under", "less than", "<"].includes(p)) return "upper";
  return "approx";
}

function parseNumber(text: string): number {
  return Number.parseFloat(text.replace(/,/g, ""));
}

function lemma(word: string): string {
  const lower = word.toLowerCase();
  if (COUNT_UNIT_ALIASES[lower]) return COUNT_UNIT_ALIASES[lower];
  const singular =
    lower.length > 3 && lower.endsWith("ies")
      ? `${lower.slice(0, -3)}y`
      : lower.length > 3 && lower.endsWith("s") && !lower.endsWith("ss")
        ? lower.slice(0, -1)
        : lower;
  return COUNT_UNIT_ALIASES[singular] ?? singular;
}

function stemOf(target: string): string {
  const withoutAnchor = target.split("#")[0].trim();
  const base = withoutAnchor.split("/").pop() || withoutAnchor;
  return base.replace(/\.md$/i, "").toLowerCase();
}

function isExcluded(file: string): boolean {
  const normalized = file.replace(/\\/g, "/");
  return EXCLUDED_FILE_PATTERNS.some((pattern) => pattern.test(normalized));
}

/** Entity files are lower-case single-subject pages such as quanta.md. */
function entityStem(file: string): string | null {
  const normalized = file.replace(/\\/g, "/");
  if (normalized.includes("/")) return null;
  const stem = normalized.replace(/\.md$/i, "");
  if (!/^[a-z][a-z0-9_]*$/.test(stem)) return null;
  if (/^ref_/.test(stem)) return null;
  return stem;
}

interface SubjectLexicon {
  entities: Set<string>;
  /** Lower-case plain-text names (stem with spaces, plus link aliases). */
  names: { name: string; subject: string; pattern: RegExp }[];
  /** Words from entity names; never evidence that two claims share a metric. */
  nameTokens: Set<string>;
}

const WIKILINK_RE = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildLexicon(files: Map<string, string>): SubjectLexicon {
  const entities = new Set<string>();
  for (const file of files.keys()) {
    const stem = entityStem(file);
    if (stem) entities.add(stem);
  }
  const nameMap = new Map<string, string>();
  for (const stem of entities) {
    nameMap.set(stem.replace(/_/g, " "), stem);
  }
  for (const content of files.values()) {
    for (const match of content.matchAll(WIKILINK_RE)) {
      const stem = stemOf(match[1]);
      const alias = match[2]?.trim().toLowerCase();
      if (!entities.has(stem) || !alias || alias.length < 4) continue;
      if (!nameMap.has(alias)) nameMap.set(alias, stem);
    }
  }
  const names = [...nameMap.entries()]
    .filter(([name]) => name.length >= 4)
    .sort((left, right) => right[0].length - left[0].length)
    .map(([name, subject]) => ({
      name,
      subject,
      pattern: new RegExp(`(?<![a-z0-9])${escapeRegExp(name)}(?![a-z0-9])`, "gi"),
    }));
  const nameTokens = new Set<string>();
  for (const name of nameMap.keys()) {
    for (const token of name.split(/[^a-z0-9]+/)) if (token) nameTokens.add(token);
  }
  return { entities, names, nameTokens };
}

interface CleanLine {
  text: string;
  mentions: { index: number; subject: string }[];
}

/** Strip Markdown decoration while recording subject mentions by position. */
function cleanLine(raw: string, lexicon: SubjectLexicon): CleanLine {
  const decorated = raw
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`+/g, "")
    .replace(/(\*\*|__)/g, "")
    .replace(/(^|[^\w*])\*(?!\s)([^*]+)\*/g, "$1$2");
  const mentions: CleanLine["mentions"] = [];
  let text = "";
  let cursor = 0;
  for (const match of decorated.matchAll(WIKILINK_RE)) {
    const start = match.index ?? 0;
    text += decorated.slice(cursor, start);
    const stem = stemOf(match[1]);
    if (lexicon.entities.has(stem)) mentions.push({ index: text.length, subject: stem });
    text += (match[2] ?? match[1]).trim();
    cursor = start + match[0].length;
  }
  text += decorated.slice(cursor);
  const lower = text.toLowerCase();
  for (const { pattern, subject } of lexicon.names) {
    for (const match of lower.matchAll(pattern)) {
      const index = match.index ?? 0;
      if (!mentions.some((m) => Math.abs(m.index - index) < 2)) {
        mentions.push({ index, subject });
      }
    }
  }
  mentions.sort((left, right) => left.index - right.index);
  return { text, mentions };
}

const QUALIFIER_HEADS = "series|fund|phase|round|tranche|class|stage|tier";
const QUALIFIER_RE = new RegExp(
  `\\b(${QUALIFIER_HEADS})\\s+(iv|v?i{1,3}|v|[a-z]|\\d{1,2})(?![a-z0-9])`,
  "g"
);

/**
 * Terms describing what a quantity measures. Identifiers such as "Series A"
 * or "Fund II" are joined into qualifier terms ("series-a", "fund-ii") that
 * both strengthen and disambiguate a match.
 */
function termsOf(text: string, exclude: Set<string>, periodText = text): string[] {
  const normalized = text
    .toLowerCase()
    .replace(QUALIFIER_RE, "$1-$2")
    .replace(/[$£€]\s?[\d.,]+\s?(?:thousand|million|billion|mm|mn|bn|k|m|b)?\+?/g, " ");
  const terms = new Set<string>();
  if (SHARE_SCOPE_RE.test(periodText)) terms.add("scope:share");
  for (const period of periodText.toLowerCase().match(PERIOD_RE) || []) {
    terms.add(`period:${period.replace(/\s+/g, "")}`);
  }
  for (const word of normalized.match(/[a-z][a-z0-9-]*[a-z0-9]/g) || []) {
    if (word.length < 3 && !isQualifier(word)) continue;
    if (STOPWORDS.has(word) || exclude.has(word)) continue;
    terms.add(word);
  }
  return [...terms];
}

/**
 * Words that change what an amount measures. A round size and a valuation
 * quoted for the same round are different metrics, not a contradiction.
 */
const MEASURE_CLASSES: Record<string, string> = {
  valuation: "valuation",
  valued: "valuation",
  "pre-money": "valuation",
  "post-money": "valuation",
  premoney: "valuation",
  postmoney: "valuation",
  cap: "valuation",
  revenue: "revenue",
  revenues: "revenue",
  sales: "revenue",
  turnover: "revenue",
  arr: "revenue",
};

function measureClasses(terms: string[]): string {
  return [...new Set(terms.map((term) => MEASURE_CLASSES[term]).filter(Boolean))]
    .sort()
    .join(",");
}

/**
 * A participant's portion of a round ("NBGI portion: £2.5M") is a different
 * metric from the round size, for every figure in the clause.
 */
const SHARE_SCOPE_RE = /\b(?:portion|share|stake|participation)\b/i;

const PERIOD_RE = /\b(?:(?:19|20)\d{2}|q[1-4]|h[12]|fy\s?\d{2,4}|ytd)\b/g;

function periodsOf(terms: string[]): Set<string> {
  return new Set(terms.filter((term) => term.startsWith("period:")));
}

function isQualifier(term: string): boolean {
  return new RegExp(`^(${QUALIFIER_HEADS})-[a-z0-9]+$`).test(term);
}

/**
 * Two claims can only describe the same metric when their shared context is
 * specific: a shared qualifier ("series-a"), or at least two shared terms.
 * Conflicting qualifiers ("fund-i" vs "fund-ii") mean different metrics.
 */
export function sameMetric(leftTerms: string[], rightTerms: string[]): string[] | null {
  const qualifierMap = (terms: string[]) => {
    const map = new Map<string, Set<string>>();
    for (const term of terms.filter(isQualifier)) {
      const [head, ...rest] = term.split("-");
      const values = map.get(head) ?? new Set<string>();
      values.add(rest.join("-"));
      map.set(head, values);
    }
    return map;
  };
  if (measureClasses(leftTerms) !== measureClasses(rightTerms)) return null;
  if (leftTerms.includes("scope:share") !== rightTerms.includes("scope:share")) return null;
  const leftPeriods = periodsOf(leftTerms);
  const rightPeriods = periodsOf(rightTerms);
  if (
    leftPeriods.size > 0 &&
    rightPeriods.size > 0 &&
    ![...leftPeriods].some((period) => rightPeriods.has(period))
  ) {
    return null;
  }
  const leftQualifiers = qualifierMap(leftTerms);
  const rightQualifiers = qualifierMap(rightTerms);
  for (const [head, values] of leftQualifiers) {
    const other = rightQualifiers.get(head);
    if (other && ![...values].some((value) => other.has(value))) return null;
  }
  const right = new Set(rightTerms);
  const shared = leftTerms
    .filter((term) => right.has(term) && !term.includes(":"))
    .sort();
  if (shared.some(isQualifier) || shared.length >= 2) return shared;
  return null;
}

/** Clause span around `index`: split on punctuation separating distinct claims. */
function clauseBounds(text: string, index: number): [number, number] {
  const boundary = /[;|)\]]|\s[—–-]\s|,\s|\.\s/g;
  let start = 0;
  let end = text.length;
  for (const match of text.matchAll(boundary)) {
    const position = match.index ?? 0;
    if (position < index) start = position + match[0].length;
    else {
      end = position;
      break;
    }
  }
  return [start, end];
}

/**
 * A quantity's own context: its clause, narrowed so that words belonging to a
 * neighbouring quantity in the same clause are not attributed to this one
 * ("$360M+ including $245M Series D" must not tag $360M with "Series D").
 */
function ownContext(text: string, quantity: RawQuantity, all: RawQuantity[]): string {
  let [start, end] = clauseBounds(text, quantity.index);
  const qStart = quantity.index;
  const qEnd = quantity.index + quantity.length;
  for (const other of all) {
    if (other === quantity) continue;
    const otherEnd = other.index + other.length;
    if (otherEnd <= qStart && otherEnd > start) {
      start = otherEnd + splitShared(text.slice(otherEnd, qStart)).rightOffset;
    }
    if (other.index >= qEnd && other.index < end) {
      end = qEnd + splitShared(text.slice(qEnd, other.index)).leftLength;
    }
  }
  // The quantity itself (and its unit word) is not context.
  return `${text.slice(Math.min(start, qStart), qStart)} ${text.slice(qEnd, Math.max(end, qEnd))}`;
}

/**
 * Text between two quantities belongs to the left one up to the first
 * connector ("£9M Series A + £6M extension"; "$26M Series B to his $400M+")
 * and to the right one after it. Without a connector both keep all of it.
 */
function splitShared(between: string): { leftLength: number; rightOffset: number } {
  const connector = between.match(
    /\s(?:to|of|for|and|plus|including|incl\.?|with|from|vs\.?|versus|or|then|\+|&)\s/i
  );
  if (!connector || connector.index === undefined) {
    return { leftLength: between.length, rightOffset: 0 };
  }
  return {
    leftLength: connector.index,
    rightOffset: connector.index + connector[0].length,
  };
}

interface RawQuantity {
  index: number;
  length: number;
  raw: string;
  kind: ReconcileQuantityKind;
  unit: string;
  value: number;
  bound: ReconcileBound;
}

function findQuantities(text: string): RawQuantity[] {
  const found: RawQuantity[] = [];
  const taken: [number, number][] = [];
  const overlaps = (start: number, end: number) =>
    taken.some(([s, e]) => start < e && end > s);
  const add = (q: RawQuantity) => {
    if (!Number.isFinite(q.value) || overlaps(q.index, q.index + q.length)) return;
    taken.push([q.index, q.index + q.length]);
    found.push(q);
  };

  for (const m of text.matchAll(MONEY_RE)) {
    const scale = m[4] ? MONEY_SCALE[m[4].toLowerCase()] ?? 1 : 1;
    add({
      index: m.index ?? 0,
      length: m[0].length,
      raw: m[0].trim(),
      kind: "money",
      unit: CURRENCY[m[2].toLowerCase()] ?? m[2],
      value: parseNumber(m[3]) * scale,
      bound: boundFromPrefix(m[1], m[5]),
    });
  }
  for (const m of text.matchAll(PERCENT_RE)) {
    add({
      index: m.index ?? 0,
      length: m[0].length,
      raw: m[0].trim(),
      kind: "percent",
      unit: "%",
      value: parseNumber(m[2]),
      bound: boundFromPrefix(m[1], m[3]),
    });
  }
  for (const m of text.matchAll(MULTIPLE_RE)) {
    add({
      index: m.index ?? 0,
      length: m[0].length,
      raw: m[0].trim(),
      kind: "multiple",
      unit: "x",
      value: parseNumber(m[2]),
      bound: boundFromPrefix(m[1], m[3]),
    });
  }
  for (const m of text.matchAll(COUNT_RE)) {
    const value = parseNumber(m[2]);
    const unit = lemma(m[4]);
    if (unit.length < 2 || STOPWORDS.has(unit) || STOPWORDS.has(m[4].toLowerCase())) continue;
    if (IGNORED_COUNT_UNITS.has(unit)) continue;
    if (!m[2].includes(",") && value >= 1900 && value <= 2100) continue;
    add({
      index: m.index ?? 0,
      length: m[0].length,
      raw: m[0].trim(),
      kind: "count",
      unit,
      value,
      bound: boundFromPrefix(m[1], m[3]),
    });
  }
  return found.sort((left, right) => left.index - right.index);
}

function excerptOf(text: string, index: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= 220) return trimmed;
  const offset = text.length - text.trimStart().length;
  const center = Math.max(0, index - offset);
  const start = Math.max(0, center - 100);
  const end = Math.min(trimmed.length, center + 120);
  return `${start > 0 ? "…" : ""}${trimmed.slice(start, end).trim()}${end < trimmed.length ? "…" : ""}`;
}

function splitCells(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|");
}

function extractClaims(
  file: string,
  content: string,
  lexicon: SubjectLexicon
): ReconcileClaim[] {
  const claims: ReconcileClaim[] = [];
  const fileSubject = entityStem(file);
  const fallbackSubject =
    fileSubject && lexicon.entities.has(fileSubject) ? fileSubject : OWNER_SUBJECT;
  const lines = content.split("\n");
  let inFence = false;
  let headingSubject: string | null = null;
  let tableHeader: string[] | null = null;

  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i];
    if (/^\s*(```|~~~)/.test(rawLine)) {
      inFence = !inFence;
      continue;
    }
    if (inFence || !rawLine.trim()) {
      if (!rawLine.trim()) tableHeader = null;
      continue;
    }
    const heading = rawLine.match(/^(#{1,4})\s+(.+)/);
    if (heading) {
      const cleanedHeading = cleanLine(heading[2], lexicon);
      headingSubject = cleanedHeading.mentions[0]?.subject ?? null;
      tableHeader = null;
      continue;
    }

    const isTableRow = /^\s*\|/.test(rawLine);
    if (isTableRow && /^\s*\|?[\s:|-]+\|?\s*$/.test(rawLine)) {
      // Separator row: the previous line was the header.
      tableHeader = splitCells(lines[i - 1] ?? "").map((cell) => cleanLine(cell, lexicon).text);
      continue;
    }

    const cleaned = cleanLine(rawLine, lexicon);
    const quantities = findQuantities(cleaned.text);
    if (quantities.length === 0) continue;

    // Table cells take their column header as context; the rest of the row
    // only supplies the subject, because sibling cells describe other metrics.
    const leadingPipe = cleaned.text.trimStart().startsWith("|") ? 1 : 0;
    const headerFor = (index: number): string => {
      if (!isTableRow || !tableHeader) return "";
      const column = cleaned.text.slice(0, index).split("|").length - 1 - leadingPipe;
      return tableHeader[column] ?? "";
    };

    for (const quantity of quantities) {
      const preceding = cleaned.mentions.filter((m) => m.index < quantity.index);
      const subject =
        preceding[preceding.length - 1]?.subject ?? headingSubject ?? fallbackSubject;
      const context = `${headerFor(quantity.index)} ${ownContext(cleaned.text, quantity, quantities)}`;
      const exclude = lexicon.nameTokens;
      claims.push({
        file,
        line: i + 1,
        raw: quantity.raw,
        excerpt: excerptOf(cleaned.text, quantity.index),
        kind: quantity.kind,
        unit: quantity.unit,
        value: quantity.value,
        bound: quantity.bound,
        subject,
        // Periods ("2025", "Q1") scope the whole clause, not just this quantity.
        terms: termsOf(context, exclude, `${context} ${cleaned.text.slice(...clauseBounds(cleaned.text, quantity.index))}`),
      });
    }
  }
  return claims;
}

/** Returns null when compatible, otherwise the kind of disagreement. */
export function compareClaims(
  left: Pick<ReconcileClaim, "value" | "bound">,
  right: Pick<ReconcileClaim, "value" | "bound">
): ReconcileCandidate["relation"] | null {
  const tolerance = left.bound === "approx" || right.bound === "approx" ? 0.1 : 0.005;
  const scale = Math.max(Math.abs(left.value), Math.abs(right.value), 1e-9);
  if (Math.abs(left.value - right.value) <= tolerance * scale) return null;
  if (left.bound === "lower" && right.bound === "lower") return "different_lower_bounds";
  const fits = (bound: ReconcileBound, limit: number, value: number) =>
    bound === "lower" ? value >= limit : bound === "upper" ? value <= limit : false;
  if (left.bound === "lower" || left.bound === "upper") {
    if (right.bound === "exact" || right.bound === "approx") {
      return fits(left.bound, left.value, right.value) ? null : "different_values";
    }
  }
  if (right.bound === "lower" || right.bound === "upper") {
    if (left.bound === "exact" || left.bound === "approx") {
      return fits(right.bound, right.value, left.value) ? null : "different_values";
    }
  }
  if (left.bound !== right.bound && (left.bound === "lower" || right.bound === "lower")) {
    // One lower bound, one upper bound: compatible if the ranges overlap.
    const lower = left.bound === "lower" ? left.value : right.value;
    const upper = left.bound === "upper" ? left.value : right.value;
    return lower <= upper ? null : "different_values";
  }
  return "different_values";
}

function summarize(claim: ReconcileClaim): ReconcileCandidate["left"] {
  return {
    file: claim.file,
    line: claim.line,
    raw: claim.raw,
    excerpt: claim.excerpt,
    value: claim.value,
    bound: claim.bound,
  };
}

export function findReconcileCandidates(
  files: Map<string, string>,
  limit = RECONCILE_CANDIDATE_LIMIT
): ReconcileReport {
  const scanned = [...files.entries()].filter(([file]) => !isExcluded(file));
  const lexicon = buildLexicon(new Map(scanned));
  const claims = scanned.flatMap(([file, content]) => extractClaims(file, content, lexicon));

  const groups = new Map<string, ReconcileClaim[]>();
  for (const claim of claims) {
    const key = `${claim.subject}\u0000${claim.kind}\u0000${claim.unit}`;
    const group = groups.get(key) ?? [];
    group.push(claim);
    groups.set(key, group);
  }

  const candidates: ReconcileCandidate[] = [];
  for (const group of groups.values()) {
    for (let a = 0; a < group.length; a += 1) {
      for (let b = a + 1; b < group.length; b += 1) {
        const left = group[a];
        const right = group[b];
        if (left.file === right.file) continue;
        const sharedTerms = sameMetric(left.terms, right.terms);
        if (!sharedTerms) continue;
        const relation = compareClaims(left, right);
        if (!relation) continue;
        const [first, second] =
          left.file.localeCompare(right.file) <= 0 ? [left, right] : [right, left];
        candidates.push({
          subject: left.subject,
          kind: left.kind,
          unit: left.unit,
          relation,
          sharedTerms,
          left: summarize(first),
          right: summarize(second),
        });
      }
    }
  }

  candidates.sort(
    (x, y) =>
      y.sharedTerms.length - x.sharedTerms.length ||
      x.subject.localeCompare(y.subject) ||
      x.left.file.localeCompare(y.left.file) ||
      x.left.line - y.left.line ||
      x.right.file.localeCompare(y.right.file) ||
      x.right.line - y.right.line
  );
  return {
    mode: "advisory",
    filesScanned: scanned.length,
    claimsScanned: claims.length,
    candidates: candidates.slice(0, limit),
    omittedCandidates: Math.max(0, candidates.length - limit),
  };
}
