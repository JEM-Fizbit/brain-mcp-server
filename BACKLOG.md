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

- Urgent: design a Brain Sync menu-bar app, but first complete an architecture simplification review. Challenge whether the current local OneDrive + local helper + LaunchAgent + cockpit/doctor + Supabase + Git backup + local MCP server model can be consolidated into a more portable operator architecture for ERS colleagues, including Windows/PC users, before productizing the macOS helper UX. Explicitly decide which legacy/fallback surfaces remain supported versus deprecated.
- Design a cloud-run Brain health/inbox operations service to replace fragile Claude scheduled Routines where appropriate. Scope: hosted lint/QA monitoring, per-Brain health checks, alerting/escalation, and periodic inbox sweep/ingest processing; preserve the local laptop inbox as a first-class drop folder and decide how local inbox state syncs or is mirrored before moving any processor to cloud execution.
- Review and transition ERS Brain Claude automations for hosted `ers-brain`. Current `~/.claude/scheduled-tasks/ers-brain-auto-pull/` assumes GitHub-pull-to-SharePoint review flow; decide whether to keep it as a backup or replace/adapt it around hosted sync events, `brain_lint({ brain_id: "ers-brain" })`, per-Brain cockpit/doctor checks, and Slack/nudge routing that distinguishes ERS from JEM.
- ERS Brain MCP fork / cutover (future, large). When the hosted Brain MCP graduates from John's personal beta (sole user, hardening) to a dedicated multi-tenant, multi-Brain ERS service, fork this repo into a dedicated ERS MCP. Scope: stand up separate Fly.io instance(s); migrate the Supabase DB (brain-platform-pilot, currently in the ERSG Prototypes org but personal-owned) to ERS control; and audit + migrate all other dependencies (OAuth/GitHub IdP, claude-jembot Slack bot + token, Supabase Storage, Fly secrets). Until then the hosted MCP stays personal-owned and is dual-registered in both the personal and ERS asset registers. Aligns with the Brain Platform roadmap's "ERS-owned Supabase migration / ERS multi-user" phase.
- Set up a PAT-based local Supabase MCP in Claude Code so one connection spans all orgs. The Supabase OAuth connector grants only one org per connection, but the Brain DB lives in the `ERSG Prototypes` org while personal projects live in `johnemilad@hotmail.com's Org` — forcing a re-auth dance to switch between them. A Supabase Personal Access Token is account-scoped, so a single local connector (e.g. `@supabase/mcp-server-supabase --access-token`) would see every org at once and retire the switching.
- Add operator-selectable time windows (1H / 1D / 1W / 1M) to the cockpit/doctor latency views — currently fixed to 24H + 7D. Lets latency be inspected over different horizons (e.g., spot a recent regression vs the long-run baseline) instead of a blended fixed window.
- Expand hosted Brain observability beyond the initial cockpit SLO layer: representative latency/reliability measures for every MCP tool, real-world organic end-to-end usage sampling, correlation IDs if needed, dashboard rollups, sanitized `User-Agent` capture on auth failures (gated by the Supabase security review — names unregistered/zombie clients that have no `clientId` join), and per-user attribution (`github_login`/`provider_user_id`) on success/tool telemetry. (Auth-failure Slack alerting shipped via spec 004; `clientId`/`grantType` recording + stale-connector classification is spec 005; latency/SLO alerting still pending baseline distributions.)
- Convert the Brain Cockpit desktop launcher into a distributable macOS app package: signed/notarized bundle, installer or DMG packaging, versioned update path, reusable branding/icon assets, and documented install/uninstall flow for non-terminal users.
- Reduce hosted Brain MCP latency: instrument request/tool timings end-to-end, measure Codex client overhead vs server work, and optimize common read/write flows so hosted does not feel worse than local files.
