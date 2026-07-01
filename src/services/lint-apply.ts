/**
 * Orchestrates the mechanical `brain_lint` fixes: reads the relevant Brain files
 * through the active store, applies the pure transforms in `lint-fix.ts`, and
 * writes only the files that changed (revision-tracked, attributed,
 * conflict-guarded). Exposes three entrypoints over one core:
 *   - applyLintFixes         — all-or-nothing (tool/CLI/menubar)
 *   - planLintFixes          — read-only per-item plan (cockpit Fixes tab)
 *   - applyLintFixSelection  — apply only approved item ids (cockpit apply)
 */
import { LOADER_FILE, TASKS_FILE, TASKS_ARCHIVE_FILE } from "../constants.js";
import type { RevisionActor } from "../sync/types.js";
import { activeBrainStore } from "./active-brain-store.js";
import { runLint } from "./lint.js";
import {
  archiveOldDoneItems,
  bumpReviewedDate,
  indexOrphans,
  relocateCompletedTasks,
  stampDoneItems,
  type FixItem,
} from "./lint-fix.js";

export interface LintFixSummary {
  applied: boolean;
  dryRun: boolean;
  orphansIndexed: string[];
  tasksRelocated: string[];
  doneStamped: string[];
  doneArchived: string[];
  reviewedDateBumped: boolean;
  filesWritten: string[];
}

export interface LintFixPlan {
  items: FixItem[];
}

export interface LintFixSelectionResult {
  applied: boolean;
  filesWritten: string[];
  appliedIds: string[];
  staleIds: string[];
  reviewedDateBumped: boolean;
}

export interface ApplyLintFixesOptions {
  dryRun?: boolean;
  actor?: RevisionActor;
  thresholdDays?: number;
}

const REVIEWED_DATE_ID = "reviewed_date";
const REVIEW_LINE = /(\*\*Last reviewed:\*\*\s*)\d{4}-\d{2}-\d{2}/;

interface BrainState {
  loader: string | null;
  tasks: string | null;
  archive: string;
  orphans: string[];
}

interface ComputedFixes {
  items: FixItem[];
  loaderContent: string | null;
  tasksContent: string | null;
  archiveContent: string;
  appliedIds: string[];
  reviewedDateBumped: boolean;
}

async function readOrNull(brainId: string, filename: string): Promise<string | null> {
  try {
    return await activeBrainStore().readFile(brainId, filename);
  } catch {
    return null;
  }
}

async function readState(brainId: string): Promise<BrainState> {
  const report = await runLint(brainId);
  return {
    loader: await readOrNull(brainId, LOADER_FILE),
    tasks: await readOrNull(brainId, TASKS_FILE),
    archive: (await readOrNull(brainId, TASKS_ARCHIVE_FILE)) ?? "",
    orphans: report.orphans,
  };
}

/**
 * The single computation shared by plan and apply. `approved === undefined`
 * applies every candidate (all-or-nothing); a Set applies only matching ids; an
 * empty Set is the plan (items enumerated, content unchanged). The tasks fixes
 * run in sequence but stay item-independent: relocate stamps moved lines, so
 * done_stamp only touches pre-existing Done lines and done_archive only touches
 * pre-existing dated lines — the candidate id sets are the same whether computed
 * on the original content or through the chain.
 */
function computeFixes(
  state: BrainState,
  today: string,
  thresholdDays: number,
  approved: Set<string> | undefined
): ComputedFixes {
  const { loader, tasks, archive, orphans } = state;
  const items: FixItem[] = [];

  let loaderContent = loader;
  if (loader !== null) {
    const indexed = indexOrphans(loader, orphans, approved);
    loaderContent = indexed.content;
    items.push(...indexed.items);
  }

  let tasksContent = tasks;
  let archiveContent = archive;
  if (tasks !== null) {
    const relocated = relocateCompletedTasks(tasks, today, approved);
    items.push(...relocated.items);
    const stamped = stampDoneItems(relocated.content, today, approved);
    items.push(...stamped.items);
    const archived = archiveOldDoneItems(
      stamped.content,
      archive,
      today,
      thresholdDays,
      approved
    );
    items.push(...archived.items);
    tasksContent = archived.tasksContent;
    archiveContent = archived.archiveContent;
  }

  const appliedIds = items
    .filter((item) => approved === undefined || approved.has(item.id))
    .map((item) => item.id);
  const landedChange = appliedIds.length > 0;

  // Reviewed-date is a synthetic, gated item: offered only when other fixes
  // exist and the loader has the line; applied only when another fix landed.
  let reviewedDateBumped = false;
  const hasReviewLine = loader !== null && REVIEW_LINE.test(loader);
  if (items.length > 0 && hasReviewLine) {
    items.push({
      id: REVIEWED_DATE_ID,
      kind: "reviewed_date",
      file: LOADER_FILE,
      summary: `Bump loader "Last reviewed" to ${today}`,
      detail: `Update the loader Last reviewed date to ${today} (only when another fix lands).`,
    });
    const reviewedApproved = approved === undefined || approved.has(REVIEWED_DATE_ID);
    if (reviewedApproved && landedChange && loaderContent !== null) {
      const bumped = bumpReviewedDate(loaderContent, today);
      loaderContent = bumped.content;
      reviewedDateBumped = bumped.bumped;
      if (reviewedDateBumped) appliedIds.push(REVIEWED_DATE_ID);
    }
  }

  return { items, loaderContent, tasksContent, archiveContent, appliedIds, reviewedDateBumped };
}

function collectWrites(
  state: BrainState,
  computed: ComputedFixes
): Map<string, { content: string; oldContent?: string }> {
  const writes = new Map<string, { content: string; oldContent?: string }>();
  const { loader, tasks, archive } = state;
  const { loaderContent, tasksContent, archiveContent } = computed;
  if (loader !== null && loaderContent !== null && loaderContent !== loader) {
    writes.set(LOADER_FILE, { content: loaderContent, oldContent: loader });
  }
  if (tasks !== null && tasksContent !== null && tasksContent !== tasks) {
    writes.set(TASKS_FILE, { content: tasksContent, oldContent: tasks });
  }
  if (archiveContent !== archive) {
    writes.set(TASKS_ARCHIVE_FILE, {
      content: archiveContent,
      oldContent: archive === "" ? undefined : archive,
    });
  }
  return writes;
}

function countByKind(items: FixItem[], appliedIds: Set<string>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    if (!appliedIds.has(item.id)) continue;
    counts[item.kind] = (counts[item.kind] || 0) + 1;
  }
  return counts;
}

/** All-or-nothing apply, used by the MCP tool / CLI / menubar button. */
export async function applyLintFixes(
  brainId: string,
  today: string,
  options: ApplyLintFixesOptions = {}
): Promise<LintFixSummary> {
  const { dryRun = false, actor, thresholdDays = 30 } = options;
  const store = activeBrainStore();
  const state = await readState(brainId);
  const computed = computeFixes(state, today, thresholdDays, undefined);

  const byKind = (kind: string): string[] =>
    computed.items.filter((item) => item.kind === kind).map((item) => item.summary);

  const summary: LintFixSummary = {
    applied: false,
    dryRun,
    orphansIndexed: byKind("orphan_index"),
    tasksRelocated: byKind("task_relocate"),
    doneStamped: byKind("done_stamp"),
    doneArchived: byKind("done_archive"),
    reviewedDateBumped: computed.reviewedDateBumped,
    filesWritten: [],
  };

  const writes = collectWrites(state, computed);
  if (writes.size === 0 || dryRun) return summary;

  for (const [filename, { content, oldContent }] of writes) {
    await store.writeFile(brainId, filename, content, "replace", oldContent, actor);
    summary.filesWritten.push(filename);
  }
  await store.appendLog(
    brainId,
    "LINT",
    summary.filesWritten,
    `Applied mechanical fixes — ${summary.orphansIndexed.length} orphan(s) indexed, ` +
      `${summary.tasksRelocated.length} task(s) relocated, ` +
      `${summary.doneStamped.length} done-date(s) stamped, ` +
      `${summary.doneArchived.length} item(s) archived` +
      (summary.reviewedDateBumped ? ", reviewed date bumped" : ""),
    actor
  );
  summary.applied = true;
  return summary;
}

/** Read-only per-item plan for the cockpit Fixes tab. Never writes. */
export async function planLintFixes(
  brainId: string,
  today: string,
  thresholdDays = 30
): Promise<LintFixPlan> {
  const state = await readState(brainId);
  const computed = computeFixes(state, today, thresholdDays, new Set());
  return { items: computed.items };
}

/**
 * Apply only the approved item ids. Re-reads current Brain state and recomputes
 * the plan, so approved ids that no longer match a live candidate are ignored
 * (never applied) — a stale plan cannot write against changed content.
 */
export async function applyLintFixSelection(
  brainId: string,
  today: string,
  approvedIds: string[],
  options: { actor?: RevisionActor; thresholdDays?: number } = {}
): Promise<LintFixSelectionResult> {
  const { actor, thresholdDays = 30 } = options;
  const store = activeBrainStore();
  const approved = new Set(approvedIds);
  const state = await readState(brainId);
  const computed = computeFixes(state, today, thresholdDays, approved);

  const candidateIds = new Set(computed.items.map((item) => item.id));
  const staleIds = approvedIds.filter((id) => !candidateIds.has(id));

  const writes = collectWrites(state, computed);
  const result: LintFixSelectionResult = {
    applied: false,
    filesWritten: [],
    appliedIds: computed.appliedIds,
    staleIds,
    reviewedDateBumped: computed.reviewedDateBumped,
  };
  if (writes.size === 0) return result;

  for (const [filename, { content, oldContent }] of writes) {
    await store.writeFile(brainId, filename, content, "replace", oldContent, actor);
    result.filesWritten.push(filename);
  }

  const counts = countByKind(computed.items, new Set(computed.appliedIds));
  await store.appendLog(
    brainId,
    "LINT",
    result.filesWritten,
    `Applied selected fixes — ${counts.orphan_index || 0} orphan(s) indexed, ` +
      `${counts.task_relocate || 0} task(s) relocated, ` +
      `${counts.done_stamp || 0} done-date(s) stamped, ` +
      `${counts.done_archive || 0} item(s) archived` +
      (result.reviewedDateBumped ? ", reviewed date bumped" : ""),
    actor
  );
  result.applied = true;
  return result;
}
