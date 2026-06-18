# CLAUDE.md

<!-- Last reviewed: 2026-06-18 -->

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository. Keep it aligned with `AGENTS.md`, which carries the Codex/Agents-facing version of the same project-specific guidance.

<!-- LAYERING: This file is injected alongside ~/.claude/CLAUDE.md (global).
     Do NOT repeat global rules here (git config, security, commit protocol, MCP globals).
     Only include project-specific context. -->

## Project Context

brain-mcp-server is a generic, open-source MCP server (TypeScript) that serves Markdown-based AI Brain files to any MCP-compatible client over stdio (local subprocess) or HTTP (hosted, multi-tenant).

**Hosted (default Claude/Codex connector):** `brain` → `https://jem-brain-mcp.fly.dev/mcp` (Fly.io + Supabase Postgres revision store + Supabase Storage). Promoted to the default `brain` connector across Claude and Codex surfaces on 2026-06-16; local stdio is retained as the `brain-local` fallback. Operator guide: `docs/hosted-client-cutover.md`.
**Local:** stdio only (`node dist/index.js`, `BRAIN_DIR` env) — fast path for local filesystem work and recovery.
**Status:** Production

> **Active major initiative — Brain Platform (cloud, multi-tenant).** This server is evolving from single-user stdio into a multi-tenant "Brain Platform that serves any Brain" (one `mcp__brain__*` namespace + `brain_id` param + per-Brain substrate). It is an **evolution of this codebase, not a rewrite or new project.** Cloud transport + OAuth 2.1 + per-user attribution are already proven in a separate reference repo (`~/Projects/slack-mcp-server/` v0.3.0) — lift, don't re-derive. Next build window = JEM Phase 1+2 (HTTP transport + `BrainStore`/`BrainSemanticSearch` abstractions + `brain_id` + OAuth/GitHub-IdP + Tier 1 vector). **Kickoff plan:** `~/Projects/claude-ops/plans/brain-platform/2026-06-13.md`. **Canonical roadmap:** `~/Projects/ai-brain-jem/docs/PLAN_brain_roadmap.md`. **Target architecture:** `~/Projects/ai-brain-jem/docs/SPEC_brain_platform.md`. The implementation SPEC for this window goes at `docs/specs/001-brain-platform-phase-1-2.md` — draft and get sign-off before writing code.

---

## Roadmap & Backlog System

This project uses the layered roadmap/backlog/spec system. Universal protocol: [ai-knowledge/protocols/ROADMAP_AND_BACKLOG.md](https://github.com/JEM-Fizbit/ai-knowledge/blob/main/protocols/ROADMAP_AND_BACKLOG.md). Triggers are semantic — invoke whenever the user gestures at open work (capture, retrieval, promotion, ship); don't wait for the literal word "backlog."

### Sources (this project)

- `BACKLOG.md` — lightweight one-line capture (canonical inbox).
- `docs/specs/NNN-slug.md` — promoted work briefs; archive at `docs/specs/archive/`.
- `docs/DECISIONS.md` — locked design decisions with rationale.

Minimum-stack adoption: no strategic roadmap or audit-doc layers configured. Add later via `.backlogrc` if the project grows enough to need them.

### Verification commands (cite in every spec)

- `npm run build` — TypeScript compile (use for type-only changes)
- `npm test` — build + Node test runner (use for any logic change)

---

## Hosted Cockpit And Telemetry

The hosted cockpit is a local-only, read-only operator surface at `http://127.0.0.1:8787/`. It must not expose Brain writes, conflict resolution, admin mutations, or public network binding.

Use Supabase Postgres for hosted operational telemetry:

- user-facing hosted MCP latency samples belong in `brain.sync_events` with `event_type = 'hosted_mcp_latency'`;
- real hosted MCP server tool calls are the normal telemetry source and should use metadata `source = 'hosted_mcp_server'`;
- sync-wait telemetry is measured by hosted smoke/test-drive flows because it measures local-hosted propagation rather than one server tool handler;
- telemetry must not record file content, patch text, source content, or search query text;
- the cockpit should read Postgres telemetry first;
- `.brain-sync/hosted-mcp-latency.json` is a fallback cache only, used when Postgres is unavailable or explicitly enabled;
- do not introduce a new metrics database, daemon, or analytics service unless a backlog/spec promotion justifies it.

When changing launcher, LaunchAgent, cockpit, or telemetry behaviour, update `docs/hosted-cockpit.md` and relevant tests in the same change.

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
│   │   ├── lint.ts       # Health checks (bloat, stale, orphans, drift, unindexed working binaries)
│   │   ├── ingest.ts     # Source ingestion (analyze, save to sources/, record provenance)
│   │   ├── inbox.ts      # Inbox scanning (list pending files in inbox/)
│   │   └── issues.ts     # GitHub issue checks (open maintenance issues)
│   ├── schemas/
│   │   └── tools.ts      # Zod schemas for all tool inputs
│   └── tools/
│       ├── context.ts    # brain_load_context, brain_read_file
│       ├── update.ts     # brain_update_file, brain_commit
│       ├── status.ts     # brain_list_files, brain_search, brain_list_sources
│       ├── log.ts        # brain_log, brain_read_log
│       ├── lint.ts       # brain_lint
│       ├── ingest.ts     # brain_ingest, brain_ingest_complete
│       ├── inbox.ts      # brain_scan_inbox
│       └── index.ts      # Tool registration barrel
└── dist/                 # Compiled output
```

### Tools (13 total)

**Core:**
- `brain_load_context` — Entry point: returns loader + NOW.md + lint/issue/inbox nudges
- `brain_read_file` — Read a specific Brain file by name. Accepts `scope`: "brain" (default) or "sources" to read from the source archive instead.
- `brain_update_file` — Write changes to a Brain file (replace, append, or patch with find-and-replace)
- `brain_commit` — Git commit (optionally push)
- `brain_list_files` — List all Brain vault files with staleness metadata
- `brain_list_sources` — List files in the source archive, optionally filtered by category
- `brain_search` — Search across files. Accepts `scope`: "brain" (default), "sources", or "all".

**Operations:**
- `brain_log` — Append an entry to the Brain change log (LOG.md)
- `brain_read_log` — Read recent change log entries
- `brain_lint` — Health check: bloat, staleness, orphans, drift, unindexed working binaries. Auto-logs the pass.
- `brain_ingest` — Process a new source (dry_run=true returns analysis plan; dry_run=false saves source to sources/{category}/)
- `brain_ingest_complete` — Record provenance after ingest (updates SOURCES.md index + LOG.md, optionally deletes inbox file via `inbox_file` param)
- `brain_scan_inbox` — List files pending in the inbox/ drop-folder for processing

---

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `BRAIN_DIR` | Path to Brain markdown files directory | `~/Projects/ai-brain-jem/brain` |
| `BRAIN_GITHUB_REPO` | GitHub repo for issue checks (owner/name) | `JEM-Fizbit/ai-brain-jem` |
| `BRAIN_SOURCES_DIR` | Path to the `sources/` archive (sibling of `brain/`) | `~/Projects/ai-brain-jem/sources` |

---

## Common Gotchas

1. **Path traversal**: All filename inputs are validated — no `..`, no absolute paths, must end in `.md`
2. **Git operations**: Server uses existing SSH config (`github-personal` alias) for push. No credentials stored.
3. **stdio transport**: All logging goes to stderr (MCP convention). Never write to stdout except MCP protocol messages.
