import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { IngestSchema, IngestCompleteSchema } from "../schemas/tools.js";
import {
  analyzeForIngest,
  resolveSourceContent,
  saveSource,
  recordIngest,
} from "../services/ingest.js";

export function registerIngestTools(server: McpServer): void {
  server.tool(
    "brain_ingest",
    "Process a new source into the Brain. Use this whenever new substantive information surfaces — role changes, career updates, attached documents, factual corrections — rather than making ad-hoc edits. IMPORTANT: For documents over 500 words, ALWAYS use source_path (absolute file path) instead of source_content to avoid MCP timeout. Write the content to a temp file first, then pass the path. source_content is only for short text (a few paragraphs). With dry_run=true (default), returns analysis plan. With dry_run=false, saves source to sources/{category}/. After updating Brain files, call brain_ingest_complete to record provenance.",
    IngestSchema.shape,
    async ({ source_content, source_path, source_label, category, dry_run }) => {
      try {
        const content = await resolveSourceContent(source_content, source_path);

        if (dry_run) {
          const analysis = await analyzeForIngest(source_label);
          const result = [
            analysis.instructions,
            "",
            "---",
            "",
            `## Source content to ingest (${content.length} chars):`,
            "",
            content,
          ].join("\n");

          return { content: [{ type: "text", text: result }] };
        }

        // dry_run=false: save the source file
        const savedPath = await saveSource(
          content,
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
