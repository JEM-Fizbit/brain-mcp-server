import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAllTools } from "./tools/index.js";

export function createBrainMcpServer(): McpServer {
  const server = new McpServer({
    name: "brain-mcp-server",
    version: "1.0.0",
  });

  registerAllTools(server);
  return server;
}
