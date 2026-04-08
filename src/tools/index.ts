import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerContextTools } from "./context.js";
import { registerUpdateTools } from "./update.js";
import { registerStatusTools } from "./status.js";
import { registerLogTools } from "./log.js";
import { registerLintTools } from "./lint.js";
import { registerIngestTools } from "./ingest.js";
import { registerInboxTools } from "./inbox.js";

export function registerAllTools(server: McpServer): void {
  registerContextTools(server);
  registerUpdateTools(server);
  registerStatusTools(server);
  registerLogTools(server);
  registerLintTools(server);
  registerIngestTools(server);
  registerInboxTools(server);
}
