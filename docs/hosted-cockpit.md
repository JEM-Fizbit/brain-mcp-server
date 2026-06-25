# Hosted Brain Cockpit

**Status:** active operator guide
**Last updated:** 2026-06-25

Brain Cockpit is the local read-only operator surface for the hosted JEM Brain pilot. It is meant to answer one question quickly: can hosted Brain be trusted right now, or does John need to intervene before using it?

## Current Recommendation

Use the consolidated local menu-bar operator app as the normal John/operator
surface. It supervises the JEM and ERS local sync watchers plus their cockpit
servers, and it exposes each local cockpit as a loopback browser surface:

- cockpit stays bound to `127.0.0.1`;
- the stable JEM local URL is `http://127.0.0.1:8787/`;
- the stable ERS local URL is `http://127.0.0.1:8788/`;
- checks continue to come from `npm run hosted:doctor`;
- local sync health, launchd state, local mirror state, lint freshness, inbox state, and local latency snapshots remain visible;
- the `pooler_config` check classifies `BRAIN_REVISION_DATABASE_URL` (transaction `:6543` vs session `:5432` vs direct) and warns on session mode — whose hard ~15-client cap, shared across the hosted runtime pool + telemetry + local sync daemon + operator scripts, exhausts under load (`EMAXCONNSESSION`); it also reports the active backend connection count and the per-pool `max` (`BRAIN_PG_POOL_MAX`) for visibility;
- user-facing hosted MCP latency shows SLO status, performance findings, DB hotspots, latest, average, p50, p95, failures, and short trendlines for read, write, and sync-wait operations;
- hosted MCP auth failures show current-window counts, prior-window trend, safe reason/target metadata, and recent metadata-only events in a dedicated Activity > Auth subpanel;
- the cockpit header shows the active profile label as `<display name> (<brain_id>)` in the first-screen identity block, plus the local profile name, sync state path, cockpit URL, and metric scope; when the consolidated Brain Monitor app is installed with multiple profiles, the cockpit also exposes a profile selector using the same unambiguous labels and links to each configured local cockpit URL;
- the cockpit first screen includes a dedicated `Needs Action` panel above the tabbed sections; the Overview tab keeps the fuller `Next Actions` list for the same doctor actions;
- the cockpit first screen gives the primary health summary and `Needs Action` panel the top priority row, then moves secondary cards such as hosted/local file counts, operation volume, and latency into a separate `Operational Signals` section below that row;
- the doctor treats `BRAIN_SYNC_SUPERVISOR=menubar` as the normal consolidated path and checks the per-profile Brain Monitor stack file for the expected Brain id plus live sync watcher and cockpit child processes, rather than warning only on the retired raw `com.jem.brain-sync` LaunchAgent;
- the menu-bar app auto-refreshes each profile's hosted doctor output every 60 seconds by default, reads each profile's latest output, keeps the top-level dropdown compact, and nests each Brain's `Overview`, `Actions`, `Controls`, and `Diagnostics` under that Brain's submenu;
- the top-level menu includes `Open Cockpit` for the default/first configured Brain so the operator can reach the browser cockpit immediately, then switch profiles from the cockpit selector if needed;
- `Open Cockpit` is the supported entrypoint: Brain Monitor starts and supervises the local cockpit server itself, checks whether the cockpit script changed before opening the page, and restarts stale cockpit child processes automatically during the normal stack heartbeat;
- the top-level `Last monitor action` is app-wide across the consolidated Brain Monitor process, not per-Brain and not doctor-only; it includes the timestamp and latest monitor-recorded action from either configured Brain on separate indented rows so the dropdown stays narrow;
- operator-facing timestamps use `YYYY-MMM-DD; HH:MM:SS UTC+/-HH:MM`, rendered in the local machine timezone with an explicit UTC offset for global readability;
- the menu-bar status uses color plus text: green for `Brain OK`, orange/yellow for action, warning, offline, or initial checking states, and red for `Brain Fail`; routine automatic doctor polling does not switch a known-good status to yellow just because a poll is in flight;
- the menu-bar status distinguishes local connectivity loss (`Brain Offline`, local device cannot reach hosted Brain) from a hosted Brain stack fault (`Brain Fail`, hosted health responded unhealthy or another real check failed);
- no Brain writes or conflict resolutions are exposed from the cockpit.

Do not build a hosted persistent admin website yet. A hosted website would be useful later, but today it would hide the most important local-first signals: whether the Mac sync loop is alive, whether the local Markdown mirror is current, whether local credentials are configured, and whether the operator's local state is stale.

## Optional Cockpit E2E Check

Run the Playwright cockpit check after cockpit layout or hydration changes:

```bash
npx playwright install chromium
npm run test:cockpit:e2e
```

This is intentionally separate from `npm test`. It launches the real local
cockpit server on an ephemeral loopback port, uses a deterministic stub doctor
payload through `BRAIN_COCKPIT_DOCTOR_SCRIPT`, and verifies the first screen on
desktop and narrow viewports. Keep it optional until the browser dependency and
timing are proven stable enough for the default test path.

## Legacy Standalone Cockpit LaunchAgent

The standalone cockpit LaunchAgent remains available as a rollback/debugging
path, but it should not run beside the consolidated menu-bar app for the same
Brain.

From the repo:

```bash
npm run hosted:cockpit:launchd:plist
```

Default assumptions:

- Brain checkout: `~/Projects/ai-brain-jem`;
- Brain id: `ai-brain-jem`;
- cockpit launchd label: `com.jem.brain-cockpit`;
- cockpit URL: `http://127.0.0.1:8787/`;
- Node runtime: the `node` executable running the generator.

For another local Brain checkout or label, set environment variables before generating:

```bash
BRAIN_REPO_ROOT="$HOME/Projects/<brain-repo>" \
BRAIN_ID="<brain-id>" \
BRAIN_COCKPIT_LAUNCHD_LABEL="com.example.brain-cockpit" \
BRAIN_COCKPIT_PORT=8787 \
npm run hosted:cockpit:launchd:plist
```

The generated plist pins both `BRAIN_ID` and `BRAIN_DIR`, so the doctor checks, local sync health, and logs align with the selected Brain. For the ERS Brain pilot, use a distinct label and port, for example `BRAIN_ID=ers-brain`, `BRAIN_COCKPIT_LAUNCHD_LABEL=com.jem.ers-brain-cockpit`, and `BRAIN_COCKPIT_PORT=8788`.

If the Brain checkout lives under SharePoint/OneDrive CloudStorage, do not make
a daemon-local checkout the normal authority. Keep the cloud-backed checkout as
the human-facing local-first source, move sync state/logs outside the checkout,
and run the sync loop through the helper app described below. A raw launchd Node
process can be denied CloudStorage access by macOS privacy controls even when
Terminal can read the same files.

This writes a reviewable plist to:

```text
tmp/com.jem.brain-cockpit.plist
```

The generated plist runs `scripts/hosted-cockpit.mjs` directly through an absolute Node path. It does not run through `npm`, shell aliases, or PATH-dependent wrappers. It sets `BRAIN_COCKPIT_PORT_FALLBACK=0` so the browser URL stays stable; if port `8787` is occupied, the service should fail visibly rather than silently move to a new URL.

The plist also sets a conservative runtime `PATH` including Homebrew locations so `hosted:doctor` can find operator tools such as `flyctl` when running under launchd's sparse default environment. Override with `BRAIN_COCKPIT_LAUNCHD_PATH` if the tool layout changes.

## Legacy Standalone Install On macOS

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

## Legacy Desktop Launcher

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

To stop the cockpit LaunchAgent:

```bash
launchctl bootout "gui/$(id -u)/com.jem.brain-cockpit"
```

## Legacy Sync Helper App

For SharePoint/OneDrive CloudStorage Brains, prefer the menu-bar operator app
below. It owns the sync watcher and cockpit server as child processes and is the
only local login item needed for the consolidated John/operator stack.

The older sync helper app remains documented as a rollback path. It gives the
sync loop a stable app identity for CloudStorage reads while keeping the
OneDrive checkout as the primary human-facing Brain checkout, but it should not
be installed beside the consolidated menu-bar stack unless deliberately
debugging or rolling back.

```bash
BRAIN_ID="<brain-id>" \
BRAIN_REPO_ROOT="$HOME/Library/CloudStorage/<brain-checkout>" \
BRAIN_SYNC_STATE_FILE="$HOME/Library/Application Support/Brain MCP/<brain>-sync/state.json" \
BRAIN_SYNC_LAUNCHD_LOG_DIR="$HOME/Library/Application Support/Brain MCP/<brain>-sync" \
BRAIN_SYNC_HELPER_APP="$HOME/Applications/<Brain> Sync.app" \
BRAIN_SYNC_HELPER_BUNDLE_ID="com.example.<brain>-sync.helper" \
npm run sync:helper:install
```

After generation, add the app to Full Disk Access, then launch it. The helper
execs the compiled sync CLI directly with pinned `BRAIN_ID`, `BRAIN_DIR`, sync
state, and log paths. It writes `sync-helper.out.log` and `sync-helper.err.log`
under the configured log directory.

To start the helper automatically at login after Full Disk Access has been
granted, generate and install the companion LaunchAgent:

```bash
BRAIN_SYNC_HELPER_APP="$HOME/Applications/<Brain> Sync.app" \
BRAIN_SYNC_HELPER_LAUNCHD_LABEL="com.example.<brain>-sync.helper" \
BRAIN_SYNC_HELPER_LAUNCHD_PLIST="$HOME/Library/LaunchAgents/com.example.<brain>-sync.helper.plist" \
BRAIN_SYNC_LAUNCHD_LOG_DIR="$HOME/Library/Application Support/Brain MCP/<brain>-sync" \
npm run sync:helper:launchd:plist

launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.example.<brain>-sync.helper.plist"
launchctl kickstart -k "gui/$(id -u)/com.example.<brain>-sync.helper"
```

The LaunchAgent opens the helper app with LaunchServices and waits for it,
rather than running Node directly. To stop the helper app, terminate the
`<Brain> Sync` process from Activity Monitor or unload the helper LaunchAgent.

## Install The Menu-Bar Operator App

For John/operator use, generate a native macOS status-bar app that owns the
local JEM/ERS stack:

- shows the selected Brain id, sync health status, last check/sync, and open
  conflict count from the configured sync health JSON;
- starts and supervises each configured Brain's local sync watcher;
- starts and supervises each configured Brain's local cockpit server;
- opens each local cockpit;
- opens each sync log directory;
- restarts one Brain's local stack or all local stacks;
- runs `scripts/hosted-doctor.mjs` and writes bounded stdout/stderr under the
  configured log directory.

It is a local read-only operator wrapper. It does not expose Brain writes,
conflict resolution, hosted admin mutations, or public network binding.

```bash
BRAIN_ID="<brain-id>" \
BRAIN_REPO_ROOT="$HOME/Library/CloudStorage/<brain-checkout>" \
BRAIN_SYNC_STATE_FILE="$HOME/Library/Application Support/Brain MCP/<brain>-sync/state.json" \
BRAIN_SYNC_HEALTH_FILE="$HOME/Library/Application Support/Brain MCP/<brain>-sync/state.json.health.json" \
BRAIN_COCKPIT_URL="http://127.0.0.1:8788/" \
BRAIN_SYNC_LAUNCHD_LOG_DIR="$HOME/Library/Application Support/Brain MCP/<brain>-sync" \
BRAIN_MENUBAR_APP="$HOME/Applications/<Brain> Monitor.app" \
BRAIN_MENUBAR_BUNDLE_ID="com.example.<brain>-monitor" \
npm run sync:menubar:install
```

For one operator app that supervises both JEM and ERS, pass
`BRAIN_MENUBAR_PROFILES_JSON` as a JSON array. Each profile supports `id` or
`brainId`, `name` or `displayName`, `brainRoot` or `brainDir`, `stateFile`,
`healthFile`, `logDir`, and `cockpitUrl`:

```bash
BRAIN_MENUBAR_APP="$HOME/Applications/Brain Monitor.app" \
BRAIN_MENUBAR_BUNDLE_ID="com.jem.brain-monitor" \
BRAIN_MENUBAR_PROFILES_JSON='[
  {
    "id": "ai-brain-jem",
    "name": "JEM",
    "brainRoot": "/Users/johnemilad/Projects/ai-brain-jem",
    "stateFile": "/Users/johnemilad/Projects/ai-brain-jem/.brain-sync/state.json",
    "healthFile": "/Users/johnemilad/Projects/ai-brain-jem/.brain-sync/state.json.health.json",
    "logDir": "/Users/johnemilad/Projects/ai-brain-jem/.brain-sync",
    "cockpitUrl": "http://127.0.0.1:8787/"
  },
  {
    "id": "ers-brain",
    "name": "ERS",
    "brainRoot": "/Users/johnemilad/Library/CloudStorage/OneDrive-SharedLibraries-ERSGenomics/Systems & IT - Documents/01_ers-brain",
    "stateFile": "/Users/johnemilad/Library/Application Support/Brain MCP/ers-brain-onedrive-sync/state.json",
    "healthFile": "/Users/johnemilad/Library/Application Support/Brain MCP/ers-brain-onedrive-sync/state.json.health.json",
    "logDir": "/Users/johnemilad/Library/Application Support/Brain MCP/ers-brain-onedrive-sync",
    "cockpitUrl": "http://127.0.0.1:8788/"
  }
]' \
npm run sync:menubar:install
```

Launch the generated app once to put `Brain OK`, `Brain Action`, `Brain Warn`,
or `Brain Fail` in the macOS menu bar. The status text is colored by severity,
and each configured Brain gets a nested menu with Overview, Actions, Controls,
and Diagnostics sections. `Open Cockpit` also appears at the top level and opens
the default/first configured Brain cockpit; use the cockpit selector to switch
to another Brain. The app is config-driven and per-Brain.
For CloudStorage Brains, grant the monitor app Full Disk Access; the sync
watcher runs as the monitor's child process and uses that app identity. Broad
signed/notarized installer packaging remains separate backlog work.

To start the menu-bar app automatically at login:

```bash
BRAIN_MENUBAR_APP="$HOME/Applications/<Brain> Monitor.app" \
BRAIN_MENUBAR_LAUNCHD_LABEL="com.example.<brain>-monitor" \
BRAIN_MENUBAR_LAUNCHD_PLIST="$HOME/Library/LaunchAgents/com.example.<brain>-monitor.plist" \
BRAIN_MENUBAR_LAUNCHD_LOG_DIR="$HOME/Library/Application Support/Brain MCP/<brain>-sync" \
npm run sync:menubar:launchd:plist

launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.example.<brain>-monitor.plist"
launchctl kickstart -k "gui/$(id -u)/com.example.<brain>-monitor"
```

When this consolidated monitor is active, do not also run the legacy sync-helper
LaunchAgent, standalone sync LaunchAgent, or standalone cockpit LaunchAgent for
the same Brain.

The generated monitor config passes each profile's display name, Brain id,
cockpit URL, sync state path, health path, log directory, stack status file,
and a sanitized list of available profiles into the per-Brain doctor/cockpit
processes. The hosted doctor enriches that profile block with `profileLabel`,
`switcherLabel`, `profileCount`, and `isMultiProfile` so the cockpit and menu
bar can show `JEM (ai-brain-jem)` / `ERS (ers-brain)`-style labels instead of
relying on ambiguous browser tabs or display names alone.

The monitor also runs `scripts/hosted-doctor.mjs` automatically for each
configured profile. Override the polling interval with
`BRAIN_MENUBAR_DOCTOR_INTERVAL_MS`; values below 60000 are clamped to 60
seconds so the local menu does not create avoidable hosted-check churn. Manual
`Refresh Doctor` remains available for immediate operator checks.

## Operator Contract

Green means hosted Brain is ready for normal use.

Action means the latest hosted doctor output contains one or more non-pass
operator actions that need human judgement. Each doctor action is normalized
with `status`, `brain_id`, `reason`, `next_action`, and `urgency`, while keeping
the legacy `level`, `title`, and `detail` fields for older menu readers. The
cockpit first screen shows `Needs Action`; each Brain's menu shows `Action
required`, up to two bounded action titles/reasons/next steps, and an `Open
Cockpit for details` shortcut for the relevant profile.

Offline means the local Mac could not reach the hosted Brain health endpoint.
This is reported separately from a Brain MCP stack fault: check Wi-Fi, VPN,
DNS, or local network access first, then let Brain Monitor's next automatic
doctor refresh clear the status.

Warn means use judgement. Typical examples are stale sync health, stale or missing Brain lint, stale or oversized `TASKS.md` Capture / Triage Queue, pending inbox files, missing optional Fly status, no recent measured hosted MCP latency, or a latency SLO warning.

Fail means pause hosted writes until the issue is understood. Typical examples are hosted health failure, Postgres summary failure, or sync health error.

If `sync_health` is stale while `sync_lock` and the local supervisor still show
an active sync process, treat the watcher as wedged rather than healthy. The
sync daemon bounds Postgres connect/query/statement/idle waits and store
shutdown by default; if it still wedges, restart the local stack from the
menu-bar app, inspect `monitor-sync.err.log`, and rerun `npm run hosted:doctor`.

When `launchd` reports `supervisor: menubar`, read that check as the local
supervisor status for the Brain Monitor app. A warning means the monitor stack
file is missing/stale, belongs to a different `brain_id`, or does not show live
sync watcher and cockpit children for that profile. Restart the profile's local
stack from Brain Monitor, then rerun `npm run hosted:doctor`.

Open conflicts must be resolved through `docs/conflict-resolution.md`. Do not manually delete database rows to make the cockpit green.

## Latency Trend Semantics

The cockpit does not run hidden writes just to refresh charts. User-facing latency normally comes from real hosted MCP server tool calls. The hosted server records one latency sample per tool invocation after the handler finishes, including successful and failed read, write, and operational calls. The telemetry write is best-effort and non-blocking by default, so recording a sample should not add response latency. Set `BRAIN_HOSTED_MCP_LATENCY_AWAIT_DB_WRITE=1` only when deliberately diagnosing the telemetry write path itself.

Hosted tool calls write user-facing latency samples to Supabase Postgres `brain.sync_events` with event type `hosted_mcp_latency` and metadata source `hosted_mcp_server`. Server rows use `timingLayer = "server_tool"` and `durationType = "server_tool_handler"`. The telemetry row records tool name, operation kind, safe target metadata such as filename or category, latency, success/failure state, and a bounded DB summary when Postgres work occurred. DB spans record sanitized operation/table names, duration, row count, status, and bounded error text. They do not record SQL text, SQL parameters, file content, patch text, source content, or search query text. The cockpit reads server-emitted Postgres rows first when `BRAIN_REVISION_DATABASE_URL` is configured.

Hosted auth failures write metadata-only events to the same table with event type `hosted_mcp_auth`, metadata source `hosted_mcp_server`, `timingLayer = "auth"`, and operation kind `auth`. These rows are meant to expose stale/disconnected connector credentials, token expiry, invalid grants, and missing bearer headers. They record sanitized reason codes and HTTP status; OAuth token failures use the detailed server-side failure class when available, such as `unknown_client_id` or `client_authentication_failed`, while keeping the OAuth error family as the safe target. They also record the non-secret OAuth `clientId` and `grantType` when derivable (raw `clientId` so it joins to the `oauth_state` `clients` registry; both sanitized — `clientId` is attacker-controlled on the failure path). They do not record access tokens, refresh tokens, authorization headers, request bodies, client secrets, `User-Agent`/IP, or Brain content. Auth events appear in usage counts and the Operation Log, and they drive a dedicated `hosted_mcp_auth_failures` doctor check, but they remain excluded from latency trendlines and SLO calculations. The `hosted_mcp_auth_failures` check counts failures (`metadata->>'ok' = 'false'`) in a trailing window and returns `warn`/`fail`, so the Checks tab and overall status reflect auth health. It returns a bounded summary for the cockpit: current-window failures and successes, failure rate, prior-window delta, first/last failure, active-vs-stale state, reason/client/grant/target/name/HTTP breakdowns, fixed buckets for a trendline, and recent metadata-only failures. It also classifies a benign **stale connector** — a single *unregistered* `clientId` looping `unknown_client_id` on a `refresh_token` grant past `BRAIN_HOSTED_MCP_AUTH_STALE_GRACE_MINUTES` (default 10) — via `connectorState`, and downgrades that case from `fail` to `warn` through `effectiveStatus` (the Checks tab reads `effectiveStatus`). The downgrade is conservative: any ambiguity (multiple client ids, mixed reasons, unknown registered set, or a short burst) keeps full severity. Tune the bounded auth read with `BRAIN_HOSTED_MCP_AUTH_EVENT_LIMIT`, `BRAIN_HOSTED_MCP_AUTH_RECENT_LIMIT`, and `BRAIN_HOSTED_MCP_AUTH_BUCKETS`. It shares its window, thresholds, and stale-connector downgrade with the alerter described next.

The hosted server also raises real-time Slack alerts on auth failures. When a `hosted_mcp_auth` failure is recorded, the server evaluates — best-effort and non-blocking, never adding latency to the auth path — whether to post: `warn` (default ≥ 3 failures in the trailing 60m) goes to `#claude-ops`, and `fail` (default ≥ 10) goes to the operator DM with an `[Action needed]` prefix. A per-severity cooldown (default 30m) throttles a persistent condition while letting a worsening `warn → fail` escalate immediately. Alert dispatches are recorded as metadata-only `hosted_mcp_auth_alert` rows (`source = 'hosted_mcp_server'`, `kind = 'auth_alert'`) carrying only severity, count, window, reason codes, HTTP status, channel, and an `ok` flag — never tokens, headers, bodies, SQL text, or Brain content. Alerting is gated on `BRAIN_SLACK_BOT_TOKEN`; with no token it is a no-op (so local/dev and tests stay hermetic). Configure with `BRAIN_SLACK_BOT_TOKEN` (a Slack bot token with `chat:write`, set as a Fly secret), `BRAIN_SLACK_ALERT_CHANNEL` (default `C0B27NK40H4`), `BRAIN_SLACK_ALERT_DM` (default `U06SWS92Y5V`), `BRAIN_AUTH_ALERT_WINDOW_MINUTES` (60), `BRAIN_AUTH_ALERT_WARN_THRESHOLD` (3), `BRAIN_AUTH_ALERT_FAIL_THRESHOLD` (10), `BRAIN_AUTH_ALERT_COOLDOWN_MINUTES` (30), and `BRAIN_AUTH_ALERT_ENABLED=0` to disable. Set `BRAIN_AUTH_ALERT_AWAIT=1` only to await the post for diagnostics.

Sync-wait latency is measured by `npm run smoke:hosted:oauth` and `npm run hosted:test-drive`, because it measures local-hosted propagation rather than one server tool handler. Those flows write `sync_wait` rows by default. The same smoke/test-drive flows also write client-observed end-to-end samples by default with metadata source `hosted_mcp_client_e2e` and `timingLayer = "client_e2e"`. These rows include client/network/MCP response parsing overhead and are reported separately from countable server tool calls to avoid double-counting usage. Disable those diagnostic client rows with `BRAIN_HOSTED_MCP_CLIENT_LATENCY_DB_WRITE=0`.

If Postgres is unavailable, or if `BRAIN_HOSTED_MCP_LATENCY_CACHE=1` is set, the smoke flow writes a bounded fallback cache to:

```text
<brain-repo>/.brain-sync/hosted-mcp-latency.json
```

Treat Postgres as the source of record and the JSON file as a fallback/cache, not the primary metrics store.

The cockpit also reports aggregate operation usage from the same Postgres telemetry rows. The top-level cards show total recorded operations, operations in the last 24H, and operations in the last 7D. The Overview tab breaks those counts down by operation kind, including read, write, sync-wait, and other operational calls, with failed operations counted separately.

The cockpit now applies conservative latency SLOs over the bounded telemetry window. Defaults are intentionally operator-facing rather than contractual customer promises:

- server read p95 warns at `1000ms` and fails at `3000ms`;
- server write p95 warns at `2500ms` and fails at `6000ms`;
- client-observed read p95 warns at `2000ms` and fails at `5000ms`;
- client-observed write p95 warns at `3500ms` and fails at `8000ms`;
- sync-wait p95 warns at `10000ms` and fails at `30000ms`;
- max DB span warns at `500ms` and fails at `2500ms`;
- any failed DB span warns.

Override those thresholds with `BRAIN_SLO_SERVER_READ_P95_WARN_MS`, `BRAIN_SLO_SERVER_READ_P95_FAIL_MS`, `BRAIN_SLO_SERVER_WRITE_P95_WARN_MS`, `BRAIN_SLO_SERVER_WRITE_P95_FAIL_MS`, `BRAIN_SLO_CLIENT_READ_P95_WARN_MS`, `BRAIN_SLO_CLIENT_READ_P95_FAIL_MS`, `BRAIN_SLO_CLIENT_WRITE_P95_WARN_MS`, `BRAIN_SLO_CLIENT_WRITE_P95_FAIL_MS`, `BRAIN_SLO_SYNC_WAIT_P95_WARN_MS`, `BRAIN_SLO_SYNC_WAIT_P95_FAIL_MS`, `BRAIN_SLO_DB_MAX_SPAN_WARN_MS`, `BRAIN_SLO_DB_MAX_SPAN_FAIL_MS`, and `BRAIN_SLO_DB_FAILED_QUERY_WARN_COUNT`. The SLO layer does not write telemetry or add a background metrics job. It evaluates the same bounded rows already read by `hosted:doctor`.

The Activity tab separates content-state activity from operation telemetry with an in-tab sub-menu rather than stacked sections. Operation Log, Auth, Recent Brain Activity, and Cockpit Watch each get the full content width and are reachable from the top of the tab. Operation Log is the primary troubleshooting feed: a bounded metadata feed from `brain.sync_events`, not Brain content. By default it shows up to 60 events from the last 30 days; tune this with `BRAIN_HOSTED_MCP_EVENT_LOG_LIMIT` and `BRAIN_HOSTED_MCP_EVENT_LOG_DAYS`. Operation Log is a compact table with one row per operation or auth event: tool/auth name, latency where applicable, operation kind, timing layer, status, safe target metadata, telemetry source, DB summary, and timestamp. Rows with DB spans expose a bounded drill-down table with operation, target, duration, row count, and status. Auth is the focused troubleshooting view for `hosted_mcp_auth_failures`: it shows summary cards, a bucketed trend, reason/client/grant/target/name/HTTP breakdowns, and a bounded recent-failures table so the operator can tell active failures from stale telemetry aging out. When the summary classifies a stale connector it shows a banner naming the looping client id and noting the fail→warn downgrade, so a benign post-migration zombie connector is visibly distinguished from a real auth incident. Recent Brain Activity shows Brain state changes, such as file revisions and conflict open/resolution events. Cockpit Watch is local to the open browser session and reports refresh-observed status, sync, and conflict-count changes.

The Latency tab uses its own in-tab sub-menu so performance views do not stack vertically. SLOs & Findings is the first view: it shows each threshold, pass/warn/fail status, observed value, warning/failure cutoffs, sample count, performance findings, and DB span hotspots when available. Operation Trends shows the high-level latency cards:

- timing layers: server tool handler, client-observed end-to-end, and sync wait;
- operation kinds: read, write, sync wait, and other operational calls;
- exact tools, sorted by the slowest p95 values in the bounded history.

Slowest Operations is a separate view for the slowest individual operations in the current bounded sample set. Recent Samples is a separate view for recent server-side and client-observed samples. Infrastructure Checks is a separate view for doctor, sync, Postgres, hosted health, Fly, and other check runtimes.

For each bucket, the cockpit shows latest, average, p50, p95, range, sample count, failed count, DB contribution when present, and a short trendline. Failed samples are counted separately and shown in the recent sample list, but they are not included in the latency averages.

Refresh remains read-only. The additional usage and operation-log views use bounded server-side Postgres reads over the existing telemetry table. They do not add hidden writes, a metrics daemon, another datastore, or a separate analytics service.

## Next Hardening

- Expand source-ingestion nudges beyond pending inbox count.
- Rehearse recovery/reseed from local Markdown and a restored Supabase project using `docs/hosted-brain-recovery-and-git-export.md`.
