# Brain Platform Phase 1+2 — Session Kickoff

> **How to use:** start Claude Code in `~/Projects/brain-mcp-server/` and say
> *"Read `docs/brain-platform-kickoff-prompt.md` and follow it."*
> Companion kickoff plan: `~/Projects/claude-ops/plans/brain-platform/2026-06-13.md`.

---

We're kicking off the Brain Platform Phase 1+2 build — evolving THIS repo
(brain-mcp-server) from a single-user stdio MCP server into a cloud, multi-tenant
"Brain Platform that serves any Brain" (one `mcp__brain__*` namespace, `brain_id`
parameter, per-Brain substrate). This is an evolution of this codebase, not a new
project.

The kickoff plan that frames this session:
`~/Projects/claude-ops/plans/brain-platform/2026-06-13.md` — read it first; it has
the canonical-file map, scope, and the substrate-lift list.

Then read, in order, before writing ANY code:

1. `~/Projects/ai-brain-jem/docs/SPEC_brain_mcp_server.md` (current state; § Locked Baseline)
2. `~/Projects/ai-brain-jem/docs/SPEC_brain_platform.md` (target architecture — build to this)
3. `~/Projects/ai-brain-jem/docs/PLAN_brain_roadmap.md` (sequencing; focus on the ai-brain-jem Per-Brain section)
4. `~/Projects/slack-mcp-server/lib/oauth/*`, `lib/mcp-auth.js`, `lib/router.js`, `lib/state/*`
   (the PROVEN OAuth 2.1 + transport + attribution substrate to LIFT — do NOT
   re-derive auth/transport from spec)

(Ignore `docs/SPEC_openai_mcp_support.md` — it's a stale redirect stub.)

## Scope for THIS build window (Phase 1 + 2 merged)

- **Phase 1:** HTTP transport behind a flag (preserve stdio), `BrainStore` /
  `BrainSemanticSearch` abstractions, `brain_id` plumbing.
- **Phase 2:** hosted + OAuth (swap the slack-mcp-server Slack-DM OTP IdP for
  GitHub OAuth federation), Tier 1 read-only vector index over `sources/`.
- **Out of scope:** Tier 2/3, Edge, ERS, federation.

Net-new work is only: (a) GitHub IdP swap, (b) `brain_*` tool registry replacing the
Slack tools, (c) `brain_id` + storage abstractions, (d) Tier 1 vector index.
Everything else is lift-and-adapt from slack-mcp-server.

## Deliverable for this first session

**Do NOT start coding.** Produce the Phase 1+2 implementation SPEC at
`docs/specs/001-brain-platform-phase-1-2.md` (this repo's spec convention — promote
per ROADMAP_AND_BACKLOG; the BACKLOG already has the capture line). The spec must
cover:

- file-by-file lift map from slack-mcp-server
- the GitHub-IdP swap design
- the `brain_id` schema change
- the `BrainStore` / `BrainSemanticSearch` interfaces
- the hosting target decision (mirror slack-mcp-server's Cloudflare Workers + D1, or alternative?)
- a test + end-to-end verification plan across client surfaces
- cite the verification commands (`npm run build` / `npm test`) in the spec

Stop and get my sign-off on the spec before any implementation.

## Conventions

Read this repo's `CLAUDE.md` first (it has the initiative signpost and the layered
backlog/spec system). Lean/scalable design, substrate abstraction in Phase 1 so the
later Postgres phase reuses not rewrites. OAuth/auth is a hard gate — verify
end-to-end, don't trust a clean build. Markdown files never via Desktop Commander
write APIs.
