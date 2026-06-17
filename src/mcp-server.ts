import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAllTools } from "./tools/index.js";

const SERVER_INSTRUCTIONS = `This server exposes a personal AI Brain: Markdown files (identity, voice, \
career, projects, and operational state such as TASKS/JOURNAL/NOW) plus an ingested source archive.

Start any task that needs the user's personal context by calling brain_load_context — it returns the \
loader (a navigation table + post-load checklist) and NOW.md, and flags overdue lint or pending inbox \
files. The loader is the single source of truth for which files to read and for the ingestion, inbox, \
and source-category protocols; follow it rather than guessing, then call brain_read_file for the files \
it points to before responding.

Notes: brain_read_file and brain_search take a scope param ("brain" default, "sources", or "all") to \
reach the source archive; brain_sync_status reports hosted sync health; brain_id defaults to the single \
configured Brain when omitted. The Brain is authoritative for stable knowledge, not live state — don't \
treat it as the source of truth for in-progress work, and don't write Brain files unless the user asked \
for a change.`;

export function createBrainMcpServer(): McpServer {
  const server = new McpServer(
    {
      name: "brain-mcp-server",
      version: "1.0.0",
    },
    { instructions: SERVER_INSTRUCTIONS },
  );

  registerAllTools(server);
  return server;
}
