# CLAUDE.md

<!-- Last reviewed: 2026-03-25 -->

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

<!-- LAYERING: This file is injected alongside ~/.claude/CLAUDE.md (global).
     Do NOT repeat global rules here (git config, security, commit protocol, MCP globals).
     Only include project-specific context. -->

## Project Context

brain-mcp-server is a generic, open-source MCP server (TypeScript, stdio transport) that serves Markdown-based AI Brain files to any MCP-compatible Claude client.

**Live URL:** Local development only (stdio transport)
**Status:** Production

---

## Synced Protocols (via knowhub)

Files in `docs/protocols/` are synced from the central [ai-knowledge](https://github.com/JEM-Fizbit/ai-knowledge) repo and **will be overwritten on commit**. To update a protocol: edit in `~/Projects/ai-knowledge/protocols/`, push, then run `knowhub` here.

**Protocols synced to this project:**
- `GIT_CONVENTIONS.md` - Commits, branches, PRs

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| Runtime | Node.js + TypeScript |
| Protocol | MCP (Model Context Protocol) via `@modelcontextprotocol/sdk` |
| Validation | Zod |
| Transport | stdio (local subprocess) |

---

## Development Commands

### Local Development
```bash
npm install              # Install dependencies
npm run build            # Compile TypeScript
npm run dev              # Watch mode
npm run start            # Run server
npm run inspector        # Test with MCP Inspector
```

---

## Architecture Overview

### Core Data Flow
```
Claude Client → stdio → MCP Server → local filesystem (BRAIN_DIR) → response
                                    → git operations (commit/push)
```

### Directory Structure
```
brain-mcp-server/
├── src/
│   ├── index.ts          # Entry point, server init, transport
│   ├── constants.ts      # Paths, limits, config
│   ├── services/
│   │   ├── brain.ts      # Brain filesystem operations + loadContext with nudges
│   │   ├── git.ts        # Git operations (commit, push, pull)
│   │   ├── log.ts        # Change log operations (append, read, getLastOpDate)
│   │   ├── lint.ts       # Health checks (bloat, stale, orphans, drift)
│   │   ├── ingest.ts     # Source ingestion (analyze, save to sources/, record provenance)
│   │   ├── inbox.ts      # Inbox scanning (list pending files in inbox/)
│   │   └── issues.ts     # GitHub issue checks (open maintenance issues)
│   ├── schemas/
│   │   └── tools.ts      # Zod schemas for all tool inputs
│   └── tools/
│       ├── context.ts    # brain_load_context, brain_read_file
│       ├── update.ts     # brain_update_file, brain_commit
│       ├── status.ts     # brain_list_files, brain_search
│       ├── log.ts        # brain_log, brain_read_log
│       ├── lint.ts       # brain_lint
│       ├── ingest.ts     # brain_ingest, brain_ingest_complete
│       ├── inbox.ts      # brain_scan_inbox
│       └── index.ts      # Tool registration barrel
└── dist/                 # Compiled output
```

### Tools (12 total)

**Core:**
- `brain_load_context` — Entry point: returns loader + NOW.md + lint/issue/inbox nudges
- `brain_read_file` — Read a specific Brain file by name
- `brain_update_file` — Write changes to a Brain file
- `brain_commit` — Git commit (optionally push)
- `brain_list_files` — List all files with staleness metadata
- `brain_search` — Search across all Brain files

**Operations:**
- `brain_log` — Append an entry to the Brain change log (LOG.md)
- `brain_read_log` — Read recent change log entries
- `brain_lint` — Health check: bloat, staleness, orphans, drift. Auto-logs the pass.
- `brain_ingest` — Process a new source (dry_run=true returns analysis plan; dry_run=false saves source to sources/{category}/)
- `brain_ingest_complete` — Record provenance after ingest (updates SOURCES.md index + LOG.md)
- `brain_scan_inbox` — List files pending in the inbox/ drop-folder for processing

---

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `BRAIN_DIR` | Path to Brain markdown files directory | `~/Projects/ai-brain-jem/brain` |
| `BRAIN_GITHUB_REPO` | GitHub repo for issue checks (owner/name) | `JEM-Fizbit/ai-brain-jem` |

---

## Common Gotchas

1. **Path traversal**: All filename inputs are validated — no `..`, no absolute paths, must end in `.md`
2. **Git operations**: Server uses existing SSH config (`github-personal` alias) for push. No credentials stored.
3. **stdio transport**: All logging goes to stderr (MCP convention). Never write to stdout except MCP protocol messages.
