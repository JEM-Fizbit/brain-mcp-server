import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { IngestSchema, IngestCompleteSchema } from "../schemas/tools.js";
import {
  analyzeForIngest,
  saveSource,
  recordIngest,
} from "../services/ingest.js";

export function registerIngestTools(server: McpServer): void {
  server.tool(
    "brain_ingest",
    "Process a new source into the Brain. With dry_run=true (default), returns an analysis plan showing all Brain files, available categories, and instructions. With dry_run=false, saves the source file to sources/{category}/ and returns the saved path. After updating Brain files, call brain_ingest_complete to record provenance.",
    IngestSchema.shape,
    async ({ source_content, source_label, category, dry_run }) => {
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

        // dry_run=false: save the source file
        const savedPath = await saveSource(
          source_content,
          source_label,
          category
        );

        const result = [
          `Source saved: \`${savedPath}\``,
          "",
          "Next steps:",
          "1. Use `brain_read_file` and `brain_update_file` to update Brain files",
          "2. Call `brain_ingest_complete` with the source details and list of Brain files touched",
          "3. Call `brain_commit` to commit all changes",
        ].join("\n");

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
    "brain_ingest_complete",
    "Record a completed ingest. Call this after saving the source (brain_ingest dry_run=false) and updating Brain files. Appends provenance to SOURCES.md and logs the ingest.",
    IngestCompleteSchema.shape,
    async ({ source_label, category, source_file, files_touched }) => {
      try {
        const result = await recordIngest(
          source_label,
          category,
          source_file,
          files_touched
        );
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
