import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { LogSchema, ReadLogSchema } from "../schemas/tools.js";
import * as log from "../services/log.js";

export function registerLogTools(server: McpServer): void {
  server.tool(
    "brain_log",
    "Append an entry to the Brain change log. Use after making updates to record what changed and why.",
    LogSchema.shape,
    async ({ opType, filesTouched, summary }) => {
      try {
        const result = await log.appendLog(opType, filesTouched, summary);
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
    "brain_read_log",
    "Read recent entries from the Brain change log. Shows what was ingested, updated, or linted and when.",
    ReadLogSchema.shape,
    async ({ limit }) => {
      try {
        const result = await log.readLog(limit);
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
