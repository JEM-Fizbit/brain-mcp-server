import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runLint, formatLintReport } from "../services/lint.js";
import * as log from "../services/log.js";

export function registerLintTools(server: McpServer): void {
  server.tool(
    "brain_lint",
    "Run a health check on the Brain. Detects bloat (>200 lines), stale files, orphans (unreferenced in loader), drift (NOW.md vs project/role files), large domain packs, and unindexed working binaries (non-markdown files in working/ missing from working/INDEX.md). Returns a report with suggested next steps.",
    {},
    async () => {
      try {
        const report = await runLint();
        const formatted = formatLintReport(report);

        // Auto-log the lint pass
        const issueCount =
          report.bloat.length +
          report.stale.length +
          report.orphans.length +
          report.drift.length +
          report.largeDomainPacks.length +
          report.unindexedWorkingBinaries.length;

        await log.appendLog(
          "LINT",
          ["(all files scanned)"],
          `Health check: ${issueCount} issue(s) found`
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
