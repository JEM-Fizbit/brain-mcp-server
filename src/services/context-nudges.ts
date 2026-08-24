import { LINT_NUDGE_DAYS } from "../constants.js";
import type { OpenIssue } from "./issues.js";
import type { CaptureQueueStatus } from "./task-intake.js";

/**
 * Inputs for the session-start nudge block appended to brain_load_context.
 *
 * Every field distinguishes "known to be empty" from "could not be determined
 * on this backend". A nudge is only emitted for a signal we actually measured,
 * so a Brain whose backend cannot answer a question stays silent about it
 * rather than implying an all-clear.
 */
export interface ContextNudgeInputs {
  /** Date of the most recent LINT entry in LOG.md, or null if there is none. */
  lastLint: Date | null;
  /** False when LOG.md could not be read at all — suppresses the lint nudge. */
  lintKnown: boolean;
  /** Open GitHub maintenance issues; empty when unavailable or none are open. */
  issues: OpenIssue[];
  /** Pending inbox file count, or null when the backend has no host inbox. */
  inboxCount: number | null;
  /** Capture / Triage Queue status, or null when within thresholds. */
  captureQueue: CaptureQueueStatus | null;
}

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Build the nudge lines for a session bootstrap. Pure: no I/O, no clock reads
 * beyond the injected `now`, so the thresholds are directly testable.
 */
export function buildContextNudges(
  input: ContextNudgeInputs,
  now = new Date()
): string[] {
  const parts: string[] = [];

  // Lint staleness. Suppressed entirely when LOG.md was unreadable — an
  // unreadable log is not evidence that lint has never run.
  if (input.lintKnown) {
    if (!input.lastLint) {
      parts.push(
        "",
        "⚠️ brain_lint has never been run. Consider running brain_lint to check Brain health."
      );
    } else {
      const daysSince = daysBetween(input.lastLint, now);
      if (daysSince > LINT_NUDGE_DAYS) {
        parts.push(
          "",
          `⚠️ Last brain_lint was ${daysSince} days ago. Consider running brain_lint before proceeding.`
        );
      }
    }
  }

  // Capture / Triage Queue. summarizeCaptureQueue returns null unless a
  // threshold is breached, so any status here is already actionable.
  if (input.captureQueue) {
    const { openCount, staleCount, oldestOpenDays, thresholdDays, thresholdCount } =
      input.captureQueue;
    const detail =
      staleCount > 0
        ? `${staleCount} of them stale (>= ${thresholdDays} days${
            oldestOpenDays === null ? "" : `; oldest ${oldestOpenDays} days`
          })`
        : `queue is at or above the ${thresholdCount}-item review threshold`;
    parts.push(
      "",
      `🗂️ TASKS.md Capture / Triage Queue has ${openCount} open item(s) — ${detail}.`,
      "This queue is transit, not an owner. Route each item to TASKS.md, the owning project BACKLOG.md, Asana, or an audit backlog, then remove it."
    );
  }

  // Open maintenance issues.
  if (input.issues.length > 0) {
    parts.push(
      "",
      `📋 ${input.issues.length} open Brain maintenance issue(s) requiring review:`
    );
    for (const issue of input.issues) {
      parts.push(`  - #${issue.number}: ${issue.title} — ${issue.url}`);
    }
    parts.push(
      "",
      "Ask John if he'd like to review and address these now. With explicit approval, read the issue, implement fixes, and commit/push."
    );
  }

  // Pending inbox files. Only when a count was actually obtained.
  if (input.inboxCount !== null && input.inboxCount > 0) {
    parts.push(
      "",
      `📥 ${input.inboxCount} file(s) pending in Brain inbox. Use brain_scan_inbox to review, or wait for scheduled processing.`
    );
  }

  return parts;
}
