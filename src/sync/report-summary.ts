import type { LocalSyncReport } from "./types.js";

/**
 * Compact, operator-facing summary of a sync cycle for the health file and
 * watch log. Deletions and any tripped guard are surfaced explicitly so a
 * skipped mass-delete or an unhealthy-folder abort is never silent (spec 011).
 */
export function summarizeReport(report: LocalSyncReport) {
  const totalTiming = report.timings.find(
    (timing) => timing.operation === "sync" && timing.phase === "total"
  );
  return {
    pushed: report.pushed.length,
    pulled: report.pulled.length,
    unchanged: report.unchanged.length,
    conflicts: report.conflicts.length,
    conflictFiles: report.conflicts.map((conflict) => conflict.filename),
    deleted: report.deleted.length,
    deletedFiles: report.deleted,
    deletionsSkipped: report.deletionsSkipped.length,
    deletionsSkippedFiles: report.deletionsSkipped,
    guardTripped: report.guardTripped,
    totalMs: totalTiming?.ms ?? null,
  };
}
