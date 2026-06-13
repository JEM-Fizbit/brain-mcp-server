# Backlog

> Lightweight capture for ideas, bugs, and small features. Newest at top, one line per item. No metadata, no IDs.
>
> **Capture:** say "add to backlog: X" mid-session, run `scripts/backlog.sh X` from terminal, or edit this file directly (mobile via Working Copy or any editor).
> **Promote:** say "promote item N" or "let's work on [item]" — Claude drafts a spec at `docs/specs/NNN-slug.md`.
> **On ship:** the line is deleted from this file. The archived spec at `docs/specs/archive/NNN-slug.md` is the durable record (source, criteria, work, commit).
>
> Universal protocol: [ai-knowledge/protocols/ROADMAP_AND_BACKLOG.md](https://github.com/JEM-Fizbit/ai-knowledge/blob/main/protocols/ROADMAP_AND_BACKLOG.md). Project-specific glue (verification commands, optional roadmap/audit/decision layers) lives in `CLAUDE.md`.
>
> Cross-source visibility: ask Claude to "show open work" (or run `scripts/show-open-work.sh`).

---

<!-- backlog items below; newest first -->

- Revisit Brain Platform storage architecture after hosted Fly pilot: compare git-backed filesystem working copies against a cloud database/content-store backend for reliability, security, mobile/remote access, backups, and operational cost.
- **Brain Platform Phase 1+2** (cloud, multi-tenant): HTTP transport + `BrainStore`/`BrainSemanticSearch` + `brain_id` + OAuth (GitHub IdP) + Tier 1 vector. Lift substrate from `~/Projects/slack-mcp-server/`. Kickoff: `~/Projects/claude-ops/plans/brain-platform/2026-06-13.md` → spec `docs/specs/001-*`.
