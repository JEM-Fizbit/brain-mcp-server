import { describeCapabilities } from "../services/capabilities.js";
import { activeBrainStore } from "../services/active-brain-store.js";
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
    "Describe one accessible Brain and its versioned operation capabilities, role requirements, effects, custody and preconditions before invoking tools. This read-only discovery does not change content or grant authority.",
    DescribeBrainSchema.shape,
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async ({ brain_id }, extra) => {
      try {
        const brain = await describeBrainForExtra(brain_id, extra);
        const result = { ...brain, capabilities: describeCapabilities(brain, brain.role, activeBrainStore().capabilities) };
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result };
      } catch (error) {
        return {
          content: [{ type: "text", text: String(error) }],
          isError: true,
        };
      }
    }
  );
}
