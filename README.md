# brain-mcp-server

A generic MCP server that serves Markdown-based AI Brain files to any MCP-compatible Claude client.

## What It Does

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

## Requirements

- Node.js 18+
- A directory of Markdown files (your "Brain") with at least `00_loader.md` and `NOW.md`
- Git initialised in the Brain directory (for commit/push features)

## Quick Start

```bash
# 1. Clone and build
git clone <your-fork-or-clone-url> ~/Projects/brain-mcp-server
cd ~/Projects/brain-mcp-server
npm install
npm run build

# 2. Verify the build produced dist/index.js
ls dist/index.js

# 3. Test with MCP Inspector (optional but recommended)
npx @modelcontextprotocol/inspector node dist/index.js
```

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `BRAIN_DIR` | Absolute path to your Brain markdown files directory | `~/Projects/ai-brain-jem/brain` |

## Client Setup

### Claude Code

Add to `~/.claude/settings.json` (user-level) or `.claude/settings.json` (project-level):

```json
{
  "mcpServers": {
    "brain": {
      "command": "node",
      "args": ["/absolute/path/to/brain-mcp-server/dist/index.js"],
      "env": {
        "BRAIN_DIR": "/absolute/path/to/your/brain/files"
      }
    }
  }
}
```

### Claude Desktop

Add to `claude_desktop_config.json` (same format as above).

### Claude Cowork

Add via the MCP server configuration in Cowork settings (same `command`, `args`, and `env` values).

## Post-Install Configuration

After the MCP server is connected, three additional steps make it fully automatic.

### Step 1: Pre-authorise tool calls (Claude Code)

Add `mcp__brain` to your permissions allow-list so Claude doesn't prompt for approval on every Brain tool call.

In `~/.claude/settings.json`, add to the `permissions.allow` array:

```json
{
  "permissions": {
    "allow": [
      "mcp__brain"
    ]
  }
}
```

This matches all six Brain tools. You can verify with `/permissions` in Claude Code.

### Step 2: Auto-load directive (Claude Code / Cowork)

Add the following to `~/.claude/CLAUDE.md` so Claude automatically loads Brain context at the start of every session:

```markdown
## AI Brain (Auto-Load)

An AI Brain (personal knowledge system) is connected via MCP. At the start of each conversation,
call `brain_load_context` to orient yourself with John's identity, current priorities, and available
context files. Then selectively load additional files based on the task, per the navigation table
in the loader. Do not wait to be asked — load context proactively.
```

This works for both Claude Code and Cowork (both read `~/.claude/CLAUDE.md`).

### Step 3: User preferences (Claude Desktop / claude.ai — manual)

Claude Desktop and claude.ai do not read `CLAUDE.md`. For these clients, add the following to your **user preferences** (Settings → Profile → User preferences, or equivalent):

```
I maintain an AI Brain (personal knowledge system) accessible via MCP. At the start of each
conversation, load context by calling brain_load_context, then selectively load additional files
based on the task per the navigation table in the loader. Do not wait to be asked.
```

> **Note:** This step requires manual entry in each client's preferences UI. It cannot be automated.

## How It Works

1. Claude calls `brain_load_context` at session start (automatically, if configured per above)
2. The loader file contains a navigation table mapping task types to Brain files
3. Claude reads the table and requests specific files via `brain_read_file`
4. Edits are written via `brain_update_file`, then committed via `brain_commit`

The routing logic lives in the loader (a Markdown file you maintain), not in code. The server is content-agnostic — it knows nothing about your specific Brain content, only how to serve Markdown files.

## Related Projects

- **[ai-brain-primer](https://github.com/JEM-Fizbit/ai-brain-primer)** — Framework and methodology for building an AI Brain
- **[ai-brain-jem](https://github.com/JEM-Fizbit/ai-brain-jem)** — Example private Brain implementation (private repo)

## License

MIT
