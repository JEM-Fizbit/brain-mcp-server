import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  IngestSchema,
  IngestCompleteSchema,
  PrepareIngestSchema,
} from "../schemas/tools.js";
import {
  autoSyncEnabled,
  autoSyncMessage,
  maybeAutoSync,
} from "../services/auto-sync.js";
import {
  analyzeForIngest,
  assertConfiguredSourceCategory,
  resolveSourceContent,
  saveSource,
  recordIngest,
  deleteInboxFile,
} from "../services/ingest.js";
import { sourceCategoriesForBrain } from "../services/registry.js";
import { authorIdentity, resolveToolBrain } from "../services/request-context.js";
import { assertToolRole } from "../services/tool-authority.js";

export function registerIngestTools(server: McpServer): void {
  server.tool(
    "brain_prepare_ingest",
    "Read-only ingestion preflight. Call this before any source or Brain-content write. It reports the selected Brain's backend, exact source categories, current file inventory, supported operations, and the authoritative completion/verification path.",
    PrepareIngestSchema.shape,
    {
      title: "Prepare Brain ingestion",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async ({ brain_id, source_label }, extra) => {
      try {
        const ctx = await resolveToolBrain(brain_id, extra);
        const analysis = await analyzeForIngest(source_label, ctx.brain);
        const filesystem = ctx.brain.storage_backend === "filesystem";
        const categories = sourceCategoriesForBrain(ctx.brain);
        const capability = [
          `# Ingestion preflight: ${source_label}`,
          "",
          `- Brain: \`${ctx.brainId}\``,
          `- Backend: \`${ctx.brain.storage_backend}\``,
          `- Source categories: ${categories.map((item) => `\`${item}\``).join(", ")}`,
          `- Read-only analysis: supported`,
          `- Server source-path read/write: ${filesystem ? "supported" : "not supported"}`,
          `- Server inbox scan/cleanup: ${filesystem ? "supported" : "not supported"}`,
          `- \`brain_ingest_complete\`: ${filesystem ? "supported" : "not supported"}`,
          "",
          filesystem
            ? "Authoritative workflow: this server can save source Markdown, record SOURCES.md provenance, append the Brain log, and clean its own inbox after reviewed Brain updates."
            : "Authoritative workflow: use the selected Brain's local Monitor/operator workspace to preserve the source, update Postgres/Storage source metadata, and verify/clear the real inbox before Brain-content writes. Fly has no copy of that inbox or source tree. Return to hosted MCP only for reviewed Brain revision writes and revision-store logging; do not call the filesystem ingest mutation tools.",
          "",
          "This preflight made no writes and requires no content approval.",
          "",
          analysis.instructions,
        ].join("\n");
        return { content: [{ type: "text", text: capability }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: String(error) }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "brain_ingest",
    `Filesystem source-ingest mutation plus backward-compatible read-only analysis. Always call brain_prepare_ingest first. If preflight reports a Postgres backend, do not call this mutation path; use the selected Brain's operator source workflow before any Brain-content write.

LARGE DOCUMENTS (over 500 words or non-text files):
1. Follow brain_prepare_ingest and the per-Brain operations guide named by brain_load_context
2. Save a reviewed markdown conversion alongside it as .md
3. Call this tool with dry_run=true (no large content parameter) when an inventory/analysis plan is useful
4. Update Brain files, then call brain_ingest_complete with source paths and files touched

SHORT TEXT (under 500 words): Pass source_content directly with dry_run=false.

Use only a source category returned by brain_prepare_ingest for the selected Brain. Follow that Brain's operations guide for source authority, backlinks, output capture, and inbox cleanup.

NEVER pass large text, raw binary, base64, or hex as source_content.`,
    IngestSchema.shape,
    async ({ brain_id, source_content, source_path, source_label, category, dry_run }, extra) => {
      try {
        const ctx = await resolveToolBrain(brain_id, extra);
        assertToolRole(ctx, "brain_ingest");
        assertConfiguredSourceCategory(category, ctx.brain);
        if (dry_run) {
          const analysis = await analyzeForIngest(source_label, ctx.brain);

          // If content was provided, include it (short text only)
          const contentSection =
            source_content || source_path
              ? await (async () => {
                  if (source_path && ctx.brain.storage_backend !== "filesystem") {
                    throw new Error(
                      `Brain ${ctx.brainId} uses Postgres; Fly cannot read source_path. ` +
                        "This preflight made no writes. Use brain_prepare_ingest and the operator source workflow."
                    );
                  }
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
        if (ctx.brain.storage_backend !== "filesystem") {
          throw new Error(
            `Brain ${ctx.brainId} uses Postgres; brain_ingest source saving is unavailable on Fly. ` +
              "No writes occurred. Call brain_prepare_ingest and complete source/inbox custody in the selected Brain's operator workflow before any Brain-content write."
          );
        }
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
    "Complete a filesystem-backed ingest after source custody and reviewed Brain updates. Always call brain_prepare_ingest first. Postgres-backed Brains complete source provenance and inbox cleanup through their operator workflow; hosted Brain revision logging remains available through brain_log.",
    IngestCompleteSchema.shape,
    async ({ brain_id, source_label, category, original_file, md_file, files_touched, inbox_file }, extra) => {
      try {
        const ctx = await resolveToolBrain(brain_id, extra);
        assertToolRole(ctx, "brain_ingest_complete");
        assertConfiguredSourceCategory(category, ctx.brain);
        if (ctx.brain.storage_backend !== "filesystem") {
          throw new Error(
            `Brain ${ctx.brainId} uses Postgres; brain_ingest_complete cannot see its operator-side source tree or inbox. ` +
              "No writes occurred. Use brain_prepare_ingest and finish provenance plus inbox verification in the selected Brain's operator workflow; use brain_log only for the hosted Brain revision receipt."
          );
        }
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
