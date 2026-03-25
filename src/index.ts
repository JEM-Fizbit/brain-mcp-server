import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerAllTools } from "./tools/index.js";
import { BRAIN_DIR } from "./constants.js";

const server = new McpServer({
  name: "brain-mcp-server",
  version: "1.0.0",
});

registerAllTools(server);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  console.error(`[brain-mcp-server] Starting with BRAIN_DIR: ${BRAIN_DIR}`);
  await server.connect(transport);
  console.error("[brain-mcp-server] Connected via stdio");
}

main().catch((error) => {
  console.error("[brain-mcp-server] Fatal error:", error);
  process.exit(1);
});
