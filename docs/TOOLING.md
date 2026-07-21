# Tooling And Script Safety

**Status:** active operational reference
**Last updated:** 2026-06-27

This file records the local, hosted, and system-tool assumptions for `brain-mcp-server`. The package graph is small; the operational surface is not. Treat Fly, Supabase, local sync state, LaunchAgents, Playwright browsers, and hosted Brain writes as separate risk classes from ordinary TypeScript checks.

## Runtime And Package Manager

| Tool | Supported baseline | Where declared |
|---|---|---|
| Node.js | `22.x` | `package.json` `engines.node`, `Dockerfile` `node:22-slim`, Fly runtime image |
| npm | `10.9.8` | `package.json` `packageManager` |
| TypeScript | repo dependency | `package-lock.json` |

- Use Node 22 for local development, CI-style checks, Docker builds, Fly deploy parity, and generated LaunchAgent/menu-bar paths.
- The Mac's default shell may have a newer Node/npm. Do not treat that as the supported Brain MCP baseline unless the Docker/Fly path is deliberately revalidated.
- This is an npm project. `package-lock.json` is the lockfile; do not introduce pnpm, yarn, Bun, or a monorepo runner as tooling cleanup.
- Use `npm ci` for a clean reproducible install. Use `npm install` only when intentionally changing dependencies or regenerating `package-lock.json`.
- Local operator app and LaunchAgent generators capture the absolute Node executable used when they run. Regenerate those artifacts after changing the Node installation or switching runtime versions.

## System And Hosted Dependencies

| Dependency | Used for | Notes |
|---|---|---|
| Docker | Builds the hosted image and supports some Supabase/export workflows | Required for deploy/recovery work, not for ordinary TypeScript checks. |
| Fly CLI (`fly`/`flyctl`) | App status, secrets, deploys | Deploy-affecting. Keep secrets in Fly, not in docs or commits. |
| Supabase Postgres | Hosted revisions, OAuth state, conflicts, source metadata, telemetry | Use runtime DB URLs only from `.env.local` or hosting secrets. Never print or commit them. |
| Supabase Storage | Private source/artifact bytes | Normal hosted runtime should use metadata/extracted text, not service-role byte access. |
| Playwright chromium | Cockpit E2E check | Install once per machine with `npx playwright install chromium`; not part of `npm ci`. |
| macOS `launchctl`, LaunchServices, Full Disk Access | Local sync/helper/menu-bar operator surfaces | LaunchAgent/app generation writes local artifacts and may need privacy permissions for CloudStorage Brains. |
| Git | Local filesystem fallback and emergency export/history | Git is not the live hosted sync fabric and should not be re-promoted into routine Brain operations. |

## Command Safety Taxonomy

### Safe Local Checks

- `npm run build` - TypeScript compile.
- `npm test` - build plus Node test runner. Safe for logic verification; may be broader than needed for docs-only edits.
- `npm run eval:brain:routing -- --jem-dir ... --ers-dir ...` - read-only routing eval against supplied local Brain roots.
- `npm run hosted:doctor` - non-destructive hosted/local operator check. It reads hosted health, Postgres summaries, local sync state, launchd status, Fly status when available, lint freshness, and inbox state. It may require local secrets for full Postgres visibility.
- `npm run hosted:cockpit` - starts a local read-only browser surface on loopback.
- `npm run test:cockpit:e2e` - Playwright cockpit E2E using deterministic fixture data; requires installed chromium.
- `npm run sources:inventory:postgres`, `npm run sources:verify-list:postgres` - read/report source metadata when configured.
- `npm run bench:http:postgres` - read-only benchmark, but networked and telemetry-adjacent; run only when measuring hosted performance.

### Local-State Mutating

- `npm run dev`, `npm run start`, `npm run sync -- watch`, `npm run sync -- once`, and `npm run sync -- pull` start processes or update local mirror/state files.
- `npm run sync:launchd:plist`, `npm run hosted:cockpit:launchd:plist`, `npm run sync:helper:launchd:plist`, and `npm run sync:menubar:launchd:plist` generate local LaunchAgent plists under `tmp/` or configured paths.
- `npm run sync:helper:install`, `npm run hosted:cockpit:launcher:install`, and `npm run sync:menubar:install` create local macOS app bundles.

### Hosted/Postgres Mutating

- `npm run sync -- push`, `sync:canary:postgres`, `sync:seed:core:postgres`, `sync:seed:all-markdown:postgres`, and `sync:reconcile:duplicate-brain-paths` can write hosted revision/conflict state.
- `npm run sources:upload:postgres` and `sources:extract-text:postgres` write source artifact metadata, Storage objects, or extracted text records depending on configuration.
- `npm run smoke:http:postgres` is read-only by default, but writes when `BRAIN_HTTP_SMOKE_WRITE=1`.
- `npm run smoke:hosted:oauth` is read-only by default, but `--write`, `--local-write`, and `--conflict` perform hosted/local parity or conflict-lifecycle writes.
- `npm run hosted:test-drive` includes write/conflict gates by default. Use `--read-only` for a non-mutating operator check.

### Deploy-Affecting Or Secret-Affecting

- `fly deploy --app jem-brain-mcp`, `fly secrets set ...`, and `fly apps create ...` affect hosted infrastructure.
- Applying `db/migrations/*.sql` or `db/seeds/*.sql` changes Supabase state. Rerun `docs/security/hosted-brain-supabase-security-gate.md` after migrations touching schemas, RLS, functions, Storage, or user data.
- Backup/restore/export rehearsals can affect Supabase projects, Storage, Docker state, or external CLI state. Use `docs/hosted-brain-recovery-and-git-export.md` as the runbook.

## Hosted/Local State Boundaries

- The personal hosted MCP is the normal remote path for `ai-brain-jem`; the dedicated ERS deployment serves `ers-brain`.
- Local stdio Brain and local Markdown remain fallback/recovery surfaces.
- Supabase Postgres owns hosted revisions, OAuth state, conflicts, cursors, source metadata, and telemetry.
- Supabase Storage owns private source/artifact bytes.
- Git is emergency export/history only; routine Brain work should not depend on manual commit/push/merge.
- The cockpit and menu-bar app are local-only, read-only operator surfaces. They must not expose Brain writes, conflict resolution, hosted admin mutations, or public network binding.

## Verification Guidance

- Docs/metadata-only edits: JSON parse, markdown/link scans where relevant, and `git diff --check`.
- Type or config edits: `npm run build`.
- Logic, schema, sync, hosted doctor, or cockpit changes: `npm test`.
- Cockpit UI/layout changes: `npm run test:cockpit:e2e` after `npx playwright install chromium` has been run for the machine.
- Hosted-state or deploy work: include `npm run hosted:doctor` or `npm run hosted:test-drive -- --read-only` before mutating commands, then run the relevant post-change smoke from the runbook.
