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

> **Active major initiative — Brain Platform (cloud, multi-tenant).** This server is evolving from single-user stdio into a multi-tenant "Brain Platform that serves any Brain" (one `mcp__brain__*` namespace + `brain_id` param + per-Brain substrate). It is an **evolution of this codebase, not a rewrite or new project.** Cloud transport + OAuth 2.1 + per-user attribution are already proven in a separate reference repo (`~/Projects/slack-mcp-server/` v0.3.0) — lift, don't re-derive. Next build window = JEM Phase 1+2 (HTTP transport + `BrainStore`/`BrainSemanticSearch` abstractions + `brain_id` + OAuth/GitHub-IdP + Tier 1 vector). **Kickoff plan:** `~/Projects/claude-ops/plans/brain-platform/2026-06-13.md`. **Canonical roadmap:** `docs/ROADMAP.md` (the `ai-brain-jem` `PLAN_brain_roadmap.md` is superseded/historical). **Ownership & lifecycle:** `docs/OWNERSHIP_AND_LIFECYCLE.md` — the hosted MCP is personal-owned and ERS beta-shared (John sole user); a dedicated ERS MCP is forked at multi-tenant cutover. **Target architecture:** `~/Projects/ai-brain-jem/docs/SPEC_brain_platform.md`. The implementation SPEC for this window goes at `docs/specs/001-brain-platform-phase-1-2.md` — draft and get sign-off before writing code.

---

## Runtime And Tooling

- Node 22.x is the supported local, Docker, and Fly runtime. `Dockerfile` uses `node:22-slim`, `package.json` declares `engines.node`, and TypeScript types are aligned to Node 22. Do not treat a newer host default Node as the supported baseline without revalidating the hosted runtime path.
- npm is the package manager. `package-lock.json` is the lockfile and `package.json` pins `packageManager` to npm 10.9.8. Use `npm ci` for reproducible installs; use `npm install` only when intentionally changing dependencies or the lockfile.
- The operational system dependencies are larger than the npm graph: Docker, Fly CLI, Supabase Postgres/Storage access, Playwright chromium, macOS `launchctl`/LaunchServices/Full Disk Access for local operator apps, and Git as fallback/export history.
- Before running a command, classify it with [`docs/TOOLING.md`](docs/TOOLING.md): safe local check, local-state mutating, hosted/Postgres mutating, or deploy/secret-affecting.
- Do not run installs, hosted writes, source uploads, Fly deploys, migrations, seed scripts, or LaunchAgent/app installers as routine verification for docs/metadata-only work.

---

## Protocol Triggers

- OpenAI/ChatGPT/Codex custom MCP connector auth, stale Dynamic Client Registration, `unknown_client_id`, OAuth callback, or tool-surface recovery work: read [`docs/protocols/OPENAI_MCP_CONNECTOR_RECOVERY.md`](docs/protocols/OPENAI_MCP_CONNECTOR_RECOVERY.md) before planning or editing.
- Hosted remote MCP server, OAuth 2.1, Dynamic Client Registration, callback allow-list, JWT/session state, or connector-enrollment work: read [`docs/protocols/REMOTE_MCP_SERVICE_PATTERN.md`](docs/protocols/REMOTE_MCP_SERVICE_PATTERN.md) before planning or editing.

---

## Brain Access Precedence

For Brain context, status, file reads, searches, lint, log reads, and narrow Brain writes, reach for the hosted Brain MCP first. Treat `brain-local`, direct filesystem reads, and OneDrive/CloudStorage mirrors as fallback paths only.

- Use explicit `brain_id` whenever more than one Brain is visible or the request could touch both. `ai-brain-jem` is permitted for JEM/personal Brain context; `ers-brain` is permitted for ERS/company Brain context. Platform work that affects both Brains should check both explicitly.
- Read-only hosted tools are pre-approved for normal project work: sync status, context load, file read, search, file/source listing, log read, and lint/doctor once the relevant hosted tool is known to work for that Brain.
- Hosted writes remain governed by the normal Brain write rule: write only when the user explicitly asks to save/update/log, or when the task clearly requires a narrow project-memory update. Use the hosted tool path for the write unless it is unavailable and the user has approved fallback.
- If the hosted connector appears to expose only part of the tool surface, run tool discovery again before falling back. If hosted access is still unavailable or insufficient, say exactly which hosted call failed or was missing before using `brain-local` or local files.
- Do not silently switch to local access because hosted is slow. Use hosted as the authoritative path, report unusually slow hosted calls, and capture the performance issue in the relevant telemetry/backlog path when it affects operations.
- Do not print full Brain files unless the user explicitly asks. Return targeted excerpts, metadata, filenames, and conclusions.

---

## Roadmap & Backlog System

This project uses the layered roadmap/backlog/spec system. Universal protocol: [ai-knowledge/protocols/ROADMAP_AND_BACKLOG.md](https://github.com/JEM-Fizbit/ai-knowledge/blob/main/protocols/ROADMAP_AND_BACKLOG.md). Triggers are semantic — invoke whenever the user gestures at open work (capture, retrieval, promotion, ship); don't wait for the literal word "backlog."

### Sources (this project)

- `BACKLOG.md` — lightweight one-line capture (canonical inbox).
- `docs/specs/NNN-slug.md` — promoted work briefs; archive at `docs/specs/archive/`.
- `docs/DECISIONS.md` — locked design decisions with rationale.

Minimum-stack adoption: no strategic roadmap or audit-doc layers configured. Add later via `.backlogrc` if the project grows enough to need them.

Conversationally captured items may be held temporarily in a Brain `TASKS.md` `## Capture / Triage Queue` via `brain_capture_item` (`brain_report_item` is a compatibility alias). This queue is not the document-ingestion `inbox/` and is not canonical: transfer project work to the owning repo `BACKLOG.md`, Asana, or another tracker, then mark the Brain item transferred/closed. `brain_lint` flags stale or oversized capture queues so items do not accumulate silently.

### Verification commands (cite in every spec)

- `git diff --check` — whitespace sanity for docs/metadata-only changes
- `npm run build` — TypeScript compile (use for type-only changes)
- `npm test` — build + Node test runner (use for any logic change)

---

## Hosted Cockpit And Telemetry

The hosted cockpit is a local-only, read-only operator surface at `http://127.0.0.1:8787/`. It must not expose Brain writes, conflict resolution, admin mutations, or public network binding.

Use Supabase Postgres for hosted operational telemetry:

- user-facing hosted MCP latency samples belong in `brain.sync_events` with `event_type = 'hosted_mcp_latency'`;
- real hosted MCP server tool calls are the normal telemetry source and should use metadata `source = 'hosted_mcp_server'`;
- server tool-call telemetry should include `timingLayer = 'server_tool'`, `durationType = 'server_tool_handler'`, and bounded sanitized DB summaries/spans when Postgres work occurs;
- DB telemetry may record operation/table names, durations, row counts, status, and bounded error text. It must not record SQL text, query parameters, file content, patch text, source content, or search query text;
- hosted telemetry writes are best-effort and non-blocking by default so measurement does not add user-facing latency; use `BRAIN_HOSTED_MCP_LATENCY_AWAIT_DB_WRITE=1` only for explicit diagnostics;
- hosted OAuth client/session state belongs in Supabase Postgres via `BRAIN_OAUTH_STATE_STORE=postgres`; file-backed OAuth state is local/dev fallback only and should not be the Fly-hosted connector authority;
- auth failure telemetry should use metadata-only `brain.sync_events` rows with `event_type = 'hosted_mcp_auth'`. Record sanitized reason codes, HTTP status, and the non-secret OAuth `clientId` and `grantType` (raw `clientId` so it joins to the `oauth_state` `clients` registry; both `safeText`-sanitized — `clientId` is attacker-controlled on the failure path). Never record access tokens, refresh tokens, authorization headers, request bodies, client secrets, Brain content, SQL text, or connector payload content. `User-Agent`/IP and other network identifiers stay out (deferred + gated by the security review);
- a benign post-migration **stale connector** (a single *unregistered* `clientId` looping `unknown_client_id` on a `refresh_token` grant past `BRAIN_HOSTED_MCP_AUTH_STALE_GRACE_MINUTES`, default 10) is classified by `connectorState` and downgraded from `fail` to `warn` by both the doctor (`effectiveStatus`) and the alerter (`computeStaleConnector`); the downgrade is conservative — any ambiguity (multi-client, multi-reason, unknown registered set, short burst) keeps full severity;
- hosted auth-failure alerting is best-effort, non-blocking, and gated on `BRAIN_SLACK_BOT_TOKEN` (no-op without it); it posts via Slack `chat.postMessage` (warn → `BRAIN_SLACK_ALERT_CHANNEL`, fail → `BRAIN_SLACK_ALERT_DM`), with a per-severity cooldown. Alert dispatches use metadata-only `brain.sync_events` rows with `event_type = 'hosted_mcp_auth_alert'`, `kind = 'auth_alert'`, recording only severity, count, window, reason codes, HTTP status, channel, and ok — never tokens, headers, bodies, SQL text, or Brain content. The `hosted_mcp_auth_failures` doctor check shares the same window/thresholds (and the same stale-connector downgrade) so the cockpit verdict and Slack alerts agree;
- client-observed end-to-end samples from hosted smoke/test-drive flows should use metadata `source = 'hosted_mcp_client_e2e'` and `timingLayer = 'client_e2e'`;
- sync-wait telemetry is measured by hosted smoke/test-drive flows because it measures local-hosted propagation rather than one server tool handler;
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
│   │   ├── task-intake.ts # TASKS.md capture/triage queue formatting
│   │   ├── lint.ts       # Health checks (bloat, stale, orphans, drift, capture queue, unindexed working binaries)
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
│       ├── tasks.ts      # brain_capture_item, brain_report_item alias
│       ├── lint.ts       # brain_lint
│       ├── ingest.ts     # brain_ingest, brain_ingest_complete
│       ├── inbox.ts      # brain_scan_inbox
│       └── index.ts      # Tool registration barrel
└── dist/                 # Compiled output
```

### Tools (22 total — 21 distinct + 1 alias)

Registered in `src/tools/index.ts` across the registry, semantic, sync, context, update, status, log, tasks, lint, ingest, and inbox modules.

**Registry:**
- `brain_list_brains` — List the Brains the caller can reach, with metadata
- `brain_describe` — Describe a single Brain (id, type, integration mode, role, metadata)

**Semantic search:**
- `brain_semantic_index` — Build/refresh the vector index over the source archive
- `brain_semantic_search` — Vector search across indexed sources

**Sync / conflicts:**
- `brain_sync_status` — Hosted sync health: provider, hosted file count, open conflicts, latest cursor
- `brain_list_conflicts` — List open sync conflicts
- `brain_resolve_conflict` — Resolve a sync conflict (per `docs/conflict-resolution.md`)

**Core:**
- `brain_load_context` — Entry point: returns loader + NOW.md + lint/issue/inbox nudges
- `brain_read_file` — Read a specific Brain file by name. Accepts `scope`: "brain" (default) or "sources" to read from the source archive instead.
- `brain_update_file` — Write changes to a Brain file (replace, append, or patch with find-and-replace)
- `brain_commit` — Git commit (optionally push)
- `brain_list_files` — List all Brain vault files with staleness metadata
- `brain_list_sources` — List files in the source archive, optionally filtered by category
- `brain_search` — Search across files. Exact keyword matches are preferred; normalized fallback handles spacing, punctuation, camel-case, and common lookup wording. Accepts `scope`: "brain" (default), "sources", or "all".

**Operations:**
- `brain_log` — Append an entry to the Brain change log (LOG.md)
- `brain_read_log` — Read recent change log entries
- `brain_capture_item` — Capture a temporary conversational bug/feature/observation/investigation/follow-up/idea/question/reminder/note/routing item in `TASKS.md` `## Capture / Triage Queue` before triage into the canonical destination.
- `brain_report_item` — Compatibility alias for `brain_capture_item`.
- `brain_lint` — Health check: bloat, staleness, orphans, drift, capture queue, unindexed working binaries. Auto-logs the pass.
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
