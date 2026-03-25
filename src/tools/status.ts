import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SearchSchema } from "../schemas/tools.js";
import * as brain from "../services/brain.js";
import * as git from "../services/git.js";

export function registerStatusTools(server: McpServer): void {
  server.tool(
    "brain_list_files",
    "List all Brain files with metadata: line count, last modified date, size, and staleness warnings.",
    {},
    async () => {
      try {
        const files = await brain.listFiles();
        const gitStatus = await git.getStatus();

        const header = "| File | Lines | Size | Last Modified | Status |";
        const separator = "|------|-------|------|---------------|--------|";

        const rows = files.map((f) => {
          const modified = f.lastModified.toISOString().split("T")[0];
          const status = f.staleDays
            ? `⚠️ ${f.staleDays}d stale`
            : "✓";
          const sizeKb =
            f.bytes >= 1024
              ? `${(f.bytes / 1024).toFixed(1)}KB`
              : `${f.bytes}B`;
          return `| ${f.name} | ${f.lines} | ${sizeKb} | ${modified} | ${status} |`;
        });

        const table = [header, separator, ...rows].join("\n");
        const result = `${table}\n\n---\n${gitStatus}`;
        return { content: [{ type: "text", text: result }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: String(error) }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "brain_search",
    "Search across all Brain files for a keyword or pattern (case-insensitive).",
    SearchSchema.shape,
    async ({ query }) => {
      try {
        const result = await brain.search(query);
        return { content: [{ type: "text", text: result }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: String(error) }],
          isError: true,
        };
      }
    }
  );
}
