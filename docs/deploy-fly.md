# Fly Deployment

> Current status: the old Fly volume + git working-copy pilot is retired for the hosted Brain rebuild. Keep this document as the hosted HTTP deployment runbook, but the runtime state now belongs in Supabase Postgres plus private Supabase Storage. The local stdio `brain` MCP remains the baseline/default until hosted passes the local-first parity contract in `docs/specs/002-local-first-hosted-sync-contract.md`.

This is the hosted target for remote MCP clients that need a public HTTPS URL. Fly can host the Node MCP server and OAuth flow, but it must not be the operational Brain data store. Markdown revisions are read/written through the configured `RevisionStore`; original/source artifacts are retained in the configured artifact store.

## Shape

- App name: `jem-brain-mcp`
- Public base: `https://jem-brain-mcp.fly.dev`
- MCP endpoint: `https://jem-brain-mcp.fly.dev/mcp`
- GitHub OAuth callback: `https://jem-brain-mcp.fly.dev/authorize/github/callback`
- Revision store: Supabase Postgres (`brain` schema)
- Artifact store: private Supabase Storage bucket (`brain-artifacts`)
- OAuth state root: deployment secret/storage path as configured by the hosted MCP server
- Local Markdown mirror: maintained by the local sync agent, not by a Fly git checkout

## Why Fly Still Fits

The hosted MCP server needs a public HTTPS endpoint, a Node runtime, and OAuth callback handling. Fly is acceptable for that compute layer.

Fly should not provide the live Brain working copy. The previous deployment used a persistent volume and git checkout as the hosted write path. That path is retired because it allowed hosted state and local Markdown state to drift. Git may return later only as async export/history after sync succeeds.

The committed `fly.toml`, `Dockerfile`, and Fly entrypoint intentionally enforce this: no deploy key mount, no `BRAIN_AUTO_SYNC`, no `BRAIN_AUTO_PUSH`, and no SSH setup in the runtime image. Keep Supabase database URLs, OAuth secrets, and any service-role keys in Fly secrets, not in `fly.toml`.

## One-Time Setup

Apply the Supabase migrations and security gate before deploying the hosted MCP runtime:

```text
db/migrations/2026-06-14_001_hosted_brain_postgres.sql
db/migrations/2026-06-14_002_harden_hosted_brain_advisors.sql
db/migrations/2026-06-14_003_brain_runtime_role.sql
db/seeds/2026-06-14_001_bootstrap_pilot_brain.sql
docs/security/hosted-brain-supabase-security-gate.md
```

Migration `003` creates a no-login `brain_runtime` role with Brain-schema table grants and matching RLS policies. Create a separate login role/user for the hosted runtime, grant it membership in `brain_runtime`, and use that login in `BRAIN_REVISION_DATABASE_URL`. For Supabase pooler URLs, preserve the tenant suffix in the username format, for example `brain_runtime_user.<project-ref>`. Keep the database owner and Supabase service-role database credentials for administration only.

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
  GITHUB_ALLOWED_LOGINS="JEM-Fizbit" \
  GITHUB_ALLOWED_EMAILS="johnemilad@hotmail.com" \
  BRAIN_REVISION_STORE="postgres" \
  BRAIN_REVISION_DATABASE_URL="<brain-runtime-postgres-url>" \
  BRAIN_ARTIFACT_STORE="supabase" \
  BRAIN_ARTIFACT_BYTE_ACCESS="metadata_only" \
  BRAIN_SUPABASE_URL="https://<project-ref>.supabase.co" \
  BRAIN_SUPABASE_STORAGE_BUCKET="brain-artifacts" \
  BRAIN_HTTP_TIMING_LOGS="1" \
  --app jem-brain-mcp
```

Do not set `BRAIN_SUPABASE_SERVICE_ROLE_KEY` for normal hosted runtime source metadata/search. Add it only for an ingestion/admin process with `BRAIN_ARTIFACT_BYTE_ACCESS=admin`, such as source artifact byte upload. Hosted MCP source reads currently return manifests and extracted text, not original bytes.

Do not set `BRAIN_AUTO_SYNC=true`, `BRAIN_AUTO_PUSH=true`, or a deploy key for the Supabase-backed hosted runtime. Those belong to the retired git hot path.

The current pilot Supabase project is John's private-org project `brain-platform-pilot` (`omnwbcdtmtvxasgdmvwr`). ERS production must use an ERS-owned Supabase project with the same migrations and environment contract.

For local operator scripts, copy `.env.local.example` to `.env.local` and fill the secret values once. The Postgres/Supabase smoke, seed, verify, inventory, and upload scripts load `.env.local` automatically; deployment still uses the hosting secret manager.

## Deploy

```bash
npm test
fly deploy --app jem-brain-mcp
```

## Runtime Smoke Tests

```bash
curl -s https://jem-brain-mcp.fly.dev/health | jq .
curl -i https://jem-brain-mcp.fly.dev/.well-known/oauth-protected-resource/mcp
```

`/health` should report `runtime.revisionStore=postgres`, `runtime.artifactStore=supabase`, and `runtime.gitHotPath=disabled`. It must not include database URLs, Supabase keys, or other secret values.

Then enroll a remote MCP client against:

```text
https://jem-brain-mcp.fly.dev/mcp
```

For an operator-controlled OAuth enrollment smoke, run:

```bash
npm run smoke:hosted:oauth
```

The script registers a temporary public OAuth client, opens or prints the GitHub authorization URL, listens on a local loopback callback, exchanges the authorization code, and performs read-only hosted MCP checks. It keeps tokens in memory only and exits after verification. Set `BRAIN_HOSTED_OAUTH_OPEN=0` to print the URL without opening a browser.

For a non-destructive hosted operator check, run:

```bash
npm run hosted:doctor
```

The doctor reports public hosted health, Supabase Postgres summary counts, local sync state, last successful sync health, sync lock state, launchd status on macOS, and Fly app status when `flyctl` is available. It redacts database credentials by reporting only whether the database URL is set. A failed hosted health, Postgres summary, or sync health error exits non-zero; stale local launchd/Fly warnings are reported without blocking the command. Set `BRAIN_SYNC_HEALTH_MAX_AGE_MS` to change the stale-health threshold.

If doctor reports open conflicts, follow [`docs/conflict-resolution.md`](./conflict-resolution.md). Conflicts should be surfaced proactively and resolved with reviewed Markdown content, not hidden by manual database edits or duplicate filenames.

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

The plist runs the compiled sync CLI directly through the absolute Node path captured when the plist is generated, relies on the repo `.env.local` for private Supabase settings, and writes logs under the Brain `.brain-sync/` directory. Run `npm run build` before regenerating the plist, and regenerate it after changing Node installations.

After any deployment that changes schema, RLS, functions, Storage, or user-data access, rerun the security gate in `docs/security/hosted-brain-supabase-security-gate.md`.

## Notes

- Keep `auto_stop_machines = "off"` while OAuth state handling is file/local-process based.
- If the app name changes, update `app`, `MCP_OAUTH_PUBLIC_BASE`, and GitHub OAuth callback URL together.
- Add client callback URLs to `MCP_OAUTH_ALLOWED_REDIRECT_URIS` only when a client requires a non-loopback redirect that is not already trusted.
- Brain dates use `BRAIN_DATE_TIME_ZONE`; the Fly app currently sets this to `Asia/Ho_Chi_Minh` so journal/log entries match John's working date rather than UTC.
- Store Supabase database URLs and service keys only in deployment secrets or a password manager. They must not appear in docs, commits, logs, screenshots, or client-side environment variables.
- `BRAIN_HTTP_TIMING_LOGS=1` enables coarse MCP request timing logs with method, path, status, and duration only; request bodies and authorization headers are not logged.
