# Fly Deployment

> Current status: the old Fly volume + git working-copy pilot is retired. Keep this document as the hosted HTTP deployment runbook, but the runtime state now belongs in Supabase Postgres plus private Supabase Storage. The personal hosted MCP serves only `ai-brain-jem`; local stdio `brain-local` remains the local-filesystem fallback. The ERS Brain runs on a separately owned deployment.

This is the hosted target for remote MCP clients that need a public HTTPS URL. Fly can host the Node MCP server and OAuth flow, but it must not be the operational Brain data store. Markdown revisions are read/written through the configured `RevisionStore`; original/source artifacts are retained in the configured artifact store.

## Shape

- App name: `jem-brain-mcp`
- Public base: `https://jem-brain-mcp.fly.dev`
- MCP endpoint: `https://jem-brain-mcp.fly.dev/mcp`
- GitHub OAuth callback: `https://jem-brain-mcp.fly.dev/authorize/github/callback`
- Revision store: Supabase Postgres (`brain` schema)
- Artifact store: private Supabase Storage bucket (`brain-artifacts`)
- OAuth state root: deployment secret/storage path as configured by the hosted MCP server
- Brain registry: image-bundled `config/brain-platform.john-ers-pilot.json`
- Local Markdown mirror: maintained by the local sync agent, not by a Fly git checkout

## Why Fly Still Fits

The hosted MCP server needs a public HTTPS endpoint, a Node runtime, and OAuth callback handling. Fly is acceptable for that compute layer.

Fly should not provide the live Brain working copy. The previous deployment used a persistent volume and git checkout as the hosted write path. That path is retired because it allowed hosted state and local Markdown state to drift. Git is emergency async export/history only and must not return to routine Brain operations; see `docs/hosted-brain-recovery-and-git-export.md`.

The committed `fly.toml`, `Dockerfile`, and Fly entrypoint intentionally enforce this: no deploy key mount, no `BRAIN_AUTO_SYNC`, no `BRAIN_AUTO_PUSH`, and no SSH setup in the runtime image. Keep Supabase database URLs, OAuth secrets, and any service-role keys in Fly secrets, not in `fly.toml`.

## One-Time Setup

Apply the Supabase migrations and security gate before deploying the hosted MCP runtime:

```text
db/migrations/2026-06-14_001_hosted_brain_postgres.sql
db/migrations/2026-06-14_002_harden_hosted_brain_advisors.sql
db/migrations/2026-06-14_003_brain_runtime_role.sql
db/migrations/2026-06-22_001_durable_oauth_state.sql
db/migrations/2026-07-08_001_brain_file_tombstones.sql
db/migrations/2026-07-17_001_brain_revision_fts.sql
db/migrations/2026-08-19_001_bounded_sync_observability.sql
db/migrations/2026-08-22_001_source_reference_identity.sql
db/seeds/2026-06-14_001_bootstrap_pilot_brain.sql
db/seeds/2026-06-24_001_bootstrap_ers_brain_pilot.sql
docs/security/hosted-brain-supabase-security-gate.md
```

Migration `003` creates a no-login `brain_runtime` role with Brain-schema table grants and matching RLS policies. Create a separate login role/user for the hosted runtime, grant it membership in `brain_runtime`, and use that login in `BRAIN_REVISION_DATABASE_URL`. For Supabase pooler URLs, preserve the tenant suffix in the username format, for example `brain_runtime_user.<project-ref>`. Keep the database owner and Supabase service-role database credentials for administration only.

The eight migrations above are the complete current sequence and must be applied in filename order. The 2026-07-17 migration adds only a tombstone-filtered GIN full-text index over private revision content. The 2026-08-19 migration adds the private, runtime-only `brain.sync_heartbeats` current-state table and a small partial index for hosted operational telemetry; it does not delete historical heartbeat events. The 2026-08-22 migration adds portable source-reference identity fields and the private, runtime-only `brain.source_brain_links` table without invalidating existing source or artifact rows. Apply and security-check each migration separately on every deployment database.

> **`BRAIN_REVISION_DATABASE_URL` must use the Supabase _transaction_ pooler (port `6543`), not the _session_ pooler (port `5432`).** The runtime is a long-running server with a `pg.Pool`, and it shares the project's pooler client budget with the always-on local sync daemon and operator scripts. Session mode has a hard client cap (`pool_size`, ~15) and exhausts under that combined load with `EMAXCONNSESSION: max clients reached in session mode` (user-visible as failed Brain writes). The transaction pooler multiplexes short-lived clients and removes the ceiling; the code is compatible (client-scoped `begin`/`commit`, no named prepared statements / session GUCs / advisory locks / `LISTEN`). A secret reset that reverts this to `:5432` will re-trigger the outage — keep it on `:6543`. Use `sslmode=verify-full&sslrootcert=/app/config/prod-ca-2021.crt`; the image-bundled file is Supabase's public Root 2021 CA, not a tenant secret. Also keep `BRAIN_PG_POOL_MAX` (default 4) modest so the hosted runtime pool + telemetry pool + local sync pool sum well under the budget. Owned Postgres pools for the hosted runtime/source metadata, OAuth state, and local sync bound network stalls with `BRAIN_PG_CONNECTION_TIMEOUT_MS` (default `5000`), `BRAIN_PG_QUERY_TIMEOUT_MS` (default `30000`), `BRAIN_PG_STATEMENT_TIMEOUT_MS` (defaults to query timeout), and `BRAIN_PG_IDLE_TIMEOUT_MS` (default `10000`); OAuth state uses `BRAIN_OAUTH_STATE_PG_POOL_MAX` (default 2) for its pool size. Background and rationale: `ai-knowledge/protocols/SUPABASE_BEST_PRACTICES.md` § Connection Pooler Configuration.

Create or update a GitHub OAuth app for the hosted callback:

```text
Application name: Brain MCP Server
Homepage URL: https://jem-brain-mcp.fly.dev
Authorization callback URL: https://jem-brain-mcp.fly.dev/authorize/github/callback
Scopes requested by the server: read:user user:email
```

Create the Fly app:

```bash
fly apps create jem-brain-mcp
```

Set runtime secrets. Do not commit these values.

```bash
fly secrets set \
  MCP_OAUTH_SIGNING_SECRET="$(openssl rand -base64 48)" \
  GITHUB_OAUTH_CLIENT_ID="<hosted-github-oauth-client-id>" \
  GITHUB_OAUTH_CLIENT_SECRET="<hosted-github-oauth-client-secret>" \
  GITHUB_ALLOWED_LOGINS="<fallback-github-login>" \
  GITHUB_ALLOWED_EMAILS="johnemilad@hotmail.com" \
  BRAIN_OAUTH_STATE_STORE="postgres" \
  MCP_OAUTH_REFRESH_REUSE_GRACE_SEC="15" \
  BRAIN_REVISION_STORE="postgres" \
  BRAIN_REVISION_DATABASE_URL="<brain-runtime-postgres-url>" \
  BRAIN_ARTIFACT_STORE="supabase" \
  BRAIN_ARTIFACT_BYTE_ACCESS="metadata_only" \
  BRAIN_SUPABASE_URL="https://<project-ref>.supabase.co" \
  BRAIN_SUPABASE_STORAGE_BUCKET="brain-artifacts" \
  BRAIN_HTTP_TIMING_LOGS="1" \
  BRAIN_LINT_MODE_OVERRIDES='{"ai-brain-jem":"graph"}' \
  --app jem-brain-mcp
```

Do not set `BRAIN_SUPABASE_SERVICE_ROLE_KEY` for normal hosted runtime source metadata/search. Add it only for an ingestion/admin process with `BRAIN_ARTIFACT_BYTE_ACCESS=admin`, such as source artifact byte upload. Hosted MCP source reads currently return manifests and extracted text, not original bytes.

Do not set `BRAIN_AUTO_SYNC=true`, `BRAIN_AUTO_PUSH=true`, or a deploy key for the Supabase-backed hosted runtime. Those belong to the retired git hot path.

The image-bundled registry is the access authority for the personal JEM-only deployment and matches John by stable GitHub provider id. `GITHUB_ALLOWED_LOGINS` and `GITHUB_ALLOWED_EMAILS` are fallback controls for the default Brain only; do not use them as an organisational access model.

Hosted OAuth client registration, auth-code, OAuth-state, and refresh-token metadata should use `BRAIN_OAUTH_STATE_STORE=postgres`. File-backed OAuth state is acceptable for local harnesses only; on Fly it can be lost with machine replacement and leave Claude/ChatGPT connectors holding stale credentials. `MCP_OAUTH_REFRESH_REUSE_GRACE_SEC=15` preserves normal refresh-token rotation while tolerating short cloud-client refresh races across web, desktop, and mobile surfaces.

When migrating an already-enrolled connector from file-backed OAuth state to Postgres-backed OAuth state, expect one re-enrollment per client account. Existing Claude-held refresh tokens cannot be migrated from the server side because the server only stores their hash. After re-enrollment, future redeploys and Fly machine replacement should not require reconnecting solely because the server lost OAuth state.

The personal deployment must point only to a personal-owned, JEM-only Supabase project. The ERS deployment uses a separate ERS-owned project with the same migrations and environment contract.

The Fly runtime reads the non-secret JEM-only registry from `/app/config/brain-platform.john-ers-pilot.json`. The filename is retained for deployment compatibility; its contents, not its historical name, define the current single-Brain registry. Do not depend on `/data/config/registry.json` for the current deployment.

For local operator scripts, copy `.env.local.example` to `.env.local` and fill the secret values once. The Postgres/Supabase smoke, seed, verify, inventory, and upload scripts load `.env.local` automatically; deployment still uses the hosting secret manager.

## Deploy

Production deploys are release-tag-only. Every commit that changes the package
version must receive its matching annotated `v<version>` tag immediately; do not
deploy an untagged branch head or a lightweight tag.

```bash
BRAIN_FLY_APP=jem-brain-mcp npm run deploy:guarded
```

The guarded deploy refuses a dirty tree, a non-exact or non-annotated tag, and a
tag that does not match `package.json`. It runs `npm test` before calling Fly,
with hosted-runtime and credential environment variables removed from the test
subprocess so `.env.local` cannot redirect isolated tests to the live database,
passes the commit SHA and package version into OCI image labels, and appends the
successful app/tag/SHA/date record to the ignored local file
`.brain-deploy/provenance.jsonl` (override with
`BRAIN_DEPLOY_PROVENANCE_FILE`).

A private deployment mirror may carry a thin environment overlay while still
pinning its source release to an annotated upstream tag. In that checkout, set
`BRAIN_DEPLOY_UPSTREAM_TAG=v<version>` when running `deploy:guarded`. Overlay
mode requires the upstream tag to match `package.json` and be an ancestor of
`HEAD`; permits only added/modified `config/*.json`, `fly.toml`,
`test/deploy-expectations.json`, and `docs/*.md`; requires all four overlay
surfaces; and rejects every source, database, script, package, Dockerfile,
deletion, or rename delta. Provenance records both the peeled upstream SHA and
the overlay SHA, while the OCI revision label identifies the actual overlay
commit used to build the image. Do not use overlay mode to deploy a source-code
fork or to bypass a failing release gate.

## Runtime Smoke Tests

```bash
curl -s https://jem-brain-mcp.fly.dev/health | jq .
curl -i https://jem-brain-mcp.fly.dev/.well-known/oauth-protected-resource/mcp
```

`/health` should report `runtime.revisionStore=postgres`, `runtime.artifactStore=supabase`, `runtime.oauthStateStore=postgres`, and `runtime.gitHotPath=disabled`. It must not include database URLs, Supabase keys, or other secret values.

Then enroll a remote MCP client against:

```text
https://jem-brain-mcp.fly.dev/mcp
```

For an operator-controlled OAuth enrollment smoke, run:

```bash
npm run smoke:hosted:oauth
```

The script reuses a local refresh-token cache when available, then performs read-only hosted MCP checks. On first run, or when the cached grant has expired or been revoked, it registers a temporary public OAuth client, opens or prints the GitHub authorization URL, listens on a local loopback callback, exchanges the authorization code, and updates the cache. Access tokens stay in memory; only the rotating refresh token is written locally with `0600` permissions. Set `BRAIN_HOSTED_OAUTH_OPEN=0` to print the URL without opening a browser, `BRAIN_HOSTED_OAUTH_TOKEN_CACHE` to override the cache path, or pass `--reauth` to force a new browser approval.

For a single operator rehearsal that runs the hosted doctor, OAuth MCP read/write parity, local-to-hosted parity, conflict lifecycle, latency snapshot, and final doctor summary, run:

```bash
npm run hosted:test-drive
```

The final output is intended to be readable without inspecting raw JSON: it reports pass/warn/fail status, hosted/local inventory, open conflicts, sync cycle activity, user-facing read/write/sync latency, and the next operator action. Use `--read-only` for a non-mutating check or `--skip-conflict` when the write parity checks are desired but the conflict lifecycle is not.

After `hosted:test-drive` passes, follow [`docs/hosted-client-cutover.md`](./hosted-client-cutover.md) to add hosted MCP as a shadow `brain-hosted` connector in Claude or Codex, exercise real-client reads and one narrow write, and decide when to promote hosted as the normal remote JEM path.

For a non-destructive hosted operator check, run:

```bash
BRAIN_FLY_APP=jem-brain-mcp npm run hosted:doctor
```

The doctor reports public hosted health, Supabase Postgres summary counts, local sync state, last successful sync health, sync lock state, lint freshness, pending inbox files, launchd status on macOS, Fly app status when `flyctl` is available, and a `pooler_config` check that classifies `BRAIN_REVISION_DATABASE_URL` (warns on the session pooler `:5432`; reports active connection count + per-pool `max`). It redacts database credentials by reporting only whether the database URL is set. A failed hosted health, Postgres summary, or sync health error exits non-zero; stale local launchd/Fly/lint/inbox warnings are reported without blocking the command. Set `BRAIN_SYNC_HEALTH_MAX_AGE_MS` to change the stale-health threshold, `BRAIN_SYNC_CLOSE_TIMEOUT_MS` to change how long the local sync daemon waits for store shutdown before exiting for launchd restart, or `BRAIN_LINT_NUDGE_DAYS` to change the lint freshness threshold.

For a browser-visible local operator view over the same read-only checks, run:

```bash
npm run hosted:cockpit
```

The cockpit binds to `127.0.0.1:8787` by default and falls forward to the next available local port when the default is already occupied. In the consolidated Brain Monitor stack, `GET /api/doctor` reads the Monitor-owned last-good report and the page reloads that cache once per minute; it does not spawn a second doctor. A standalone cockpit with no `BRAIN_COCKPIT_DOCTOR_OUTPUT` retains on-demand doctor execution. The surface is intended for local visibility; it should not be exposed publicly or used as a general admin mutation surface. Set `BRAIN_COCKPIT_PORT` or `BRAIN_COCKPIT_HOST` only for deliberate local operator needs. Set `BRAIN_COCKPIT_PORT_FALLBACK=0` to make occupied-port startup fail instead of trying the next port.

File counts are inventory counts, not an activity log. Updating an existing smoke file should leave the hosted/local file counts unchanged. Use the cockpit's Recent Brain Activity panel, Operation Log, and Cockpit Watch to see revision writes, hosted MCP operations, conflict open/resolution events, sync pulls/pushes, and local-time timestamps while exercising hosted MCP operations.

The cockpit also reports latency and usage from the same telemetry table. User-facing read/write operation latency comes from real hosted MCP server tool calls, recorded to Supabase Postgres `brain.sync_events` with event type `hosted_mcp_latency`, metadata source `hosted_mcp_server`, `timingLayer = "server_tool"`, and `durationType = "server_tool_handler"`. Server telemetry writes are best-effort and non-blocking by default; use `BRAIN_HOSTED_MCP_LATENCY_AWAIT_DB_WRITE=1` only when deliberately diagnosing telemetry-write latency. Server rows include bounded sanitized DB summaries/spans when Postgres work occurs: operation/table names, durations, row counts, status, and bounded error text, never SQL text, query parameters, file content, patch text, source content, or search query text. Sync-wait latency comes from hosted smoke/test-drive flows because it measures local-hosted propagation, not a single server handler. Those flows also write client-observed end-to-end rows by default with source `hosted_mcp_client_e2e` and `timingLayer = "client_e2e"`; disable that diagnostic layer with `BRAIN_HOSTED_MCP_CLIENT_LATENCY_DB_WRITE=0`. `.brain-sync/hosted-mcp-latency.json` is only a fallback cache when Postgres is unavailable or `BRAIN_HOSTED_MCP_LATENCY_CACHE=1` is set. The doctor reads Postgres through one two-connection pool with a five-second timeout and refreshes historical operation telemetry at most every 15 minutes unless a manual force-deep check is requested. The dashboard shows SLO status, performance findings, DB span hotspots, timing-layer, operation-kind, exact-tool, slowest-operation, and DB-contribution summaries, plus total operation counts for all recorded server/sync telemetry, 24H, and 7D windows. The Activity tab has a bounded metadata-only operation log; tune its default 60-row/30-day window with `BRAIN_HOSTED_MCP_EVENT_LOG_LIMIT` and `BRAIN_HOSTED_MCP_EVENT_LOG_DAYS`. Infrastructure latency covers the hosted health request, Postgres summary query, most recent local sync cycle, total doctor run, and each underlying doctor check. The initial SLO layer is conservative and operator-facing; tune it with the `BRAIN_SLO_*` thresholds documented in `docs/hosted-cockpit.md`.

If doctor reports open conflicts, follow [`docs/conflict-resolution.md`](./conflict-resolution.md). Conflicts should be surfaced proactively and resolved with reviewed Markdown content, not hidden by manual database edits or duplicate filenames.

For a user-launchable local cockpit that does not require a Codex session or terminal to keep running, generate a reviewable macOS LaunchAgent:

```bash
npm run hosted:cockpit:launchd:plist
```

The generated plist binds cockpit to `127.0.0.1:8787`, disables port fallback so the URL stays stable, and writes logs beside the Brain sync health files. Review and install it per [`docs/hosted-cockpit.md`](./hosted-cockpit.md). This local LaunchAgent path is the current operator recommendation; a hosted persistent admin website is deferred until multi-user auth and local-first sync visibility are redesigned.

To include the hosted write/local mirror parity gate:

```bash
npm run smoke:hosted:oauth -- --write --verify-local
```

This writes only `HOSTED_OAUTH_WRITE_SMOKE.md`, reads it back from hosted Postgres, and waits for the local Markdown mirror to match. If the launchd sync loop has not pulled it yet, the script runs one bounded sync cycle for that file.

To include the reverse local-to-hosted parity gate:

```bash
npm run smoke:hosted:oauth -- --local-write --verify-hosted
```

This writes only `HOSTED_OAUTH_WRITE_SMOKE.md` in the local Markdown Brain, waits for the local sync agent to push it to hosted Postgres, then verifies the hosted MCP read matches.

To include the hosted conflict lifecycle gate:

```bash
npm run smoke:hosted:oauth -- --conflict
```

This writes the dedicated smoke file through hosted MCP, creates a dirty local edit in a temporary local mirror, runs one bounded sync cycle to create a conflict, verifies the conflict is visible through hosted MCP, resolves it with reviewed replacement smoke content through `brain_resolve_conflict`, and removes the temporary mirror.

Expected first authenticated tool checks:

- `brain_list_brains`
- `brain_describe` with `brain_id=ai-brain-jem`
- `brain_load_context`
- `brain_list_files` should show hosted Markdown files from Postgres.
- `brain_sync_status` should report `Provider: revision` and the current open conflict count.
- `brain_list_conflicts` should show open sync conflicts or report none.
- `brain_search` should search hosted Markdown revisions from Postgres.
- `brain_list_sources` should show source manifests from Postgres.
- `brain_read_file` with `scope="sources"` should return a metadata manifest, not private artifact bytes.
- A small hosted write should create a Postgres revision without invoking git.

From a shell with hosted Supabase secrets set, the direct HTTP-handler smoke script exercises those same authenticated MCP paths without printing secrets:

```bash
npm run smoke:http:postgres
```

By default this does not write to the Brain. To include a tiny hosted write, set `BRAIN_HTTP_SMOKE_WRITE=1`; it writes `HOSTED_RUNTIME_SMOKE.md`.

For repeatable read-path latency checks, run the hosted benchmark. It calls read-only MCP tools multiple times and prints duration summaries only:

```bash
npm run bench:http:postgres
```

HTTP startup warms the hosted Brain store by default before accepting traffic. Set `BRAIN_HTTP_WARMUP=0` only for deliberate cold-start debugging. The benchmark also warms each measured scenario by default; set `BRAIN_HTTP_BENCH_WARMUP=0` to include cold path timings.

For the local Markdown mirror, `npm run sync -- watch` runs the interim polling sync loop. Set `BRAIN_SYNC_INTERVAL_MS` for cadence and `BRAIN_SYNC_WATCH_CYCLES` only for bounded smoke tests or scheduled jobs. Watch mode emits compact per-cycle summaries by default; set `BRAIN_SYNC_WATCH_OUTPUT=full` when debugging a specific sync report. Each successful watch cycle writes `${BRAIN_SYNC_STATE_FILE}.health.json` by default, or `BRAIN_SYNC_HEALTH_FILE` when set, with last-success counts for `hosted:doctor`.

The sync CLI uses an atomic lock file to prevent overlapping local mirror runs. By default the lock is `${BRAIN_SYNC_STATE_FILE}.lock`; set `BRAIN_SYNC_LOCK_FILE` only when the state path is shared in a non-standard layout. Locks include the owning PID and start time. A live owner still blocks overlapping runs, while malformed or dead-owner locks are replaced automatically on the next run.

Use `npm run sync -- summary` for routine operator checks. It reports compact counts and cursor status. Use `npm run sync -- status` only when the full tracked-file and hosted-head payload is needed for debugging.

On macOS, generate a reviewable launchd plist for the local mirror loop:

```bash
npm run sync:launchd:plist
```

The script writes `tmp/com.jem.brain-sync.plist` by default. Review it, then install manually if appropriate:

```bash
cp tmp/com.jem.brain-sync.plist ~/Library/LaunchAgents/com.jem.brain-sync.plist
launchctl load ~/Library/LaunchAgents/com.jem.brain-sync.plist
```

Unload it with:

```bash
launchctl unload ~/Library/LaunchAgents/com.jem.brain-sync.plist
```

The plist runs the compiled sync CLI directly through the absolute Node path captured when the plist is generated, relies on the repo `.env.local` for private Supabase settings, and writes logs under the Brain `.brain-sync/` directory by default. Set `BRAIN_SYNC_STATE_FILE`, `BRAIN_SYNC_LOCK_FILE`, `BRAIN_SYNC_HEALTH_FILE`, or `BRAIN_SYNC_LAUNCHD_LOG_DIR` to move daemon state and logs outside the Brain checkout. For SharePoint/OneDrive CloudStorage Brains, prefer `npm run sync:helper:install` to create an app under `~/Applications`, grant the generated helper app Full Disk Access, then use `npm run sync:helper:launchd:plist` if the helper should auto-start at login. macOS may deny raw launchd background processes direct access to the cloud-backed working tree even when Terminal can read it. A daemon-local checkout is a temporary fallback, not the normal authority, when OneDrive is the human-facing Brain source. Run `npm run build` before regenerating the plist or helper app, and regenerate it after changing Node installations.

After any deployment that changes schema, RLS, functions, Storage, or user-data access, rerun the security gate in `docs/security/hosted-brain-supabase-security-gate.md`.

## Notes

- Keep `auto_stop_machines = "off"` unless OAuth state is durably backed by Postgres and hosted warmup behavior has been checked after scale-to-zero/startup.
- If the app name changes, update `app`, `MCP_OAUTH_PUBLIC_BASE`, and GitHub OAuth callback URL together.
- Add client callback URLs to `MCP_OAUTH_ALLOWED_REDIRECT_URIS` only when a client requires a non-loopback redirect that is not already trusted. ChatGPT connector callbacks under `https://chatgpt.com/connector/oauth/<id>` and the legacy `https://chatgpt.com/connector_platform_oauth_redirect` callback are trusted by code; other remote callbacks should be added as exact values only.
- Brain dates use `BRAIN_DATE_TIME_ZONE`; the Fly app currently sets this to `Asia/Ho_Chi_Minh` so journal/log entries match John's working date rather than UTC.
- Store Supabase database URLs and service keys only in deployment secrets or a password manager. They must not appear in docs, commits, logs, screenshots, or client-side environment variables.
- `BRAIN_HTTP_TIMING_LOGS=1` enables coarse MCP request timing logs with method, path, status, and duration only; request bodies and authorization headers are not logged.
