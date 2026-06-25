import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { IngestSchema, IngestCompleteSchema } from "../schemas/tools.js";
import {
  autoSyncEnabled,
  autoSyncMessage,
  maybeAutoSync,
} from "../services/auto-sync.js";
import {
  analyzeForIngest,
  resolveSourceContent,
  saveSource,
  recordIngest,
  deleteInboxFile,
} from "../services/ingest.js";
import {
  assertWriteRole,
  authorIdentity,
  resolveToolBrain,
} from "../services/request-context.js";

export function registerIngestTools(server: McpServer): void {
  server.tool(
    "brain_ingest",
    `Process a new source into the Brain. Use this whenever new substantive information surfaces — role changes, career updates, attached documents, factual corrections.

LARGE DOCUMENTS (over 500 words or non-text files):
1. Save the original file to sources/{category}/{YYYY-MM-DD}_{slug}.{ext} using Desktop Commander write_file
2. Save a markdown conversion alongside it as .md using Desktop Commander write_file
3. Call this tool with dry_run=true (NO content params) to get the analysis plan
4. Update Brain files, then call brain_ingest_complete with both file paths

SHORT TEXT (under 500 words): Pass source_content directly with dry_run=false.

NEVER pass large text as source_content — it will timeout the MCP transport.`,
    IngestSchema.shape,
    async ({ brain_id, source_content, source_path, source_label, category, dry_run }, extra) => {
      try {
        const ctx = await resolveToolBrain(brain_id, extra);
        if (dry_run) {
          const analysis = await analyzeForIngest(source_label, ctx.brainId);

          // If content was provided, include it (short text only)
          const contentSection =
            source_content || source_path
              ? await (async () => {
                  const content = await resolveSourceContent(
                    source_content,
                    source_path
                  );
                  return [
                    "",
                    "---",
                    "",
                    `## Source content (${content.length} chars):`,
                    "",
                    content,
                  ].join("\n");
                })()
              : "";

          return {
            content: [
              { type: "text", text: analysis.instructions + contentSection },
            ],
          };
        }

        // dry_run=false: save the source .md file
        assertWriteRole(ctx);
        const content = await resolveSourceContent(source_content, source_path);
        const savedPath = await saveSource(
          content,
          source_label,
          category,
          ctx.brainId
        );
        const sync = await maybeAutoSync(
          ctx.brainId,
          autoSyncMessage("SOURCE", source_label),
          authorIdentity(ctx)
        );

        const result = [
          `Source saved: \`${savedPath}\``,
          sync.trim(),
          "",
          "Next steps:",
          "1. Use `brain_read_file` and `brain_update_file` to update Brain files",
          "2. Call `brain_ingest_complete` with the source details and list of Brain files touched",
          autoSyncEnabled()
            ? "3. Hosted auto-sync is enabled; each successful write reports its sync status."
            : "3. Call `brain_commit` to commit all changes",
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
    "Record a completed ingest. Call this after saving the source and updating Brain files. Records provenance in SOURCES.md (original + markdown paths) and logs the ingest.",
    IngestCompleteSchema.shape,
    async ({ brain_id, source_label, category, original_file, md_file, files_touched, inbox_file }, extra) => {
      try {
        const ctx = await resolveToolBrain(brain_id, extra);
        assertWriteRole(ctx);
        const result = await recordIngest(
          source_label,
          category,
          md_file,
          files_touched,
          original_file,
          ctx.brainId
        );

        // Clean up inbox file if provided
        let inboxResult = "";
        if (inbox_file) {
          inboxResult = await deleteInboxFile(inbox_file, ctx.brainId);
        }
        const sync = await maybeAutoSync(
          ctx.brainId,
          autoSyncMessage("INGEST", source_label),
          authorIdentity(ctx)
        );

        return { content: [{ type: "text", text: result + inboxResult + sync }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: String(error) }],
          isError: true,
        };
      }
    }
  );
}
