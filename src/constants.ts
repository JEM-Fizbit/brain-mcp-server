import path from "node:path";
import os from "node:os";

export const BRAIN_DIR =
  process.env.BRAIN_DIR ||
  path.join(os.homedir(), "Projects", "ai-brain-jem", "brain");

/** Root of the sources/ directory (sibling to brain/). */
export const SOURCES_ROOT =
  process.env.BRAIN_SOURCES_DIR ||
  path.join(path.dirname(BRAIN_DIR), "sources");

export const CHARACTER_LIMIT = 50_000;
export const LOADER_FILE = "00_loader.md";
export const NOW_FILE = "NOW.md";
export const MAX_SEARCH_RESULTS = 50;
export const MAX_SEARCH_RESULTS_CEILING = 500;
export const SEARCH_LINE_CHAR_LIMIT = 5000;
export const SEARCH_TOTAL_CHAR_LIMIT = 150_000;
export const LOG_FILE = "LOG.md";
export const LINE_LIMIT = 200;

/** Operational/audit files exempt from the bloat check — growth is the design intent. */
export const BLOAT_EXEMPT = new Set<string>(["LOG.md", "SOURCES.md"]);

export const DOMAIN_PACK_LIMIT = 20;
export const LINT_NUDGE_DAYS = 30;
export const GITHUB_REPO =
  process.env.BRAIN_GITHUB_REPO || "JEM-Fizbit/ai-brain-jem";
export const LOG_OP_TYPES = [
  "INGEST",
  "UPDATE",
  "LINT",
  "CREATE",
  "SPLIT",
  "PRUNE",
] as const;
export type LogOpType = (typeof LOG_OP_TYPES)[number];

export const SOURCES_DIR = "sources";
export const SOURCES_INDEX = "SOURCES.md";
export const INBOX_DIR = "inbox";
export const SOURCE_CATEGORIES = [
  "bios",
  "cv",
  "career_history",
  "assessments",
  "writing_samples",
  "analysis",
  "meeting_notes",
  "correspondence",
  "personal",
  "research",
  "travel",
  "favourites",
  "photos",
  "other",
] as const;
export type SourceCategory = (typeof SOURCE_CATEGORIES)[number];

/** Staleness thresholds in days */
export const STALENESS = {
  NOW: 7,
  ACTIVE: 30,
  IDENTITY: 90,
  DEFAULT: 180,
} as const;

/** Files considered "active" for staleness checks */
export const ACTIVE_PATTERNS = [
  /^02_/,   // roles
  /^03_/,   // projects
  /^NOW\./,
];

/** Files considered "identity" for staleness checks */
export const IDENTITY_PATTERNS = [
  /^01_/,   // identity
  /^04_/,   // credentials
];

/** Section headers in 05_projects.md indicating inactive/non-priority projects (drift skip) */
export const INACTIVE_SECTION_PATTERNS = [
  /maintenance/i,
  /archived/i,
  /concept/i,
  /early.stage/i,
  /stable/i,
];

/**
 * Section headers in 05_projects.md indicating active projects that should be
 * cross-checked against NOW.md. Only projects under matching sections are
 * drift-checked; everything else (Stable, Concept, Infrastructure, Content,
 * Archived, etc.) is exempt by design.
 *
 * If 05_projects.md has no section matching any of these, runLint emits a
 * warning and falls back to INACTIVE_SECTION_PATTERNS filtering.
 */
export const ACTIVE_SECTION_PATTERNS = [/active/i];
