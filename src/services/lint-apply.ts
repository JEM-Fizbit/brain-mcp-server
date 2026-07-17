/**
 * Orchestrates the remaining ordinary-content `brain_lint` fixes. Structural
 * files are deliberately absent: spec 013 removed orphan indexing and loader
 * reviewed-date writes, so no fix plan or apply path can touch 00_loader.md or
 * NOW.md.
 */
import { TASKS_ARCHIVE_FILE, TASKS_FILE } from "../constants.js";
import type { RevisionActor } from "../sync/types.js";
import { activeBrainStore } from "./active-brain-store.js";
import type { BrainRole } from "./registry.js";
import {
  archiveOldDoneItems,
  relocateCompletedTasks,
  stampDoneItems,
  type FixItem,
} from "./lint-fix.js";

export interface LintFixSummary {
  applied: boolean;
  dryRun: boolean;
  tasksRelocated: string[];
  doneStamped: string[];
  doneArchived: string[];
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
}

export interface ApplyLintFixesOptions {
  dryRun?: boolean;
  actor?: RevisionActor;
  role?: BrainRole;
  thresholdDays?: number;
}

interface BrainState {
  tasks: string | null;
  archive: string;
}

interface ComputedFixes {
  items: FixItem[];
  tasksContent: string | null;
  archiveContent: string;
  appliedIds: string[];
}

async function readOrNull(brainId: string, filename: string): Promise<string | null> {
  try {
    return await activeBrainStore().readFile(brainId, filename);
  } catch {
    return null;
  }
}

async function readState(brainId: string): Promise<BrainState> {
  return {
    tasks: await readOrNull(brainId, TASKS_FILE),
    archive: (await readOrNull(brainId, TASKS_ARCHIVE_FILE)) ?? "",
  };
}

function computeFixes(
  state: BrainState,
  today: string,
  thresholdDays: number,
  approved: Set<string> | undefined
): ComputedFixes {
  const items: FixItem[] = [];
  const appliedIds: string[] = [];
  let tasksContent = state.tasks;
  let archiveContent = state.archive;

  if (state.tasks !== null) {
    const relocated = relocateCompletedTasks(state.tasks, today, approved);
    items.push(...relocated.items);
    appliedIds.push(...relocated.appliedIds);

    const stamped = stampDoneItems(relocated.content, today, approved);
    items.push(...stamped.items);
    appliedIds.push(...stamped.appliedIds);

    const archived = archiveOldDoneItems(
      stamped.content,
      state.archive,
      today,
      thresholdDays,
      approved
    );
    items.push(...archived.items);
    appliedIds.push(...archived.appliedIds);
    tasksContent = archived.tasksContent;
    archiveContent = archived.archiveContent;
  }

  return { items, tasksContent, archiveContent, appliedIds };
}

function collectWrites(
  state: BrainState,
  computed: ComputedFixes
): Map<string, { content: string; oldContent?: string }> {
  const writes = new Map<string, { content: string; oldContent?: string }>();
  if (
    state.tasks !== null &&
    computed.tasksContent !== null &&
    computed.tasksContent !== state.tasks
  ) {
    writes.set(TASKS_FILE, {
      content: computed.tasksContent,
      oldContent: state.tasks,
    });
  }
  if (computed.archiveContent !== state.archive) {
    writes.set(TASKS_ARCHIVE_FILE, {
      content: computed.archiveContent,
      oldContent: state.archive === "" ? undefined : state.archive,
    });
  }
  return writes;
}

function countByKind(
  items: FixItem[],
  appliedIds: ReadonlySet<string>
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    if (!appliedIds.has(item.id)) continue;
    counts[item.kind] = (counts[item.kind] || 0) + 1;
  }
  return counts;
}

export async function applyLintFixes(
  brainId: string,
  today: string,
  options: ApplyLintFixesOptions = {}
): Promise<LintFixSummary> {
  const { dryRun = false, actor, role, thresholdDays = 30 } = options;
  const store = activeBrainStore();
  const state = await readState(brainId);
  const computed = computeFixes(state, today, thresholdDays, undefined);
  const byKind = (kind: FixItem["kind"]): string[] =>
    computed.items
      .filter((item) => item.kind === kind)
      .map((item) => item.summary);

  const summary: LintFixSummary = {
    applied: false,
    dryRun,
    tasksRelocated: byKind("task_relocate"),
    doneStamped: byKind("done_stamp"),
    doneArchived: byKind("done_archive"),
    filesWritten: [],
  };
  const writes = collectWrites(state, computed);
  if (writes.size === 0 || dryRun) return summary;

  for (const [filename, { content, oldContent }] of writes) {
    await store.writeFile(
      brainId,
      filename,
      content,
      "replace",
      oldContent,
      actor,
      role
    );
    summary.filesWritten.push(filename);
  }
  await store.appendLog(
    brainId,
    "LINT",
    summary.filesWritten,
    `Applied mechanical fixes — ${summary.tasksRelocated.length} task(s) relocated, ` +
      `${summary.doneStamped.length} done-date(s) stamped, ` +
      `${summary.doneArchived.length} item(s) archived`,
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
  return {
    items: computeFixes(state, today, thresholdDays, new Set()).items,
  };
}

export async function applyLintFixSelection(
  brainId: string,
  today: string,
  approvedIds: string[],
  options: {
    actor?: RevisionActor;
    role?: BrainRole;
    thresholdDays?: number;
  } = {}
): Promise<LintFixSelectionResult> {
  const { actor, role, thresholdDays = 30 } = options;
  const store = activeBrainStore();
  const approved = new Set(approvedIds);
  const state = await readState(brainId);
  const computed = computeFixes(state, today, thresholdDays, approved);
  const candidateIds = new Set(computed.items.map((item) => item.id));
  const result: LintFixSelectionResult = {
    applied: false,
    filesWritten: [],
    appliedIds: computed.appliedIds,
    staleIds: approvedIds.filter((id) => !candidateIds.has(id)),
  };
  const writes = collectWrites(state, computed);
  if (writes.size === 0) return result;

  for (const [filename, { content, oldContent }] of writes) {
    await store.writeFile(
      brainId,
      filename,
      content,
      "replace",
      oldContent,
      actor,
      role
    );
    result.filesWritten.push(filename);
  }
  const counts = countByKind(computed.items, new Set(computed.appliedIds));
  await store.appendLog(
    brainId,
    "LINT",
    result.filesWritten,
    `Applied selected fixes — ${counts.task_relocate || 0} task(s) relocated, ` +
      `${counts.done_stamp || 0} done-date(s) stamped, ` +
      `${counts.done_archive || 0} item(s) archived`,
    actor
  );
  result.applied = true;
  return result;
}
