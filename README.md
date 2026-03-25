# brain-mcp-server

A generic MCP server that serves Markdown-based AI Brain files to any MCP-compatible Claude client.

## What it does

Gives Claude persistent, context-aware access to a collection of Markdown files (an "AI Brain") via the [Model Context Protocol](https://modelcontextprotocol.io). Supports reading, writing, searching, and git-backed versioning — all over local stdio transport.

## Tools

| Tool | Description |
|------|-------------|
| `brain_load_context` | Entry point — returns the loader + NOW.md |
| `brain_read_file` | Read a specific Brain file by name |
| `brain_update_file` | Update a Brain file (replace or append) |
| `brain_commit` | Git commit changes, optionally push |
| `brain_list_files` | List all files with staleness metadata |
| `brain_search` | Search across all Brain files |

## Setup

```bash
npm install
npm run build
```

### Claude Code (`~/.claude/settings.json`)

```json
{
  "mcpServers": {
    "brain": {
      "command": "node",
      "args": ["/path/to/brain-mcp-server/dist/index.js"],
      "env": {
        "BRAIN_DIR": "/path/to/your/brain/files"
      }
    }
  }
}
```

### Claude Desktop (`claude_desktop_config.json`)

Same configuration as above.

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `BRAIN_DIR` | Path to your Brain markdown files | `~/Projects/ai-brain-jem/brain` |

## How it works

1. Claude calls `brain_load_context` at session start
2. The loader file contains a navigation table of all Brain files
3. Claude reads the table and requests specific files via `brain_read_file`
4. Edits are written via `brain_update_file`, then committed via `brain_commit`

The routing logic lives in the loader (a Markdown file you maintain), not in code. The server is content-agnostic.

## Requirements

- Node.js 18+
- A directory of Markdown files (your "Brain")
- Git (for commit/push features)

## License

MIT
