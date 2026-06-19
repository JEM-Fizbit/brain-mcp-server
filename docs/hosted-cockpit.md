# Hosted Brain Cockpit

**Status:** active operator guide
**Last updated:** 2026-06-18

Brain Cockpit is the local read-only operator surface for the hosted JEM Brain pilot. It is meant to answer one question quickly: can hosted Brain be trusted right now, or does John need to intervene before using it?

## Current Recommendation

Use a local browser surface backed by a macOS LaunchAgent:

- cockpit stays bound to `127.0.0.1`;
- the stable local URL is `http://127.0.0.1:8787/`;
- checks continue to come from `npm run hosted:doctor`;
- local sync health, launchd state, local mirror state, lint freshness, inbox state, and local latency snapshots remain visible;
- user-facing hosted MCP latency shows latest, average, p50, p95, failures, and short trendlines for read, write, and sync-wait operations;
- no Brain writes or conflict resolutions are exposed from the cockpit.

Do not build a hosted persistent admin website yet. A hosted website would be useful later, but today it would hide the most important local-first signals: whether the Mac sync loop is alive, whether the local Markdown mirror is current, whether local credentials are configured, and whether the operator's local state is stale.

## Generate The LaunchAgent

From the repo:

```bash
npm run hosted:cockpit:launchd:plist
```

Default assumptions:

- Brain checkout: `~/Projects/ai-brain-jem`;
- cockpit launchd label: `com.jem.brain-cockpit`;
- cockpit URL: `http://127.0.0.1:8787/`;
- Node runtime: the `node` executable running the generator.

For another local Brain checkout or label, set environment variables before generating:

```bash
BRAIN_REPO_ROOT="$HOME/Projects/<brain-repo>" \
BRAIN_COCKPIT_LAUNCHD_LABEL="com.example.brain-cockpit" \
BRAIN_COCKPIT_PORT=8787 \
npm run hosted:cockpit:launchd:plist
```

This writes a reviewable plist to:

```text
tmp/com.jem.brain-cockpit.plist
```

The generated plist runs `scripts/hosted-cockpit.mjs` directly through an absolute Node path. It does not run through `npm`, shell aliases, or PATH-dependent wrappers. It sets `BRAIN_COCKPIT_PORT_FALLBACK=0` so the browser URL stays stable; if port `8787` is occupied, the service should fail visibly rather than silently move to a new URL.

The plist also sets a conservative runtime `PATH` including Homebrew locations so `hosted:doctor` can find operator tools such as `flyctl` when running under launchd's sparse default environment. Override with `BRAIN_COCKPIT_LAUNCHD_PATH` if the tool layout changes.

## Install On macOS

Review the generated plist first, then install it as a user LaunchAgent:

```bash
cp tmp/com.jem.brain-cockpit.plist ~/Library/LaunchAgents/com.jem.brain-cockpit.plist
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.jem.brain-cockpit.plist
launchctl kickstart -k "gui/$(id -u)/com.jem.brain-cockpit"
```

Then open:

```text
http://127.0.0.1:8787/
```

## Install The Desktop Launcher

To create a double-clickable launcher app:

```bash
npm run hosted:cockpit:launcher:install
```

This writes:

```text
~/Desktop/Brain Cockpit.app
```

The app is a small local wrapper. It does not host anything itself and does not expose any write/admin surface. On launch, it asks launchd to start or kick `com.jem.brain-cockpit` if needed, then opens `http://127.0.0.1:8787/` in the default browser.

For a different user, app name, label, or local URL, use the same launcher script with overrides:

```bash
BRAIN_COCKPIT_LAUNCHER_APP="$HOME/Desktop/Brain Cockpit.app" \
BRAIN_COCKPIT_LAUNCHD_LABEL="com.example.brain-cockpit" \
BRAIN_COCKPIT_URL="http://127.0.0.1:8787/" \
BRAIN_COCKPIT_LAUNCHER_BUNDLE_ID="com.example.brain-cockpit.launcher" \
npm run hosted:cockpit:launcher:install
```

The launcher and LaunchAgent labels must match. If the LaunchAgent was generated with `BRAIN_COCKPIT_LAUNCHD_LABEL="com.example.brain-cockpit"`, use the same value when installing the Desktop launcher.

To stop it:

```bash
launchctl bootout "gui/$(id -u)/com.jem.brain-cockpit"
```

## Operator Contract

Green means hosted Brain is ready for normal use.

Warn means use judgement. Typical examples are stale sync health, stale or missing Brain lint, pending inbox files, missing optional Fly status, or no recent measured hosted MCP latency.

Fail means pause hosted writes until the issue is understood. Typical examples are hosted health failure, Postgres summary failure, or sync health error.

Open conflicts must be resolved through `docs/conflict-resolution.md`. Do not manually delete database rows to make the cockpit green.

## Latency Trend Semantics

The cockpit does not run hidden writes just to refresh charts. User-facing latency normally comes from real hosted MCP server tool calls. The hosted server records one latency sample per tool invocation after the handler finishes, including successful and failed read, write, and operational calls.

Hosted tool calls write user-facing latency samples to Supabase Postgres `brain.sync_events` with event type `hosted_mcp_latency` and metadata source `hosted_mcp_server`. The telemetry row records tool name, operation kind, safe target metadata such as filename or category, latency, and success/failure state; it does not record file content, patch text, source content, or search query text. The cockpit reads server-emitted Postgres rows first when `BRAIN_REVISION_DATABASE_URL` is configured.

Sync-wait latency is measured by `npm run smoke:hosted:oauth` and `npm run hosted:test-drive`, because it measures local-hosted propagation rather than one server tool handler. Those flows write `sync_wait` rows by default. For end-to-end client timing diagnostics of all tool calls, set `BRAIN_HOSTED_MCP_CLIENT_LATENCY_DB_WRITE=1`; those rows are a compatibility/diagnostic fallback, not the normal read/write source.

If Postgres is unavailable, or if `BRAIN_HOSTED_MCP_LATENCY_CACHE=1` is set, the smoke flow writes a bounded fallback cache to:

```text
<brain-repo>/.brain-sync/hosted-mcp-latency.json
```

Treat Postgres as the source of record and the JSON file as a fallback/cache, not the primary metrics store.

The cockpit also reports aggregate operation usage from the same Postgres telemetry rows. The top-level cards show total recorded operations, operations in the last 24H, and operations in the last 7D. The Overview tab breaks those counts down by operation kind, including read, write, sync-wait, and other operational calls, with failed operations counted separately.

The Activity tab separates content-state activity from operation telemetry. Recent Brain Activity shows Brain state changes, such as file revisions and conflict open/resolution events. Operation Log is the event log: a bounded metadata feed from `brain.sync_events`, not Brain content. By default it shows up to 60 events from the last 30 days; tune this with `BRAIN_HOSTED_MCP_EVENT_LOG_LIMIT` and `BRAIN_HOSTED_MCP_EVENT_LOG_DAYS`. Rows include tool name, operation kind, safe target metadata, source, success/failure state, timestamp, and latency. Cockpit Watch is local to the open browser session and reports refresh-observed status, sync, and conflict-count changes.

The Latency tab groups successful samples into three operator-level buckets:

- read operations;
- write operations;
- sync wait operations.

For each bucket, the cockpit shows latest, average, p50, p95, range, sample count, failed count, and a short trendline. Failed samples are counted separately and shown in the recent sample list, but they are not included in the latency averages.

Refresh remains read-only. The additional usage and operation-log views use bounded server-side Postgres reads over the existing telemetry table. They do not add hidden writes, a metrics daemon, another datastore, or a separate analytics service.

## Next Hardening

- Expand source-ingestion nudges beyond pending inbox count.
- Add a recovery/reseed guide from local Markdown to hosted Postgres.
