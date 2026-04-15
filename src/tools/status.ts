import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SearchSchema, ListSourcesSchema } from "../schemas/tools.js";
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
    'Search for a keyword or pattern (case-insensitive). By default searches Brain files only (fast, summarised knowledge). Pass scope="sources" to search the sources/ archive (original ingested documents), or scope="all" to search both. Escalate scope when the query concerns specific documents, correspondence, or when a brain-only search returns no matches on something expected to exist. Default max_results is 50 (ceiling 500); raise when the truncation footer indicates more matches exist. Per-line length is capped at 5000 chars (edge-case safety net; truncated lines end with … and the footer notes how many were trimmed).',
    SearchSchema.shape,
    async ({ query, scope, max_results }) => {
      try {
        const result = await brain.search(query, scope, max_results);
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
    "brain_list_sources",
    "List files in the sources/ archive. Optionally filter by category (bios, cv, assessments, meeting_notes, writing_samples, analysis, correspondence, personal, research, etc.). Use to discover what ingested material is available before calling brain_read_file with scope=\"sources\".",
    ListSourcesSchema.shape,
    async ({ category }) => {
      try {
        const files = await brain.listSources(category);
        const text =
          files.length > 0
            ? (category
                ? `Sources in ${category}/:\n`
                : "All sources:\n") + files.join("\n")
            : category
              ? `No source files in ${category}/.`
              : "No source files found.";
        return { content: [{ type: "text", text }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: String(error) }],
          isError: true,
        };
      }
    }
  );
}
