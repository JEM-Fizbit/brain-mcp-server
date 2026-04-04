import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { IngestSchema } from "../schemas/tools.js";
import { analyzeForIngest, recordIngest } from "../services/ingest.js";

export function registerIngestTools(server: McpServer): void {
  server.tool(
    "brain_ingest",
    "Process a new source into the Brain. With dry_run=true (default), returns an analysis plan showing all Brain files and instructions for Claude to determine what to update. With dry_run=false, logs the completed ingest.",
    IngestSchema.shape,
    async ({ source_content, source_label, dry_run }) => {
      try {
        if (dry_run) {
          const analysis = await analyzeForIngest(source_label);
          const result = [
            analysis.instructions,
            "",
            "---",
            "",
            "## Source content to ingest:",
            "",
            source_content,
          ].join("\n");

          return { content: [{ type: "text", text: result }] };
        }

        // dry_run=false: record the ingest
        // The source_content field contains a comma-separated list of files touched
        const filesTouched = source_content
          .split(",")
          .map((f) => f.trim())
          .filter(Boolean);
        const result = await recordIngest(source_label, filesTouched);
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
