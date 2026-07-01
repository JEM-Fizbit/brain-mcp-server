/**
 * Mechanical, non-fabricating Brain fixes applied by `brain_lint({ fix: true })`
 * and the cockpit Fixes tab.
 *
 * Every function here is a PURE transform over Markdown content — no I/O, no
 * clock, no store. The caller passes `today` (YYYY-MM-DD) so behaviour is
 * deterministic and testable.
 *
 * Each transform enumerates the atomic changes it *could* make as `FixItem`s
 * (each with a stable `id`) and honours an optional `approved` set: when
 * `approved` is undefined it applies all candidates (the all-or-nothing default
 * used by the tool/CLI); when a Set is given it applies only items whose id is
 * in the set (per-item approval). Passing an empty Set yields the plan — items
 * listed, content unchanged. The tool layer wires these to the revision-backed
 * store; this module never writes.
 */

export type FixKind =
  | "orphan_index"
  | "task_relocate"
  | "done_stamp"
  | "done_archive"
  | "reviewed_date";

export interface FixItem {
  id: string;
  kind: FixKind;
  file: string;
  summary: string;
  detail: string;
}

const DONE_HEADING = /^##\s+Done\s*$/i;
const H2 = /^##\s/;
const LIST_ITEM = /^\s*[-*]\s+/;
/** Matches the Brain's existing completion convention: `(done YYYY-MM-DD ...)`. */
const DONE_DATE = /\(done\s+(\d{4}-\d{2}-\d{2})/;
/** A completed task checkbox line, e.g. `- [x] ...`. */
const COMPLETED_TASK = /^\s*[-*]\s+\[x\]\s/i;
const FENCE = /^\s*(```|~~~)/;

/** Deterministic short hash (djb2) for stable item ids across plan/re-plan. */
function hashKey(seed: string): string {
  let hash = 5381;
  for (let i = 0; i < seed.length; i += 1) {
    hash = ((hash << 5) + hash + seed.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16);
}

function makeId(kind: FixKind, seed: string): string {
  return `${kind}:${hashKey(seed)}`;
}

function isApproved(approved: Set<string> | undefined, id: string): boolean {
  return approved === undefined || approved.has(id);
}

function summarize(line: string, limit = 90): string {
  const trimmed = line.trim();
  return trimmed.length <= limit ? trimmed : `${trimmed.slice(0, limit)}…`;
}

export interface TransformResult {
  content: string;
  items: FixItem[];
  /** Ids of items this call actually applied (content-affecting) — never a no-op. */
  appliedIds: string[];
}

export interface ArchiveResult {
  tasksContent: string;
  archiveContent: string;
  items: FixItem[];
  appliedIds: string[];
}

export interface BumpResult {
  content: string;
  bumped: boolean;
}

/** Extract the `(done YYYY-MM-DD)` date from a line, or null if unstamped. */
export function parseDoneDate(line: string): string | null {
  const match = line.match(DONE_DATE);
  return match ? match[1] : null;
}

/** Whole-day difference between two YYYY-MM-DD strings (later - earlier). */
export function daysBetween(earlier: string, later: string): number {
  const toUtc = (date: string): number => {
    const [y, m, d] = date.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(later) - toUtc(earlier)) / 86_400_000);
}

/**
 * Walk lines tracking code-fence state and the current `## ` section heading.
 */
function annotateLines(content: string): {
  line: string;
  inFence: boolean;
  section: string | null;
}[] {
  const lines = content.split("\n");
  let inFence = false;
  let section: string | null = null;
  return lines.map((line) => {
    if (FENCE.test(line)) {
      inFence = !inFence;
      return { line, inFence: true, section };
    }
    if (!inFence && H2.test(line)) {
      section = line.replace(H2, "").trim();
    }
    return { line, inFence, section };
  });
}

function isDoneSection(section: string | null): boolean {
  return section !== null && /^done$/i.test(section);
}

function headingLevel(line: string): number | null {
  const match = line.match(/^(#{1,6})\s/);
  return match ? match[1].length : null;
}

/**
 * Index at the end of the section that starts at `headingIdx` — i.e. just
 * before the next heading of the same or higher level (or EOF), skipping
 * trailing blank lines so the entry stays inside the section.
 */
function sectionInsertIndex(lines: string[], headingIdx: number): number {
  const level = headingLevel(lines[headingIdx]) ?? 6;
  let insertAt = lines.length;
  for (let i = headingIdx + 1; i < lines.length; i += 1) {
    const lvl = headingLevel(lines[i]);
    if (lvl !== null && lvl <= level) {
      insertAt = i;
      break;
    }
  }
  while (insertAt > headingIdx + 1 && lines[insertAt - 1].trim() === "") {
    insertAt -= 1;
  }
  return insertAt;
}

/** Stamp dateless Done-section list items with `(done <today>)`. */
export function stampDoneItems(
  tasksContent: string,
  today: string,
  approved?: Set<string>
): TransformResult {
  const annotated = annotateLines(tasksContent);
  const items: FixItem[] = [];
  const appliedIds: string[] = [];
  const out = annotated.map(({ line, inFence, section }) => {
    if (inFence || !isDoneSection(section)) return line;
    if (!LIST_ITEM.test(line)) return line;
    if (parseDoneDate(line)) return line;
    const id = makeId("done_stamp", line.trim());
    items.push({
      id,
      kind: "done_stamp",
      file: "TASKS.md",
      summary: summarize(line),
      detail: `Stamp with (done ${today}): ${line.trim()}`,
    });
    if (isApproved(approved, id)) {
      appliedIds.push(id);
      return `${line} (done ${today})`;
    }
    return line;
  });
  return { content: out.join("\n"), items, appliedIds };
}

/**
 * Move `- [x]` lines out of non-Done sections into the Done section, stamping
 * each moved line with `(done <today>)` if it lacks a date. Stamping on move
 * keeps this fix self-contained: `done_stamp` then only ever covers pre-existing
 * Done lines, so the item sets never depend on each other's approval.
 */
export function relocateCompletedTasks(
  tasksContent: string,
  today: string,
  approved?: Set<string>
): TransformResult {
  const annotated = annotateLines(tasksContent);
  const items: FixItem[] = [];
  const appliedIds: string[] = [];
  const moved: string[] = [];
  const kept: string[] = [];

  for (const { line, inFence, section } of annotated) {
    if (!inFence && COMPLETED_TASK.test(line) && !isDoneSection(section)) {
      const id = makeId("task_relocate", line.trim());
      items.push({
        id,
        kind: "task_relocate",
        file: "TASKS.md",
        summary: summarize(line),
        detail: `Move into Done: ${line.trim()}`,
      });
      if (isApproved(approved, id)) {
        moved.push(parseDoneDate(line) ? line : `${line} (done ${today})`);
        appliedIds.push(id);
        continue;
      }
    }
    kept.push(line);
  }

  if (moved.length === 0) return { content: tasksContent, items, appliedIds };

  const doneIdx = kept.findIndex((line) => DONE_HEADING.test(line));
  if (doneIdx === -1) {
    const tail = kept.length && kept[kept.length - 1].trim() !== "" ? [""] : [];
    kept.push(...tail, "## Done", "", ...moved, "");
  } else {
    kept.splice(doneIdx + 1, 0, ...moved);
  }

  return { content: kept.join("\n"), items, appliedIds };
}

/** Move Done items stamped more than `thresholdDays` ago into the archive. */
export function archiveOldDoneItems(
  tasksContent: string,
  archiveContent: string,
  today: string,
  thresholdDays = 30,
  approved?: Set<string>
): ArchiveResult {
  const annotated = annotateLines(tasksContent);
  const items: FixItem[] = [];
  const appliedIds: string[] = [];
  const archived: string[] = [];
  const kept: string[] = [];

  for (const { line, inFence, section } of annotated) {
    if (!inFence && isDoneSection(section) && LIST_ITEM.test(line)) {
      const done = parseDoneDate(line);
      if (done && daysBetween(done, today) > thresholdDays) {
        const id = makeId("done_archive", line.trim());
        items.push({
          id,
          kind: "done_archive",
          file: "TASKS.md",
          summary: summarize(line),
          detail: `Archive (done ${done}, >${thresholdDays}d): ${line.trim()}`,
        });
        if (isApproved(approved, id)) {
          archived.push(line);
          appliedIds.push(id);
          continue;
        }
      }
    }
    kept.push(line);
  }

  if (archived.length === 0) {
    return { tasksContent, archiveContent, items, appliedIds };
  }

  const base = archiveContent.replace(/\s*$/, "");
  const nextArchive = `${base}\n${archived.join("\n")}\n`;
  return { tasksContent: kept.join("\n"), archiveContent: nextArchive, items, appliedIds };
}

/** Map an orphan filename to its loader "All Files" subheading. */
function orphanHeading(name: string): string {
  const base = name.split("/").pop() || name;
  if (name.includes("/")) return "Domain-Specific";
  if (/^(JOURNAL|TASKS|LOG)\.md$/i.test(base)) return "Operations";
  if (/^REF_/i.test(base)) return "Reference Data";
  if (/^\d{2}_/.test(base)) return "Core Context";
  return "Core Context";
}

/** Append loader entries for orphaned files under their category heading. */
/**
 * Resolve where an orphan's loader entry should go, portable across loader
 * structures: prefer the mapped `### <category>` subheading when it exists (JEM
 * loaders), else fall back to the "## All files" H2 section itself (loaders with
 * a flat inventory, e.g. the ERS Brain). Returns -1 when neither exists, so the
 * orphan is left unplaced rather than fabricating structure.
 */
function orphanInsertHeadingIndex(lines: string[], orphan: string): number {
  const category = orphanHeading(orphan);
  const subIdx = lines.findIndex(
    (line) => /^###\s/.test(line) && line.replace(/^###\s/, "").trim() === category
  );
  if (subIdx !== -1) return subIdx;
  return lines.findIndex((line) => /^##\s+all files\b/i.test(line));
}

export function indexOrphans(
  loaderContent: string,
  orphans: string[],
  approved?: Set<string>
): TransformResult {
  const items: FixItem[] = [];
  const appliedIds: string[] = [];
  if (orphans.length === 0) return { content: loaderContent, items, appliedIds };

  const lines = loaderContent.split("\n");

  for (const orphan of orphans) {
    const id = makeId("orphan_index", orphan);
    items.push({
      id,
      kind: "orphan_index",
      file: "00_loader.md",
      summary: `Index \`${orphan}\` into the loader`,
      detail: `Add \`${orphan}\` to the loader inventory as (description pending review).`,
    });
    if (!isApproved(approved, id)) continue;

    const headingIdx = orphanInsertHeadingIndex(lines, orphan);
    if (headingIdx === -1) continue; // no place to put it → leave unplaced, not applied

    const insertAt = sectionInsertIndex(lines, headingIdx);
    lines.splice(insertAt, 0, `- \`${orphan}\` — (description pending review)`);
    appliedIds.push(id);
  }

  return { content: lines.join("\n"), items, appliedIds };
}

/** Bump the loader "Last reviewed" line to today. */
export function bumpReviewedDate(loaderContent: string, today: string): BumpResult {
  const pattern = /(\*\*Last reviewed:\*\*\s*)\d{4}-\d{2}-\d{2}/;
  if (!pattern.test(loaderContent)) return { content: loaderContent, bumped: false };
  return { content: loaderContent.replace(pattern, `$1${today}`), bumped: true };
}
