import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ScanInboxSchema } from "../schemas/tools.js";
import { scanInbox } from "../services/inbox.js";
import { resolveToolBrain } from "../services/request-context.js";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function registerInboxTools(server: McpServer): void {
  server.tool(
    "brain_scan_inbox",
    "List files pending in a filesystem-backed Brain inbox. Hosted Postgres deployments use their documented operator ingestion workflow. Returns filenames, sizes, and dates when an inbox is available.",
    ScanInboxSchema.shape,
    async ({ brain_id }, extra) => {
      try {
        const ctx = await resolveToolBrain(brain_id, extra);
        if (
          ctx.brain.storage_backend !== "filesystem" ||
          !ctx.brain.storage_config.brain_dir
        ) {
          return {
            content: [
              {
                type: "text",
                text: [
                  `Server-side inbox scanning is unavailable for Postgres-backed Brain ${ctx.brainId}.`,
                  "The hosted MCP server has no Fly-local inbox directory for this Brain.",
                  "Use the deployment's operator ingestion workflow so source metadata and artifacts land in its authoritative stores.",
                ].join("\n"),
              },
            ],
          };
        }

        const files = await scanInbox(ctx.brainId);

        if (files.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "Inbox is empty. Drop files into the inbox/ folder (sibling to brain/) for processing.",
              },
            ],
          };
        }

        const rows = files.map(
          (f) =>
            `| ${f.name} | ${formatSize(f.size)} | ${f.modified.toISOString().split("T")[0]} |`
        );

        const result = [
          `## Brain Inbox: ${files.length} file(s) pending`,
          "",
          "| File | Size | Modified |",
          "|------|------|----------|",
          ...rows,
          "",
          "### Processing instructions",
          "For each file:",
          "1. Read the per-Brain operations guide named by `brain_load_context`",
          "2. Inspect/extract the source with an appropriate filesystem or document tool",
          "3. Call `brain_ingest` with `dry_run=true` when an inventory/analysis plan is useful",
          "4. Read and update the relevant Brain files",
          "5. Move the source and reviewed markdown companion to `sources/{category}/`",
          "6. Call `brain_ingest_complete` to record provenance and clean up the inbox copy",
          "7. Run `brain_lint` after the coordinated update",
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
}
