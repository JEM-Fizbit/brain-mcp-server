import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerContextTools } from "./context.js";
import { registerUpdateTools } from "./update.js";
import { registerStatusTools } from "./status.js";

export function registerAllTools(server: McpServer): void {
  registerContextTools(server);
  registerUpdateTools(server);
  registerStatusTools(server);
}
