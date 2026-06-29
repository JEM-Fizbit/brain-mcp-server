import type { Config } from "knowhub";

const LOCAL_PROTOCOLS_BASE = "/Users/johnemilad/Projects/ai-knowledge/protocols";

// Sync local copies of relevant ai-knowledge protocols. Edit protocols in ai-knowledge
// (canonical), then run `knowhub` here to refresh.
const config: Config = {
  resources: [
    // OpenAI custom MCP app / connector stale OAuth recovery.
    {
      plugin: "local",
      pluginConfig: { path: `${LOCAL_PROTOCOLS_BASE}/OPENAI_MCP_CONNECTOR_RECOVERY.md` },
      overwrite: true,
      outputs: ["docs/protocols/OPENAI_MCP_CONNECTOR_RECOVERY.md"],
    },
    // Hosted remote MCP OAuth/service pattern.
    {
      plugin: "local",
      pluginConfig: { path: `${LOCAL_PROTOCOLS_BASE}/REMOTE_MCP_SERVICE_PATTERN.md` },
      overwrite: true,
      outputs: ["docs/protocols/REMOTE_MCP_SERVICE_PATTERN.md"],
    },
  ],
};

export default config;
