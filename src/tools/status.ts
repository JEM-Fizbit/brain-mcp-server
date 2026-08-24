import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SearchSchema, ListSourcesSchema, ListFilesSchema } from "../schemas/tools.js";
import {
  MAX_SEARCH_RESULTS_CEILING,
  SEARCH_LINE_CHAR_LIMIT,
  SEARCH_TOTAL_CHAR_LIMIT,
} from "../constants.js";
import type { SearchResult } from "../search-ranking.js";
import * as git from "../services/git.js";
import {
  activeBrainStore,
  activeStoreStatus,
  asFileMetadata,
  revisionStoreModeEnabled,
} from "../services/active-brain-store.js";
import { resolveToolBrain } from "../services/request-context.js";

export function registerStatusTools(server: McpServer): void {
  server.tool(
    "brain_list_files",
    "List all Brain files with metadata: line count, last modified date, size, and staleness warnings.",
    ListFilesSchema.shape,
    async ({ brain_id }, extra) => {
      try {
        const ctx = await resolveToolBrain(brain_id, extra);
        const files = asFileMetadata(
          await activeBrainStore().listFiles(ctx.brainId)
        );
        const statusFooter = revisionStoreModeEnabled()
          ? activeStoreStatus()
          : await git.getStatusForBrain(ctx.brainId);

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
        const result = `${table}\n\n---\n${statusFooter}`;
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
    'Ranked structured search for a keyword or lookup phrase. Results include deterministic scores and mechanism codes. By default searches knowledge files and excludes LOG.md, JOURNAL.md, archive/**, and working/**; pass include_operational=true only when history/operations are intended. Pass scope="sources" for original ingested documents, or scope="all" for both. Default max_results is 50 (ceiling 500).',
    SearchSchema.shape,
    async ({ brain_id, query, scope, max_results, include_operational }, extra) => {
      try {
        const ctx = await resolveToolBrain(brain_id, extra);
        const results = await activeBrainStore().searchFiles(
          ctx.brainId,
          query,
          { scope, maxResults: max_results, includeOperational: include_operational }
        );
        const result = formatSearchResults(results, query, scope, max_results);
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
    "List files in the sources archive. Optionally filter by a category returned by brain_prepare_ingest for the selected Brain. Use to discover ingested material before calling brain_read_file with scope=\"sources\".",
    ListSourcesSchema.shape,
    async ({ brain_id, category }, extra) => {
      try {
        const ctx = await resolveToolBrain(brain_id, extra);
        const files = await activeBrainStore().listSources(ctx.brainId, category);
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

function formatSearchResults(
  results: SearchResult[],
  query: string,
  scope: "brain" | "sources" | "all",
  cap: number
): string {
  const scopeLabel =
    scope === "brain" ? "Brain" : scope === "sources" ? "sources" : "Brain + sources";
  if (results.length === 0) return `No matches found for "${query}" in ${scopeLabel}`;

  const lines: string[] = [];
  let chars = 0;
  let trimmedLines = 0;
  let stoppedByBudget = false;
  for (const result of results) {
    const raw = result.line.trim();
    const shown = raw.length > SEARCH_LINE_CHAR_LIMIT
      ? `${raw.slice(0, SEARCH_LINE_CHAR_LIMIT)}…`
      : raw;
    if (shown.length < raw.length) trimmedLines += 1;
    const location = result.lineNumber > 0
      ? `${result.filename}:${result.lineNumber}`
      : result.filename;
    const entry = `${location}: ${shown} [score=${result.score.toFixed(4)}; ${result.mechanism}]`;
    if (chars + entry.length + 1 > SEARCH_TOTAL_CHAR_LIMIT) {
      stoppedByBudget = true;
      break;
    }
    lines.push(entry);
    chars += entry.length + 1;
  }

  const notes: string[] = [];
  if (stoppedByBudget) {
    notes.push(
      `Results truncated at ${Math.round(SEARCH_TOTAL_CHAR_LIMIT / 1000)}KB total size — narrow your query for full coverage.`
    );
  } else if (results.length >= cap) {
    notes.push(
      `Results truncated at ${cap} matches — raise max_results (ceiling ${MAX_SEARCH_RESULTS_CEILING}) or narrow your query.`
    );
  }
  if (trimmedLines > 0) {
    notes.push(
      `${trimmedLines} line${trimmedLines === 1 ? "" : "s"} trimmed at ${SEARCH_LINE_CHAR_LIMIT} chars.`
    );
  }
  return [
    `Found ${lines.length} ranked matches for "${query}" in ${scopeLabel}:`,
    "",
    ...lines,
    ...(notes.length ? ["", `(${notes.join(" ")})`] : []),
  ].join("\n");
}
