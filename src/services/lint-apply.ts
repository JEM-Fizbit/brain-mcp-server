/**
 * Orchestrates the mechanical `brain_lint({ fix: true })` fixes: reads the
 * relevant Brain files through the active store, applies the pure transforms in
 * `lint-fix.ts`, and writes only the files that changed (revision-tracked,
 * attributed, conflict-guarded). Silent no-op when nothing matches.
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

export interface ApplyLintFixesOptions {
  dryRun?: boolean;
  actor?: RevisionActor;
  thresholdDays?: number;
}

async function readOrNull(brainId: string, filename: string): Promise<string | null> {
  try {
    return await activeBrainStore().readFile(brainId, filename);
  } catch {
    return null;
  }
}

export async function applyLintFixes(
  brainId: string,
  today: string,
  options: ApplyLintFixesOptions = {}
): Promise<LintFixSummary> {
  const { dryRun = false, actor, thresholdDays = 30 } = options;
  const store = activeBrainStore();

  const report = await runLint(brainId);
  const loader = await readOrNull(brainId, LOADER_FILE);
  const tasks = await readOrNull(brainId, TASKS_FILE);
  const archive = (await readOrNull(brainId, TASKS_ARCHIVE_FILE)) ?? "";

  const summary: LintFixSummary = {
    applied: false,
    dryRun,
    orphansIndexed: [],
    tasksRelocated: [],
    doneStamped: [],
    doneArchived: [],
    reviewedDateBumped: false,
    filesWritten: [],
  };

  // Pending writes: filename -> { content, oldContent }.
  const writes = new Map<string, { content: string; oldContent?: string }>();

  // A. Orphan indexing (+ C. reviewed-date bump, gated on a landed change).
  let loaderContent = loader;
  if (loader !== null) {
    const indexed = indexOrphans(loader, report.orphans);
    loaderContent = indexed.content;
    summary.orphansIndexed = indexed.added;
  }

  // D + stamp + B, all operating on TASKS.md in sequence.
  let tasksContent = tasks;
  let archiveContent = archive;
  if (tasks !== null) {
    const relocated = relocateCompletedTasks(tasks);
    summary.tasksRelocated = relocated.moved;

    const stamped = stampDoneItems(relocated.content, today);
    summary.doneStamped = stamped.stamped;

    const archived = archiveOldDoneItems(
      stamped.content,
      archive,
      today,
      thresholdDays
    );
    summary.doneArchived = archived.archived;
    tasksContent = archived.tasksContent;
    archiveContent = archived.archiveContent;
  }

  const landedTaskChange =
    summary.tasksRelocated.length > 0 ||
    summary.doneStamped.length > 0 ||
    summary.doneArchived.length > 0;
  const landedChange = summary.orphansIndexed.length > 0 || landedTaskChange;

  // C. Bump the loader "Last reviewed" date only when a real change landed.
  if (loader !== null && loaderContent !== null && landedChange) {
    const bumped = bumpReviewedDate(loaderContent, today);
    loaderContent = bumped.content;
    summary.reviewedDateBumped = bumped.bumped;
  }

  if (loader !== null && loaderContent !== null && loaderContent !== loader) {
    writes.set(LOADER_FILE, { content: loaderContent, oldContent: loader });
  }
  if (tasks !== null && tasksContent !== null && tasksContent !== tasks) {
    writes.set(TASKS_FILE, { content: tasksContent, oldContent: tasks });
  }
  if (summary.doneArchived.length > 0) {
    writes.set(TASKS_ARCHIVE_FILE, {
      content: archiveContent,
      // Preserve optimistic concurrency for an existing archive; omit the guard
      // when creating it for the first time.
      oldContent: archive === "" ? undefined : archive,
    });
  }

  if (writes.size === 0) return summary;

  if (dryRun) {
    // Report the plan; write nothing.
    return summary;
  }

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
