import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";

// Single source of truth for the server version: package.json. The health
// endpoint and MCP server info both report it — it is the operator's
// which-build-is-deployed tell, so it must never be hardcoded.
export const SERVER_VERSION: string = createRequire(import.meta.url)(
  "../package.json"
).version;

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
/**
 * Canonical projects file. MUST align with ACTIVE_PATTERNS (/^03_/) below so the
 * lint drift check and the staleness "active" tier reference the same file.
 * (Prior bug: drift read a hardcoded "03_projects.md" that no NN_ schema produces,
 * so drift detection was silently dead.)
 */
export const PROJECTS_FILE = "03_projects.md";
export const MAX_SEARCH_RESULTS = 50;
export const MAX_SEARCH_RESULTS_CEILING = 500;
export const SEARCH_LINE_CHAR_LIMIT = 5000;
export const SEARCH_TOTAL_CHAR_LIMIT = 150_000;
export const BOOTSTRAP_TOKEN_LIMIT = 2_500;
export const LOG_FILE = "LOG.md";
export const LINE_LIMIT = 200;

/** Operational/audit files exempt from the bloat check — growth is the design intent. */
export const BLOAT_EXEMPT = new Set<string>([
  "JOURNAL.md",
  "LOG.md",
  "SOURCES.md",
  "tasks-done.md",
]);

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

export const TASKS_FILE = "TASKS.md";
export const TASKS_ARCHIVE_FILE = "archive/tasks-done.md";

export const SOURCES_DIR = "sources";
export const SOURCES_INDEX = "SOURCES.md";
export const INBOX_DIR = "inbox";
export const WORKING_DIR = "working";
export const WORKING_INDEX_FILE = "INDEX.md";

/**
 * Journal rotation thresholds. JOURNAL.md is a durable narrative timeline; when
 * it exceeds either threshold the lint check surfaces a rotation reminder
 * pointing at `brain/archive/INDEX.md`. Size-triggered (not calendar-triggered)
 * so cadence auto-scales with actual volume. See JOURNAL.md 2026-05-13 entry.
 */
export const JOURNAL_FILE = "JOURNAL.md";
export const JOURNAL_ARCHIVE_DIR = "archive";
export const JOURNAL_ARCHIVE_INDEX = "INDEX.md";
export const JOURNAL_LINE_LIMIT = 500;
export const JOURNAL_BYTE_LIMIT = 80 * 1024;

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
export type SourceCategory = string;

/** Staleness thresholds in days */
export const STALENESS = {
  NOW: 7,
  ACTIVE: 30,
  IDENTITY: 90,
  DEFAULT: 180,
} as const;

/**
 * Staleness tiers are matched by SEMANTIC NAME, not number prefix, so any Brain's
 * numbering works (e.g. the JEM Brain's projects file is 05_projects.md, not 03_;
 * its roles file is 04_active_roles.md). NOW.md is handled separately by exact name
 * in getStalenessThreshold. Matching is substring/case-insensitive on the basename.
 */
/** "Active" tier — fast-changing content (projects, roles, current focus). */
export const ACTIVE_PATTERNS = [
  /projects?/i,
  /roles?/i,
  /active/i,
];

/** "Identity" tier — slow-changing self/credential content. */
export const IDENTITY_PATTERNS = [
  /identity/i,
  /credentials?/i,
];

/** Section headers in the projects file indicating inactive/non-priority projects (drift skip) */
export const INACTIVE_SECTION_PATTERNS = [
  /maintenance/i,
  /archived/i,
  /concept/i,
  /early.stage/i,
  /stable/i,
];

/**
 * Section headers in the projects file indicating active projects that should be
 * cross-checked against NOW.md. Only projects under matching sections are
 * drift-checked; everything else (Stable, Concept, Infrastructure, Content,
 * Archived, etc.) is exempt by design.
 *
 * If 03_projects.md has no section matching any of these, runLint emits a
 * warning and falls back to INACTIVE_SECTION_PATTERNS filtering.
 */
export const ACTIVE_SECTION_PATTERNS = [/active/i];
