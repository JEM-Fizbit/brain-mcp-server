# 2026-06-25 Hosted Brain Hardening Baseline Savepoint

**Status:** active handoff reference
**Repo:** `/Users/johnemilad/Projects/brain-mcp-server`
**Branch at savepoint:** `main`
**Hosted target:** `https://jem-brain-mcp.fly.dev/mcp`
**Operational Brains:** `ai-brain-jem`, `ers-brain`
**Local cockpit URLs:** JEM `http://127.0.0.1:8787/`; ERS `http://127.0.0.1:8788/`
**Primary next phase:** hosted Brain hardening and operational simplification

Read this first if you are a fresh session picking up the hosted Brain workstream after the June 2026 rollout, connector recovery, multi-Brain pilot, monitor consolidation, and housekeeping pass.

## TL;DR

The hosted Brain MCP is live as the normal remote path for John's Brain work. It serves both `ai-brain-jem` and the John-only `ers-brain` pilot through the same Fly.io hosted MCP and Supabase revision/storage backend. Local stdio Brain and local Markdown remain fallback/recovery surfaces, not the preferred remote-client path.

The immediate cleanup work is complete: `brain-mcp-server`, `ai-brain-jem`, and `ai-knowledge` are clean on `main...origin/main`; recent Brain work-tracking and protocol-index updates were committed and pushed; hosted sync shows `0` open conflicts for both Brains.

The next phase should start fresh and focus on hardening, not more cleanup theatre. The highest-value candidates are git-backup deprecation from routine Brain operations, cockpit multi-Brain clarity, consolidated Brain Monitor/doctor cleanup, visible user-action-required indicators, and cloud-run health/inbox operations.

## Current Verified State

Verified on 2026-06-25:

| Check | Result |
|---|---|
| `brain-mcp-server` git status | Clean: `main...origin/main` |
| `ai-brain-jem` git status | Clean: `main...origin/main` |
| `ai-knowledge` git status | Clean: `main...origin/main` |
| Hosted `ai-brain-jem` sync | Provider `revision`; hosted files `52`; open conflicts `0`; latest cursor `2026-06-25T01:47:09.928Z` |
| Hosted `ers-brain` sync | Provider `revision`; hosted files `40`; open conflicts `0`; latest cursor `2026-06-25T01:33:20.550Z` |
| `ai-knowledge` protocol index drift check | Clean: all `protocols/*.md` files referenced from both `README.md` and `AGENTS.md` |

Recent commits to know about:

### `brain-mcp-server`

- `a739d40` — Track git backup deprecation
- `4a795e2` — Ignore inbox README placeholders
- `fd24219` — Capture cockpit hardening backlog
- `162536f` — Link OpenAI MCP recovery protocol
- `55df8e7` — Document Codex CLI Brain recovery

### `ai-brain-jem`

- `7ede4b9` — Update Brain contact facts and capture queue
- `48af9a8` — Update work tracking architecture for multi-Brain capture
- `f6737e0` — Log hosted brain_lint verification

### `ai-knowledge`

- `11db031` — Update protocol index for recent additions
- `adcf71e` — Add OpenAI MCP connector recovery protocol
- `e9a55c0` — Protocols: capture the agentic-system methodology from aigent-alpha
- `122d759` — Document brokered MCP DCR recovery

## What Is Now True

- Hosted Brain MCP is the first-choice remote path for Brain context, reads, searches, lint/status, and narrow explicit Brain writes.
- Both `ai-brain-jem` and `ers-brain` are permitted operational Brains for John. Use explicit `brain_id` whenever scope could be ambiguous.
- `ers-brain` is a John-only pilot on the shared personal-owned hosted MCP. This is not ERS team access and not ERS production tenancy.
- Supabase Postgres is the hosted revision, source metadata, conflict, sync cursor, and telemetry store.
- Supabase Storage is the private artifact/source-byte store.
- Git has been demoted architecturally from live sync fabric to backup/export/history. A backlog item now tracks removing GitHub repo backup from normal Brain operator workflows once Supabase backup/restore and export recovery are proven.
- The Brain Sync menu-bar app is the preferred consolidated local operator surface for local sync watcher and cockpit process supervision.
- Legacy LaunchAgents and launcher scripts remain as rollback/debug surfaces, but the doctor still needs cleanup so it recognizes the consolidated menu-bar supervisor instead of warning on retired raw LaunchAgents.
- The cockpit has richer latency, usage, operation-log, recent-activity, auth-failure, and SLO-style views than the initial pilot. It still needs multi-Brain/profile clarity.
- OpenAI connector recovery lessons are now canonicalized in `ai-knowledge/protocols/OPENAI_MCP_CONNECTOR_RECOVERY.md`.
- `ai-brain-jem/docs/WORK_TRACKING_ARCHITECTURE.md` has been updated for two operational Brains and the `TASKS.md` Capture / Triage Queue. It is currently a Brain-local architecture doc, not an `ai-knowledge` universal protocol.
- `brain_capture_item` and the compatibility alias `brain_report_item` write temporary conversational captures to `TASKS.md` -> `Capture / Triage Queue`; that queue is not the document-ingestion `inbox/` and not a canonical task destination.

## Known Live Warnings / Non-Blocking Debt

`brain_lint({ brain_id: "ai-brain-jem" })` ran successfully through hosted Brain, but reported existing Brain hygiene issues:

- hosted lint skips working binary inspection because the active Brain store is revision-backed; run local lint for unsynced `working/` binaries;
- bloat warnings: `00_loader.md`, `11_next_chapter_framework.md`, `edge_biotech.md`, `JOURNAL.md`;
- orphan warnings: `audit-runs/2026-06-04-run.md`, `audit-runs/2026-06-05-run.md`, `HOSTED_OAUTH_WRITE_SMOKE.md`;
- journal rotation due: `JOURNAL.md` is above the 80 KB threshold.

These are Brain housekeeping issues, not blockers for the next hosted MCP hardening slice.

## Primary Backlog For Next Phase

The current top hardening candidates in `BACKLOG.md` are:

1. Deprecate GitHub repo backup from normal Brain operator workflows after Supabase backup/restore, point-in-time/export recovery, and any async export cadence are documented and tested.
2. Make the cockpit/doctor local-supervisor check understand the consolidated Brain Monitor app instead of warning on the retired raw `com.jem.brain-sync` LaunchAgent.
3. Make the Brain cockpit explicit about which Brain/profile it is reporting, including `brain_id`, local profile, state path, cockpit URL, and a view switcher for `ai-brain-jem` / `ers-brain`.
4. Expand the Brain monitor/menu-bar app to surface visible user-action-required indicators and guided resolution flows.
5. Explore whether ERS colleagues need raw Markdown/Obsidian editing; if not, prefer a hosted browser Brain UI with Markdown as backend/interchange format.
6. Design a cloud-run Brain health/inbox operations service to replace fragile Claude scheduled Routines where appropriate.
7. Review and transition ERS Brain Claude automations that still assume GitHub-pull-to-SharePoint review flow.

Recommended starting slice: do 2 and 3 together if small enough, because they both improve operator trust in the cockpit/monitor before deeper backup or cloud-service work. If the next session is explicitly about architecture instead of implementation, start with 1 and 5.

## Commands / Surfaces

Useful local commands:

```bash
git status --short --branch
npm run test
npm run hosted:doctor
npm run hosted:cockpit
npm run hosted:test-drive
npm run sync:menubar:install
npm run sync:menubar:launchd:plist
```

Hosted Brain checks should use the hosted connector first:

```text
brain_sync_status({ brain_id: "ai-brain-jem" })
brain_sync_status({ brain_id: "ers-brain" })
brain_lint({ brain_id: "ai-brain-jem" })
brain_lint({ brain_id: "ers-brain" })
```

Do not silently fall back to local Brain or filesystem reads if the hosted tool is slow. Use local fallback only if hosted is unavailable or insufficient, and state the failed hosted call.

## Invariants To Preserve

- Hosted MCP remains personal-owned and ERS beta-shared with John as sole user until a dedicated ERS MCP/Supabase cutover is deliberately executed.
- The shared hosted pilot must not become accidental ERS team production infrastructure.
- `ai-brain-jem` and `ers-brain` are separate operational Brains; do not merge task ownership or move work between them just because the hosted connector can see both.
- Supabase Brain schema remains private; do not grant `anon`, `authenticated`, or `public` access to Brain tables.
- OAuth and telemetry must remain metadata-only: never log tokens, authorization headers, request bodies, Brain content, SQL text, or connector payload content.
- Local cockpit and menu-bar app remain local-only/read-only operator surfaces. They must not expose Brain writes, conflict resolution, admin mutations, or public network binding.
- Git should not be re-promoted into the live sync path.
- Do not make routine Brain operations depend on manual commit/push/merge rituals.

## Suggested Fresh-Session Kickoff

```text
We are starting the hosted Brain hardening phase in /Users/johnemilad/Projects/brain-mcp-server.

Read docs/savepoints/2026-06-25-hosted-brain-hardening-baseline.md first, then verify the clean baseline. Use hosted Brain first for Brain status. The current priority candidates are:
1) cockpit/doctor cleanup for the consolidated Brain Monitor app;
2) cockpit multi-Brain/profile clarity;
3) git-backup deprecation from routine Brain ops;
4) user-action-required indicators in the monitor;
5) cloud-run Brain health/inbox operations.

Recommend the next slice, then execute it end-to-end unless you detect a real blocker.
```

## First Steps For The Next Session

1. Check `git status --short --branch` in `brain-mcp-server`, `ai-brain-jem`, and `ai-knowledge`.
2. Run hosted sync status for both `ai-brain-jem` and `ers-brain`.
3. Read `BACKLOG.md`, `docs/ROADMAP.md`, `docs/hosted-cockpit.md`, and `docs/specs/006-brain-sync-architecture-simplification.md`.
4. Pick the first hardening slice with John if it is architectural; otherwise make the conservative implementation call and proceed.
5. Verify with the narrowest meaningful tests, then commit and push.
