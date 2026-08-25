import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  SemanticIndexSchema,
  SemanticSearchSchema,
} from "../schemas/tools.js";
import { indexSources, semanticSearch } from "../services/semantic.js";
import { resolveToolBrain } from "../services/request-context.js";
import { assertToolRole } from "../services/tool-authority.js";

export function registerSemanticTools(server: McpServer): void {
  server.tool(
    "brain_semantic_index",
    "Build or refresh the read-only semantic index over sources/ for one Brain.",
    SemanticIndexSchema.shape,
    async ({ brain_id }, extra) => {
      try {
        const ctx = await resolveToolBrain(brain_id, extra);
        assertToolRole(ctx, "brain_semantic_index");
        const result = await indexSources(ctx.brainId);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: String(error) }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "brain_semantic_search",
    "Search semantically across indexed sources/ chunks. This is read-only and does not modify Brain Markdown.",
    SemanticSearchSchema.shape,
    async ({ brain_id, query, top_k }, extra) => {
      try {
        const ctx = await resolveToolBrain(brain_id, extra);
        const results = await semanticSearch(ctx.brainId, query, top_k);
        if (results.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `No semantic matches found for "${query}" in sources/.`,
              },
            ],
          };
        }

        const text = results
          .map((result, index) => {
            const heading = result.heading ? ` (${result.heading})` : "";
            return [
              `## ${index + 1}. ${result.filename}${heading}`,
              `Score: ${result.score.toFixed(4)}`,
              "",
              result.text,
            ].join("\n");
          })
          .join("\n\n---\n\n");

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
