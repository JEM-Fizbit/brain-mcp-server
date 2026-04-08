import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ScanInboxSchema } from "../schemas/tools.js";
import { scanInbox } from "../services/inbox.js";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function registerInboxTools(server: McpServer): void {
  server.tool(
    "brain_scan_inbox",
    "List files pending in the Brain inbox. Drop files into the inbox/ folder for processing. Returns filenames, sizes, and dates.",
    ScanInboxSchema.shape,
    async () => {
      try {
        const files = await scanInbox();

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
          "1. Read the file content (use Desktop Commander for non-.md files)",
          "2. Call `brain_ingest` with `dry_run=true` to get the analysis plan",
          "3. Read relevant Brain files and determine what needs updating",
          "4. Update Brain files via `brain_update_file`",
          "5. Move the processed file to `sources/{category}/` via Desktop Commander",
          "6. Call `brain_ingest_complete` to record provenance",
          "7. Call `brain_commit` when done",
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
