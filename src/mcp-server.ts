import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SERVER_VERSION } from "./constants.js";
import { registerAllTools } from "./tools/index.js";
import { instrumentToolLatency } from "./services/tool-telemetry.js";

const SERVER_INSTRUCTIONS = `This server exposes one or more durable Markdown AI Brains: stable knowledge, \
navigation hubs, operational context, and ingested source archives.

Start a task that needs Brain context by calling brain_load_context with an explicit brain_id when more \
than one Brain is visible. It returns the slim loader/task router plus NOW.md. Follow the loader's intent \
route and read only the relevant hubs or files. Before ingestion, output capture, maintenance, or another \
write workflow, read the on-demand operations guide named by that Brain's loader; detailed procedures do \
not belong in the always-loaded bootstrap.

Notes: brain_read_file and brain_search take a scope param ("brain" default, "sources", or "all") to \
reach original ingested material; brain_sync_status reports hosted sync health. A Brain is authoritative \
only for the stable knowledge in its ownership scope, not live project state or another Brain's domain. \
Use first-class repos, trackers, and workspaces for in-progress work. Do not write Brain content unless \
the user requested it or the approved task clearly requires a narrow update.`;

export function createBrainMcpServer(): McpServer {
  const server = new McpServer(
    {
      name: "brain-mcp-server",
      version: SERVER_VERSION,
    },
    { instructions: SERVER_INSTRUCTIONS },
  );

  instrumentToolLatency(server);
  registerAllTools(server);
  return server;
}
