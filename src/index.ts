import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { BRAIN_DIR } from "./constants.js";
import { createBrainMcpServer } from "./mcp-server.js";

async function main(): Promise<void> {
  if (process.env.TRANSPORT === "http") {
    const { startHttpServer } = await import("./http/server.js");
    await startHttpServer();
    return;
  }

  const server = createBrainMcpServer();
  const transport = new StdioServerTransport();
  console.error(`[brain-mcp-server] Starting with BRAIN_DIR: ${BRAIN_DIR}`);
  await server.connect(transport);
  console.error("[brain-mcp-server] Connected via stdio");
}

main().catch((error) => {
  console.error("[brain-mcp-server] Fatal error:", error);
  process.exit(1);
});
