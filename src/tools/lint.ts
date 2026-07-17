import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { LintSchema } from "../schemas/tools.js";
import { runLint, formatLintReport } from "../services/lint.js";
import {
  applyLintFixes,
  type LintFixSummary,
} from "../services/lint-apply.js";
import { brainDate } from "../services/date.js";
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
  detail("Completed tasks relocated to Done", summary.tasksRelocated);
  detail("Done items date-stamped", summary.doneStamped);
  detail("Old Done items archived", summary.doneArchived);
  if (!summary.dryRun && summary.filesWritten.length > 0) {
    lines.push(`- Files written: ${summary.filesWritten.join(", ")}`);
  }
  return lines.join("\n");
}

export function registerLintTools(server: McpServer): void {
  server.tool(
    "brain_lint",
    "Run a read-only Brain health check. Detects bloat, stale files, legacy or graph-reachability orphans (per-Brain mode), bootstrap budget excess, drift, large domain packs, unindexed working binaries, and journal rotation due. graph_shadow reports legacy/graph deltas without changing enforcement. Pass fix=true to apply only ordinary-content task relocation/date-stamping/Done archiving; lint never auto-edits 00_loader.md or NOW.md. dry_run=true previews fixes without writing.",
    LintSchema.shape,
    async ({ brain_id, fix, dry_run }, extra) => {
      try {
        const ctx = await resolveToolBrain(brain_id, extra);
        const report = await runLint(ctx.brainId);
        let formatted = formatLintReport(report);

        if (fix) {
          assertWriteRole(ctx);
          // The fix path logs its own LINT entry only when a change lands, so
          // it does not double-log with the detection auto-log below.
          const summary = await applyLintFixes(ctx.brainId, brainDate(), {
            dryRun: dry_run,
            actor: revisionActor(ctx),
            role: ctx.role,
          });
          formatted += "\n" + formatFixSummary(summary);
          return { content: [{ type: "text", text: formatted }] };
        }

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
