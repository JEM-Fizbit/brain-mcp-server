import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { LintSchema } from "../schemas/tools.js";
import { runLint, formatLintReport } from "../services/lint.js";
import {
  applyLintFixes,
  type LintFixSummary,
} from "../services/lint-apply.js";
import { brainDate } from "../services/date.js";
import { activeBrainStore } from "../services/active-brain-store.js";
import {
  assertWriteRole,
  resolveToolBrain,
  revisionActor,
} from "../services/request-context.js";

function formatFixSummary(summary: LintFixSummary): string {
  const lines: string[] = [
    "",
    summary.dryRun
      ? "## Mechanical fixes — planned (dry run, nothing written)"
      : summary.applied
        ? "## Mechanical fixes — applied"
        : "## Mechanical fixes — nothing to fix",
  ];
  const detail = (label: string, items: string[]) => {
    if (items.length === 0) return;
    lines.push(`- ${label}: ${items.length}`);
    for (const item of items.slice(0, 10)) lines.push(`  - ${item}`);
    if (items.length > 10) lines.push(`  - ...and ${items.length - 10} more.`);
  };
  detail("Orphans indexed into loader", summary.orphansIndexed);
  detail("Completed tasks relocated to Done", summary.tasksRelocated);
  detail("Done items date-stamped", summary.doneStamped);
  detail("Old Done items archived", summary.doneArchived);
  if (summary.reviewedDateBumped) lines.push("- Loader Last reviewed date bumped");
  if (!summary.dryRun && summary.filesWritten.length > 0) {
    lines.push(`- Files written: ${summary.filesWritten.join(", ")}`);
  }
  return lines.join("\n");
}

export function registerLintTools(server: McpServer): void {
  server.tool(
    "brain_lint",
    "Run a health check on the Brain. Detects bloat (>200 lines), stale files, orphans (unreferenced in loader), drift (NOW.md vs project/role files), large domain packs, unindexed working binaries (non-markdown files in working/ missing from working/INDEX.md), and journal rotation due (JOURNAL.md past ~500 lines or ~80 KB — surfaces the rotation procedure in archive/INDEX.md). Returns a report with suggested next steps. Pass fix=true to apply the mechanical fixes (orphan indexing, completed-task relocation, Done archiving, reviewed-date bump); pass dry_run=true with fix to preview them without writing.",
    LintSchema.shape,
    async ({ brain_id, fix, dry_run }, extra) => {
      try {
        const ctx = await resolveToolBrain(brain_id, extra);
        assertWriteRole(ctx);
        const report = await runLint(ctx.brainId);
        let formatted = formatLintReport(report);

        if (fix) {
          // The fix path logs its own LINT entry only when a change lands, so
          // it does not double-log with the detection auto-log below.
          const summary = await applyLintFixes(ctx.brainId, brainDate(), {
            dryRun: dry_run,
            actor: revisionActor(ctx),
          });
          formatted += "\n" + formatFixSummary(summary);
          return { content: [{ type: "text", text: formatted }] };
        }

        // Auto-log the lint pass (detection-only runs)
        const issueCount =
          report.bloat.length +
          report.stale.length +
          report.orphans.length +
          report.drift.length +
          report.largeDomainPacks.length +
          report.unindexedWorkingBinaries.length +
          (report.journalRotation ? 1 : 0) +
          (report.captureQueue ? 1 : 0);

        await activeBrainStore().appendLog(
          ctx.brainId,
          "LINT",
          ["(all files scanned)"],
          `Health check: ${issueCount} issue(s) found`,
          revisionActor(ctx)
        );

        return { content: [{ type: "text", text: formatted }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: String(error) }],
          isError: true,
        };
      }
    }
  );
}
