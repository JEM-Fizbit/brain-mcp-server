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

- Expand hosted Brain observability beyond the initial cockpit SLO layer: representative latency/reliability measures for every MCP tool, real-world organic end-to-end usage sampling, correlation IDs if needed, dashboard rollups, and alerting once baseline distributions are known.
- Convert the Brain Cockpit desktop launcher into a distributable macOS app package: signed/notarized bundle, installer or DMG packaging, versioned update path, reusable branding/icon assets, and documented install/uninstall flow for non-terminal users.
- Reduce hosted Brain MCP latency: instrument request/tool timings end-to-end, measure Codex client overhead vs server work, and optimize common read/write flows so hosted does not feel worse than local files.
