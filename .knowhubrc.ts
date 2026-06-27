import type { Config } from "knowhub";

const GITHUB_RAW_BASE = "https://raw.githubusercontent.com/JEM-Fizbit/ai-knowledge/main/protocols";

// Sync local copies of relevant ai-knowledge protocols. Edit protocols in ai-knowledge
// (canonical), then run `knowhub` here to refresh.
const config: Config = {
  resources: [
    // OpenAI custom MCP app / connector stale OAuth recovery.
    {
      plugin: "http",
      pluginConfig: { url: `${GITHUB_RAW_BASE}/OPENAI_MCP_CONNECTOR_RECOVERY.md` },
      overwrite: true,
      outputs: ["docs/protocols/OPENAI_MCP_CONNECTOR_RECOVERY.md"],
    },
    // Hosted remote MCP OAuth/service pattern.
    {
      plugin: "http",
      pluginConfig: { url: `${GITHUB_RAW_BASE}/REMOTE_MCP_SERVICE_PATTERN.md` },
      overwrite: true,
      outputs: ["docs/protocols/REMOTE_MCP_SERVICE_PATTERN.md"],
    },
  ],
};

export default config;
