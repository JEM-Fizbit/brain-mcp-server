import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ReadFileSchema } from "../schemas/tools.js";
import * as brain from "../services/brain.js";

export function registerContextTools(server: McpServer): void {
  server.tool(
    "brain_load_context",
    "Load the Brain loader (navigation table) and NOW.md — the entry point for every session. Returns the minimum context needed to orient and determine which additional files to request.",
    {},
    async () => {
      try {
        const content = await brain.loadContext();
        return { content: [{ type: "text", text: content }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: String(error) }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "brain_read_file",
    "Read a specific Brain file by name. Use after brain_load_context to fetch files referenced in the loader.",
    ReadFileSchema.shape,
    async ({ filename }) => {
      try {
        const content = await brain.readFile(filename);
        return { content: [{ type: "text", text: content }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: String(error) }],
          isError: true,
        };
      }
    }
  );
}
