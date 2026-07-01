/**
 * Mechanical, non-fabricating Brain fixes applied by `brain_lint({ fix: true })`.
 *
 * Every function here is a PURE transform over Markdown content — no I/O, no
 * clock, no store. The caller passes `today` (YYYY-MM-DD) so behaviour is
 * deterministic and testable. The tool layer wires these to the revision-backed
 * BrainStore write path; this module never writes.
 *
 * The four fixes (spec docs/specs/009-brain-lint-apply-mode.md):
 *  A. indexOrphans          — add loader entries for unreferenced files
 *  B. archiveOldDoneItems   — move stamped-old Done items to the archive
 *  C. bumpReviewedDate      — bump the loader "Last reviewed" date (gated)
 *  D. relocateCompletedTasks — move `- [x]` lines into the Done section
 * plus the stamp-forward dating that makes B possible:
 *     stampDoneItems        — tag undated Done items with `(done today)`
 */

const DONE_HEADING = /^##\s+Done\s*$/i;
const H2 = /^##\s/;
const HEADING = /^#{1,6}\s/;
const LIST_ITEM = /^\s*[-*]\s+/;
/** Matches the Brain's existing completion convention: `(done YYYY-MM-DD ...)`. */
const DONE_DATE = /\(done\s+(\d{4}-\d{2}-\d{2})/;
/** A completed task checkbox line, e.g. `- [x] ...`. */
const COMPLETED_TASK = /^\s*[-*]\s+\[x\]\s/i;
const FENCE = /^\s*(```|~~~)/;

export interface StampResult {
  content: string;
  stamped: string[];
}

export interface RelocateResult {
  content: string;
  moved: string[];
}

export interface ArchiveResult {
  tasksContent: string;
  archiveContent: string;
  archived: string[];
}

export interface IndexOrphansResult {
  content: string;
  added: string[];
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
 * Yields each line with whether it sits inside a fence and its section title.
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
      const wasFence = inFence;
      inFence = !inFence;
      // The fence delimiter line itself is "inside" the fence for our purposes.
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

/** Stamp every dateless list item in the Done section with `(done <today>)`. */
export function stampDoneItems(tasksContent: string, today: string): StampResult {
  const annotated = annotateLines(tasksContent);
  const stamped: string[] = [];
  const out = annotated.map(({ line, inFence, section }) => {
    if (inFence || !isDoneSection(section)) return line;
    if (!LIST_ITEM.test(line)) return line;
    if (parseDoneDate(line)) return line;
    stamped.push(line.trim());
    return `${line} (done ${today})`;
  });
  return { content: out.join("\n"), stamped };
}

/** Move `- [x]` lines out of non-Done sections into the Done section. */
export function relocateCompletedTasks(tasksContent: string): RelocateResult {
  const annotated = annotateLines(tasksContent);
  const moved: string[] = [];
  const kept: string[] = [];

  for (const { line, inFence, section } of annotated) {
    if (!inFence && COMPLETED_TASK.test(line) && !isDoneSection(section)) {
      moved.push(line);
      continue;
    }
    kept.push(line);
  }

  if (moved.length === 0) return { content: tasksContent, moved: [] };

  // Insert the moved lines just under the `## Done` heading. If there is no
  // Done section, create one at the end.
  const doneIdx = kept.findIndex((line) => DONE_HEADING.test(line));
  if (doneIdx === -1) {
    const tail = kept.length && kept[kept.length - 1].trim() !== "" ? [""] : [];
    kept.push(...tail, "## Done", "", ...moved, "");
  } else {
    kept.splice(doneIdx + 1, 0, ...moved);
  }

  return { content: kept.join("\n"), moved: moved.map((l) => l.trim()) };
}

/** Move Done items stamped more than `thresholdDays` ago into the archive. */
export function archiveOldDoneItems(
  tasksContent: string,
  archiveContent: string,
  today: string,
  thresholdDays = 30
): ArchiveResult {
  const annotated = annotateLines(tasksContent);
  const archived: string[] = [];
  const kept: string[] = [];

  for (const { line, inFence, section } of annotated) {
    if (!inFence && isDoneSection(section) && LIST_ITEM.test(line)) {
      const done = parseDoneDate(line);
      if (done && daysBetween(done, today) > thresholdDays) {
        archived.push(line);
        continue;
      }
    }
    kept.push(line);
  }

  if (archived.length === 0) {
    return { tasksContent, archiveContent, archived: [] };
  }

  const base = archiveContent.replace(/\s*$/, "");
  const nextArchive = `${base}\n${archived.join("\n")}\n`;
  return {
    tasksContent: kept.join("\n"),
    archiveContent: nextArchive,
    archived: archived.map((l) => l.trim()),
  };
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
export function indexOrphans(
  loaderContent: string,
  orphans: string[]
): IndexOrphansResult {
  if (orphans.length === 0) return { content: loaderContent, added: [] };

  const lines = loaderContent.split("\n");
  const added: string[] = [];

  for (const orphan of orphans) {
    const heading = orphanHeading(orphan);
    const headingIdx = lines.findIndex(
      (line) => /^###\s/.test(line) && line.replace(/^###\s/, "").trim() === heading
    );
    if (headingIdx === -1) continue; // heading absent → skip (never fabricate structure)

    // Insertion point = end of this subsection (before the next heading or EOF),
    // skipping trailing blank lines so the entry stays inside the section.
    let insertAt = lines.length;
    for (let i = headingIdx + 1; i < lines.length; i += 1) {
      if (HEADING.test(lines[i])) {
        insertAt = i;
        break;
      }
    }
    while (insertAt > headingIdx + 1 && lines[insertAt - 1].trim() === "") {
      insertAt -= 1;
    }

    lines.splice(insertAt, 0, `- \`${orphan}\` — (description pending review)`);
    added.push(orphan);
  }

  return { content: lines.join("\n"), added };
}

/** Bump the loader "Last reviewed" line to today. */
export function bumpReviewedDate(loaderContent: string, today: string): BumpResult {
  const pattern = /(\*\*Last reviewed:\*\*\s*)\d{4}-\d{2}-\d{2}/;
  if (!pattern.test(loaderContent)) return { content: loaderContent, bumped: false };
  return {
    content: loaderContent.replace(pattern, `$1${today}`),
    bumped: true,
  };
}
