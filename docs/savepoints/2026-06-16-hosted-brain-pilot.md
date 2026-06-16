# 2026-06-16 Hosted Brain Pilot Savepoint

**Status:** handoff reference
**Repo:** `/Users/johnemilad/Projects/brain-mcp-server`
**Branch at savepoint:** `main`
**Hosted target:** `https://jem-brain-mcp.fly.dev/mcp`
**Brain id:** `ai-brain-jem`
**Operator cockpit:** `http://127.0.0.1:8787/`

This savepoint captures the state after rebuilding the hosted Brain pilot around the local-first Supabase/Postgres sync contract and before the real JEM hosted-client cutover rehearsal.

## What Is Now True

- Local stdio Brain MCP remains the trusted default/fallback while hosted is proven.
- Hosted MCP runs on Fly and uses Supabase Postgres as the revision/source metadata store.
- Supabase Storage retains source/original artifacts in private immutable object paths.
- Fly no longer uses the retired git working-copy hot path.
- Local Markdown remains the first-class working surface.
- Hosted writes sync back to local Markdown through the local sync agent.
- Local Markdown edits sync to hosted Postgres without manual git push/pull rituals.
- Dirty/stale divergent edits create explicit sync conflicts instead of silent overwrites.
- Conflicts can be listed and resolved through hosted MCP tools.
- Normal hosted runtime uses metadata-only artifact access; privileged object byte access remains an explicit admin/ingestion path.
- Hosted OAuth smoke tests cache and rotate a local refresh token so routine smoke runs do not require repeated GitHub approval.
- The cockpit provides local read-only operator visibility over health, recent activity, conflicts, sync health, and user-facing read/write/sync latency.
- The one-command operator rehearsal is available as `npm run hosted:test-drive`.

## Recently Merged PRs

- `#32` — Show user-facing hosted MCP latency.
- `#33` — Cache hosted OAuth smoke refresh grant.
- `#34` — Add hosted Brain test drive command.

## Key Commands

```bash
npm run hosted:cockpit
npm run hosted:doctor
npm run smoke:hosted:oauth
npm run smoke:hosted:oauth -- --write --verify-local
npm run smoke:hosted:oauth -- --local-write --verify-hosted
npm run smoke:hosted:oauth -- --conflict
npm run hosted:test-drive
npm run hosted:test-drive -- --read-only
npm run hosted:test-drive -- --skip-conflict
```

## Latest Verified State

`npm run hosted:test-drive` passed on 2026-06-16.

Observed result:

- Overall result: `PASS`
- Duration: `36s`
- OAuth cache: reused; no browser approval required
- Hosted files: `50`
- Open conflicts: `0`
- Final sync cycle observed: `753`
- Final sync report: pushed `0`, pulled `1`, conflicts `0`
- Latest user-facing read latency: about `411ms`
- Latest user-facing write latency: about `1.8s`
- Latest hosted-to-local sync wait: about `6.4s`

Follow-up cockpit/doctor check after merge:

```json
{
  "status": "pass",
  "conflicts": 0,
  "user": {
    "latestReadLatencyMs": 411,
    "latestWriteLatencyMs": 1779,
    "latestSyncWaitLatencyMs": 6426
  }
}
```

## Local Files Outside This Repo

The pilot uses the local JEM Brain at:

```text
/Users/johnemilad/Projects/ai-brain-jem/brain
```

Operational sync/OAuth artifacts are stored beside that Brain, not committed:

```text
/Users/johnemilad/Projects/ai-brain-jem/.brain-sync/state.json
/Users/johnemilad/Projects/ai-brain-jem/.brain-sync/state.json.health.json
/Users/johnemilad/Projects/ai-brain-jem/.brain-sync/hosted-mcp-latency.json
/Users/johnemilad/Projects/ai-brain-jem/.brain-sync/hosted-oauth-token.json
```

The OAuth refresh-token cache file was verified with `0600` permissions. Access tokens remain in memory only.

## Core Decisions To Preserve

- Do not re-enable hosted Brain as the default connector until hosted operation is boring under real client use.
- Do not abandon local Markdown as the working surface.
- Do not expose Brain tables through Supabase browser/client roles.
- Do not treat John's private Supabase prototype project as ERS production infrastructure.
- Do not store original binaries in the Postgres hot revision path.
- Do not silently resolve content conflicts.
- Do not make Brain maintenance a user babysitting job; surface required user action clearly and proactively.

Primary durable references:

- `docs/DECISIONS.md`
- `docs/ROADMAP.md`
- `docs/deploy-fly.md`
- `docs/conflict-resolution.md`
- `docs/security/hosted-brain-supabase-security-gate.md`
- `docs/specs/002-local-first-hosted-sync-contract.md`
- `docs/specs/003-hosted-brain-sync-architecture.md`

## Recommended Next Session Goal

Run the real JEM hosted-client rehearsal and decide when hosted MCP becomes the normal remote JEM path.

Suggested fresh-session kickoff:

```text
We’re continuing the hosted Brain rebuild in /Users/johnemilad/Projects/brain-mcp-server.

Current state:
- Hosted Brain pilot is operational on Fly + Supabase for brain_id ai-brain-jem.
- Local-first sync, conflict tracking, Supabase Postgres revision store, Supabase Storage artifact retention, OAuth, cached hosted OAuth smoke, hosted cockpit, and hosted test-drive are implemented.
- Recent merged PRs:
  - #32 Show user-facing hosted MCP latency
  - #33 Cache hosted OAuth smoke refresh grant
  - #34 Add hosted Brain test drive command
- Cockpit runs at http://127.0.0.1:8787/ via npm run hosted:cockpit.
- One-command readiness rehearsal is npm run hosted:test-drive.
- Latest hosted:test-drive passed with open conflicts 0, read latency ~411ms, write latency ~1.8s, sync wait ~6.4s.
- Repo was clean on main after PR #34.
- User wants automation-first maintenance: proactive clear flags for sync/lint/conflict/source-ingestion issues, minimal manual babysitting.
- Next goal: run a real hosted client rehearsal for JEM Brain and decide when to cut over normal Claude/Codex usage to hosted MCP. Then plan cockpit launcher/productization and later multi-brain/ERS multi-tenant work.

Start by checking git status, reading docs/ROADMAP.md, docs/DECISIONS.md, docs/deploy-fly.md, and running npm run hosted:test-drive if needed. Then propose and execute the next cutover rehearsal steps without stopping unnecessarily.
```

## Immediate Next Steps

1. Start a fresh session using the kickoff above.
2. Run `npm run hosted:test-drive` once at session start if live state needs confirming.
3. Enroll or point a real hosted client at `https://jem-brain-mcp.fly.dev/mcp`.
4. Exercise realistic JEM Brain reads and a narrow reviewed write.
5. Watch cockpit for recent activity, latency, sync catch-up, and conflicts.
6. Decide whether hosted MCP is ready as the normal remote path for JEM, with local MCP retained as fallback.
