import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { LintSchema } from "../schemas/tools.js";
import { runLint, formatLintReport } from "../services/lint.js";
import * as log from "../services/log.js";
import { assertWriteRole, resolveToolBrain } from "../services/request-context.js";

export function registerLintTools(server: McpServer): void {
  server.tool(
    "brain_lint",
    "Run a health check on the Brain. Detects bloat (>200 lines), stale files, orphans (unreferenced in loader), drift (NOW.md vs project/role files), large domain packs, unindexed working binaries (non-markdown files in working/ missing from working/INDEX.md), and journal rotation due (JOURNAL.md past ~500 lines or ~80 KB — surfaces the rotation procedure in archive/INDEX.md). Returns a report with suggested next steps.",
    LintSchema.shape,
    async ({ brain_id }, extra) => {
      try {
        const ctx = await resolveToolBrain(brain_id, extra);
        assertWriteRole(ctx);
        const report = await runLint(ctx.brainId);
        const formatted = formatLintReport(report);

        // Auto-log the lint pass
        const issueCount =
          report.bloat.length +
          report.stale.length +
          report.orphans.length +
          report.drift.length +
          report.largeDomainPacks.length +
          report.unindexedWorkingBinaries.length +
          (report.journalRotation ? 1 : 0);

        await log.appendLog(
          "LINT",
          ["(all files scanned)"],
          `Health check: ${issueCount} issue(s) found`,
          ctx.brainId
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
