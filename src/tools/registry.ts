import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DescribeBrainSchema, ListBrainsSchema } from "../schemas/tools.js";
import {
  describeBrainForExtra,
  listBrainsForExtra,
} from "../services/request-context.js";

export function registerRegistryTools(server: McpServer): void {
  server.tool(
    "brain_list_brains",
    "List Brains visible to the current principal, including role and template metadata.",
    ListBrainsSchema.shape,
    async (_args, extra) => {
      try {
        const brains = await listBrainsForExtra(extra);
        return {
          content: [{ type: "text", text: JSON.stringify(brains, null, 2) }],
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
    "brain_describe",
    "Describe one accessible Brain's registry metadata.",
    DescribeBrainSchema.shape,
    async ({ brain_id }, extra) => {
      try {
        const brain = await describeBrainForExtra(brain_id, extra);
        return {
          content: [{ type: "text", text: JSON.stringify(brain, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: String(error) }],
          isError: true,
        };
      }
    }
  );
}
