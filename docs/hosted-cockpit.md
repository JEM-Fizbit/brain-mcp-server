# Hosted Brain Cockpit

**Status:** active operator guide
**Last updated:** 2026-08-25

Brain Cockpit is the local, read-mostly operator surface for the
hosted JEM and ERS Brain pilot. It is meant to answer one question quickly: can
hosted Brain be trusted right now, or does John need to intervene before using
it? Its narrow shipped Maintenance actions are documented below; it is not a
general Brain editor. The tenant-neutral Spec 018 build adds one ERS-only
hosted permissions surface; activation remains gated on the ERS migration,
Entra setup and canary.

Spec 018 promotes Cockpit as the shared control-plane shell for the ERS
production rollout. The implemented navigation is profile-scoped: JEM keeps GitHub
authentication and its single-owner posture, while only ERS gains the hosted,
Entra-authenticated **Access & Roles** section. This is a shared user experience,
not a shared trust boundary or a plan to publish the current loopback server.

## Current Recommendation

Use the consolidated local menu-bar operator app as the normal John/operator
surface. It supervises the JEM and ERS local sync watchers plus their cockpit
servers, and it exposes each local cockpit as a loopback browser surface:

- cockpit stays bound to `127.0.0.1`;
- the stable JEM local URL is `http://127.0.0.1:8787/`;
- the stable ERS local URL is `http://127.0.0.1:8788/`;
- checks continue to come from `npm run hosted:doctor`;
- checks use `pass`/`info`/`warn`/`fail`: informational diagnostic limitations stay visible in Checks but do not enter Operator Queue or change readiness, while every warning or failure carries a concrete next action;
- local sync health, launchd state, local mirror state, lint freshness, inbox state, and local latency snapshots remain visible;
- the `pooler_config` check classifies `BRAIN_REVISION_DATABASE_URL` (transaction `:6543` vs session `:5432` vs direct) and warns on session mode — whose hard ~15-client cap, shared across the hosted runtime pool + telemetry + local sync daemon + operator scripts, exhausts under load (`EMAXCONNSESSION`); it also reports the active backend connection count and the per-pool `max` (`BRAIN_PG_POOL_MAX`) for visibility;
- user-facing hosted MCP latency shows SLO status, performance findings, DB hotspots, latest, average, p50, p95, failures, and short trendlines for read, write, and sync-wait operations;
- hosted MCP auth failures show current-window counts, prior-window trend, safe reason/target metadata, and recent metadata-only events in a dedicated Activity > Auth subpanel;
- the cockpit header shows the active profile label as `<display name> (<brain_id>)` in the first-screen identity block, plus the local profile name, sync state path, cockpit URL, and metric scope; when the consolidated Brain Monitor app is installed with multiple profiles, the cockpit also exposes a profile selector using the same unambiguous labels and links to each configured local cockpit URL;
- the cockpit first screen includes a dedicated `Needs Action` panel above the tabbed sections; the Overview tab keeps the fuller `Next Actions` list for the same doctor actions;
- the cockpit first screen gives the primary health summary and `Needs Action` panel the top priority row, collapses long local path diagnostics under `Local Diagnostics`, then groups secondary cards such as hosted/local file counts, operation volume, and latency into a separate `Operational Signals` section below that row;
- the Overview tab is organized as an operator work queue first, with usage as a secondary snapshot rather than an equal-weight panel;
- the full dashboard context lives inside the Overview tab; Activity, Latency, Checks, and Maintenance start directly with their focused content and only show a compact context strip for Brain, status, action queue, sync, and doctor recency;
- raw doctor JSON is deliberately not a cockpit tab: the operator views are the supported interface, while developers can still inspect `/api/doctor` or the per-profile `hosted-doctor.out.json` file when exact payload debugging is required;
- primary cockpit tabs use a contained navigation strip, while nested Activity and Latency panel choices use compact secondary controls inside the selected tab panel;
- Activity > Operation Log uses deliberate column classes and renders global timestamps as two-line cells, with date above time plus timezone, so the `When` column remains readable without making the whole table sparse;
- the doctor treats `BRAIN_SYNC_SUPERVISOR=menubar` as the normal consolidated path and checks the per-profile Brain Monitor stack file for the expected Brain id plus live sync watcher and cockpit child processes, rather than warning only on the retired raw `com.jem.brain-sync` LaunchAgent;
- the menu-bar app is the sole automatic doctor owner in the consolidated stack: it refreshes each profile every 60 seconds, while Cockpit reloads that last-good report rather than launching a duplicate doctor; historical operation telemetry is cached for 15 minutes, but health, sync, auth, and other lightweight checks remain on the one-minute cadence;
- the top-level menu includes `Open Cockpit` for the default/first configured Brain so the operator can reach the browser cockpit immediately, then switch profiles from the cockpit selector if needed;
- `Open Cockpit` is the supported entrypoint: Brain Monitor starts and supervises the local cockpit server itself, checks whether the cockpit script changed before opening the page, and restarts stale cockpit child processes automatically during the normal stack heartbeat;
- the top-level `Last monitor action` is app-wide across the consolidated Brain Monitor process, not per-Brain and not doctor-only; it includes the timestamp and latest monitor-recorded action from either configured Brain on separate indented rows so the dropdown stays narrow;
- operator-facing timestamps use `YYYY-MMM-DD; HH:MM:SS UTC+/-HH:MM`, rendered in the local machine timezone with an explicit UTC offset for global readability;
- the menu-bar status uses color plus text: green for `Brain OK`, orange/yellow for action, warning, offline, or initial checking states, and red for `Brain Fail`; routine automatic doctor polling does not switch a known-good status to yellow just because a poll is in flight;
- the menu-bar status distinguishes local connectivity loss (`Brain Offline`, local device cannot reach hosted Brain) from a hosted Brain stack fault (`Brain Fail`, hosted health responded unhealthy or another real check failed);
- the cockpit browser surface exposes no general Brain editing, conflict resolution, source ingestion, or admin mutations; its narrow Maintenance exceptions are an explicit lint run that records one `LINT` receipt and the confirm-gated application of selected mechanical task fixes. The menu-bar app retains **Controls → "Apply Lint Fixes..."** as the secondary all-or-nothing path;
- the local ERS navigation includes **Access & Roles**, which opens the hosted,
  same-origin Entra Owner surface configured by
  `BRAIN_COCKPIT_ACCESS_ADMIN_URL` (or the active ERS hosted base); the JEM
  profile renders no access-administration link, and the local process never
  receives a Graph token or permission mutation.

Do not expose the current local Cockpit process as a hosted website. Its local
signals and narrow maintenance endpoints remain loopback-only. Spec 018 adds a
bounded hosted ERS Access & Roles backend and reuses the Cockpit shell and
navigation for it: the local ERS profile transitions to that Entra-authenticated
route, while Cillian and IT/TDM can open the hosted ERS section directly. The
JEM profile does not register or display ERS role-administration capability.
This supersedes the earlier blanket deferral of any hosted admin surface only
for the narrow Spec 018 permissions scope; it does not authorize a general
hosted maintenance, content-editing or Brain administration site.

Hosted operation, failure handling and onboarding/offboarding are documented in
[`ers-entra-access-runbook.md`](ers-entra-access-runbook.md).

## Separate content-reading surface

Brain Cockpit remains an operator surface. Rendered Brain content, source
companions, provenance, and local artifact inspection belong in the separate
local-only **Brain Library** pilot documented in
[`brain-library.md`](brain-library.md). The Library consumes the same Markdown
and source-reference contract but does not share Cockpit navigation or expand
Cockpit's mutation boundary. This separation is deliberate and is the first
JEM-only slice of the broader human Brain viewer direction; ERS and hosted
multi-user use remain separately gated.

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

It is a local, read-mostly operator wrapper. It does not expose general Brain
editing, conflict resolution, source ingestion, hosted admin mutations, or
public network binding. Its only Brain-content mutations are the governed lint
receipt and mechanical-fix actions described below.

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

The installer defaults to the repo-supported Node 22 runtime. On Homebrew
systems it prefers the stable `opt/node@22/bin/node` path so a routine formula
upgrade cannot strand the monitor on a removed versioned `Cellar` executable.
Set `BRAIN_MENUBAR_NODE` only when an explicit stable Node 22 path is required;
do not configure a versioned `Cellar` path. If no stable Node 22 executable is
available, installation fails instead of silently pinning an unsupported host
Node. Managed child launch failures retry automatically, and doctor refreshes
write to temporary files before atomically promoting valid JSON, preserving the
last usable report when a launch fails.

For one operator app that supervises both JEM and ERS, pass
`BRAIN_MENUBAR_PROFILES_JSON` as a JSON array, or point
`BRAIN_MENUBAR_PROFILES_FILE` at an owner-readable JSON file so credentials do
not appear in a shell command. Each profile supports `id` or
`brainId`, `name` or `displayName`, `brainRoot` or `brainDir`, `stateFile`,
`healthFile`, `logDir`, `cockpitUrl`, and an optional `env` object. The profile
environment allow-list is `BRAIN_REVISION_STORE`,
`BRAIN_REVISION_DATABASE_URL`, `BRAIN_HOSTED_BASE_URL`, `BRAIN_FLY_APP`,
`BRAIN_EXPECTED_SUPABASE_PROJECT_REF`,
`BRAIN_SYNC_HEARTBEAT_INTERVAL_MS`, `BRAIN_DOCTOR_OPERATION_REFRESH_MS`,
`BRAIN_DOCTOR_DB_TIMEOUT_MS`, and `BRAIN_LINT_MODE_OVERRIDES`; `FLY_CONFIG_DIR`
may also be supplied when different profiles use isolated Fly CLI identities.
These values are passed only to that profile's sync, cockpit, and doctor
processes. This lets two profiles target different hosted stacks, lint
promotion modes, and Fly organizations from one app without switching the
global Fly login.
Every sync-enabled profile in a multi-profile Monitor must declare its revision
store explicitly. A Postgres profile must also declare its database URL and
expected Supabase project ref. Installation fails if the URL does not match the
declared ref, and managed sync children ignore ambient repo `.env.local` files.
The sync CLI repeats the project-ref check before opening a connection. This is
a fail-closed cross-deployment guard, not a naming convention.

Manual `hosted:doctor` and `smoke:hosted:oauth` commands use the same boundary.
Select a profile from this owner-only generated config rather than relying on
the repo's ambient `.env.local`:

```bash
BRAIN_ID=ai-brain-jem \
BRAIN_MONITOR_CONFIG_FILE="$HOME/Applications/Brain Monitor.app/Contents/Resources/brain-menubar-config.json" \
npm run hosted:doctor
```

The command loads only the selected profile's allowlisted runtime values and
then verifies its database URL against `BRAIN_EXPECTED_SUPABASE_PROJECT_REF`
before any network access. A missing profile, inconsistent Brain id, non-HTTPS
hosted endpoint, absent expected ref, or cross-project URL is a hard refusal.
The generated config is owner-readable only (`0600`) because a database URL is
a credential; never commit or print the profiles JSON:

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
    "cockpitUrl": "http://127.0.0.1:8787/",
    "env": {
      "BRAIN_REVISION_STORE": "postgres",
      "BRAIN_REVISION_DATABASE_URL": "<JEM_RUNTIME_DATABASE_URL>",
      "BRAIN_EXPECTED_SUPABASE_PROJECT_REF": "gfipcidoyrtgngauzijy",
      "BRAIN_LINT_MODE_OVERRIDES": "{\"ai-brain-jem\":\"graph\"}"
    }
  },
  {
    "id": "ers-brain",
    "name": "ERS",
    "brainRoot": "/Users/johnemilad/Library/CloudStorage/OneDrive-SharedLibraries-ERSGenomics/Systems & IT - Documents/01_ers-brain",
    "stateFile": "/Users/johnemilad/Library/Application Support/Brain MCP/ers-brain-onedrive-sync/state.json",
    "healthFile": "/Users/johnemilad/Library/Application Support/Brain MCP/ers-brain-onedrive-sync/state.json.health.json",
    "logDir": "/Users/johnemilad/Library/Application Support/Brain MCP/ers-brain-onedrive-sync",
    "cockpitUrl": "http://127.0.0.1:8788/",
    "env": {
      "BRAIN_REVISION_STORE": "postgres",
      "BRAIN_REVISION_DATABASE_URL": "<ERS_RUNTIME_DATABASE_URL>",
      "BRAIN_EXPECTED_SUPABASE_PROJECT_REF": "omnwbcdtmtvxasgdmvwr",
      "BRAIN_LINT_MODE_OVERRIDES": "{\"ers-brain\":\"graph\"}"
    }
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
seconds so the local menu does not create avoidable hosted-check churn. Each
run uses one Postgres pool capped at two connections and applies a five-second
connection, query, and statement timeout (`BRAIN_DOCTOR_DB_TIMEOUT_MS`). The
Monitor terminates a doctor after 45 seconds by default
(`BRAIN_MENUBAR_DOCTOR_TIMEOUT_MS`) and retains the previous valid report.
Historical operation telemetry is reused for 15 minutes by default
(`BRAIN_DOCTOR_OPERATION_REFRESH_MS`); manual `Refresh Doctor` bypasses that
cache for an immediate deep check.

For Postgres-backed profiles, the five-second sync loop coalesces successful
liveness into one metadata-only `brain.sync_heartbeats` row per Brain, upserted
at most once per minute (`BRAIN_SYNC_HEARTBEAT_INTERVAL_MS`). The row contains
counts, duration, and guard status only—never filenames, content, database
URLs, or credentials. Append-only `brain.sync_events` remains the historical
store for real operations and transitions, not routine liveness. The doctor
warns when `last_seen_at` is older than five minutes; override the threshold
with `BRAIN_SYNC_HEARTBEAT_MAX_AGE_MS` for a deliberately slower watcher
cadence. Code deployed before the migration falls back to a coalesced legacy
`sync_heartbeat` event, so migration/runtime ordering does not interrupt sync.
That fallback is deliberately visible as an actionable Brain Monitor warning:
apply `db/migrations/2026-08-19_001_bounded_sync_observability.sql` to the
affected profile database, rerun the Supabase security gate, and refresh the
Monitor. A current fallback event proves liveness but does not count as a
healthy long-term observability configuration.

## Operator Contract

Green means hosted Brain is ready for normal use.

Action means the latest hosted doctor output contains one or more non-pass
operator actions that need human judgement. Only `warn` and `fail` checks enter
this queue; `info` checks are visibility-only. Each doctor action is normalized
with `status`, `brain_id`, `reason`, `next_action`, and `urgency`, while keeping
the legacy `level`, `title`, and `detail` fields for older menu readers. The
cockpit first screen shows `Needs Action`; each Brain's menu shows `Action
required`, up to two bounded action titles/reasons/next steps, and an `Open
Cockpit for details` shortcut for the relevant profile.

Offline means the local Mac could not reach the hosted Brain health endpoint.
This is reported separately from a Brain MCP stack fault: check Wi-Fi, VPN,
DNS, or local network access first, then let Brain Monitor's next automatic
doctor refresh clear the status.

Info means an optional diagnostic is unavailable or has context worth showing,
but no operator intervention is required for readiness. Missing or expired local
Fly CLI authentication is informational because hosted health and sync are
checked independently. The Checks row explains the skipped capability and
offers `fly auth login` as an optional way to restore Machine and release
diagnostics. A missing `flyctl`, unconfigured `BRAIN_FLY_APP`, unavailable
recent-activity telemetry, and unavailable latency telemetry follow the same
visibility-without-alarm rule.

Warn means use judgement and always includes a concrete next action. Typical
examples are stale sync health, stale or missing Brain lint, available safe
mechanical lint fixes, stale or oversized `TASKS.md` Capture / Triage Queue,
pending inbox files, an authenticated Fly result with no passing
Machine, or a latency SLO warning. Warnings are condition-derived rather than
dismissible: perform the stated action and reload, and the next doctor result
clears the queue item when the condition has recovered.

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

## Cockpit Maintenance: lint, inbox, and mechanical fixes

The **Maintenance** tab keeps detection and governed repair in the operator
surface instead of forcing a switch to an MCP client or CLI:

- **Refresh lint assessment** invokes the canonical `runLint` implementation for
  the active Brain. A successful explicit run writes one narrow `LINT` receipt
  through the configured Brain store and atomically refreshes the per-profile
  `hosted-lint-report.json` cache. The action is detection-only and does not
  change Brain content. The doctor reads that cache first so `lint_nudge`
  represents freshness while the separate `lint_findings` check represents the
  current result. Safe mechanical fixes and explicitly labelled operator
  content decisions make `lint_findings` an actionable warning; maintainer-only
  findings and genuine broken internal links remain `info` without changing
  readiness. Graph telemetry does not inflate the maintenance finding count.
  Real unresolved Markdown links and wikilinks are grouped as maintainer-owned
  repair items; source-boundary links and backtick project/file/directory
  locators are classified automatically. Cockpit runs the strict local
  source-link audit with each lint refresh and marks source-boundary references
  complete when it passes. All technical groups retain a plain-language
  meaning, status, owner, completion criterion, and expandable representative
  paths inside a collapsed **Maintainer-only diagnostics and context** panel.
  The operator never needs to review those paths individually. An empty
  mechanical plan never claims the whole Brain is clean. After an explicit lint
  refresh or mechanical apply, Cockpit requests one fresh doctor run so the
  action state updates immediately; routine reloads still use the Monitor-owned
  last-good report and do not duplicate polling.
  A Capture / Triage finding states the total number of open items, identifies
  the stale count as the subset at least seven days old, and shows the newer
  remainder. Its recommended **LLM-assisted triage** handoff is model-neutral
  and copyable from the **Copy** control fixed inside the prompt window's upper
  right corner: the LLM must inspect all items, propose canonical destinations
  in one table, and stop for John's approval before any write. The adjacent
  **Manual triage in Obsidian** alternative explains how to move personal work
  into `TASKS.md` Active, transfer project/ERS/audit work to its real owner,
  mark the Capture item checked only after that destination is updated, and
  rerun lint. Changing a date or leaving an item unchecked does not clear the
  queue; inaccessible destinations remain open with an explicit handoff.
- **Refresh inbox scan** lists pending source filenames, sizes, and modification times.
  The button is labelled **Refresh inbox scan** because it does not ingest,
  classify, summarize, move, or delete content. Each pending item says that it
  is not stuck and exposes a filename-specific **Claude ingestion handoff**.
  Copy that prompt into an interactive Claude session with access to the
  selected Brain and its operator workspace. The handoff first calls the
  read-only `brain_prepare_ingest`. A filesystem-backed Brain may then use
  `brain_ingest_complete` with the exact `inbox_file` and verify through
  `brain_scan_inbox`. A Postgres-backed Brain must instead preserve source and
  provenance, clear the exact operator-side inbox file only after its source
  receipt exists, and verify by refreshing the local Monitor inbox scan; Fly
  cannot see that state. Hosted `brain_log` remains available for the reviewed
  Brain-revision receipt. If the session cannot access the operator workspace,
  it stops with an explicit handoff rather than deleting the file manually.
- **Actions You Can Approve** lists each task relocation, Done-date stamp, and
  non-destructive archive candidate with an unchecked per-item checkbox. A
  standard header checkbox selects or clears all current items; the separate
  **Apply selected** button remains disabled until at least one item is
  selected. The compact row may truncate a long item for scanning, but every row
  has **Show full proposed change** and renders the complete untruncated change
  before approval. Maintenance uses the available content width and retains the
  same stacked behavior at 390px. Apply re-reads the current Brain, applies only
  still-valid selected ids, then reruns lint to refresh the report without
  writing a duplicate receipt.

These are deliberate, narrow relaxations of the read-only default. They never
resolve conflicts or perform source/admin mutations. See `docs/DECISIONS.md`
(2026-08-19 and 2026-07-01), `docs/specs/009-brain-lint-apply-mode.md`, and
`docs/specs/010-cockpit-fixes-tab.md`.

The remaining fixes are mechanical and non-fabricating: relocate completed
`[x]` tasks into Done (stamped `(done YYYY-MM-DD)`) and archive Done items older
than 30 days into `archive/tasks-done.md` (moved, never deleted). Dates are
handled stamp-forward — undated Done items are tagged the first time the tool
sees them; no history is reconstructed. Spec 013 removed orphan-to-loader and
loader-reviewed-date fixes. No lint plan or apply path may modify `00_loader.md`
or `NOW.md`.

Operator usage from the repo (dry run is the default; nothing is written without
`--apply`):

```bash
npm run brain:lint:fix                 # preview the planned fixes
npm run brain:lint:fix -- --apply      # apply them to the local-first Brain
```

Mechanical application always starts from a live plan and requires explicit
per-item selection or confirmation before apply. There are three surfaces:

- **Cockpit Maintenance tab (primary).** The **Safe Mechanical Fixes** section lists each atomic
  fix — each relocated, archived, or stamped task — with its own
  unchecked checkbox plus a select-all header checkbox, and applies only the
  checked items when you press **Apply selected**. It
  is backed by `GET /api/fixes/plan` (read-only, live per-item plan) and
  `POST /api/fixes/apply`. Apply re-reads current Brain
  state and only applies still-valid approved ids, then refreshes the doctor.
- **Menu-bar app (secondary).** Brain Monitor → **Controls → "Apply Lint Fixes..."**
  shells out to `scripts/brain-lint-fix.mjs`, shows the plan in a confirmation
  dialog, and applies all-or-nothing on confirm.
- **CLI.** `npm run brain:lint:fix` (dry run) / `-- --apply`.

Both narrow write endpoints, `POST /api/lint/run` and
`POST /api/fixes/apply`, are loopback-only and guarded by a Host-header allowlist
(defeats DNS rebinding), a per-process nonce embedded in the page and required
via `X-Cockpit-Nonce` (a cross-origin page cannot read it — no CORS is ever
sent), and a JSON-only content-type. `GET /api/lint/report`,
`GET /api/inbox/scan`, and `GET /api/fixes/plan` are loopback-only reads. See
`docs/DECISIONS.md` (2026-08-19 and 2026-07-01) and
`docs/specs/010-cockpit-fixes-tab.md`.

## Latency Trend Semantics

The cockpit does not run hidden writes or a second doctor just to refresh charts. Under Brain Monitor it reloads the Monitor-owned last-good JSON report once per minute. User-facing latency normally comes from real hosted MCP server tool calls. The hosted server records one latency sample per tool invocation after the handler finishes, including successful and failed read, write, and operational calls. The telemetry write is best-effort and non-blocking by default, so recording a sample should not add response latency. Set `BRAIN_HOSTED_MCP_LATENCY_AWAIT_DB_WRITE=1` only when deliberately diagnosing the telemetry write path itself.

Hosted tool calls write user-facing latency samples to Supabase Postgres `brain.sync_events` with event type `hosted_mcp_latency` and metadata source `hosted_mcp_server`. Server rows use `timingLayer = "server_tool"` and `durationType = "server_tool_handler"`. The telemetry row records tool name, operation kind, safe target metadata such as filename or category, latency, success/failure state, and a bounded DB summary when Postgres work occurred. DB spans record sanitized operation/table names, duration, row count, status, and bounded error text. They do not record SQL text, SQL parameters, file content, patch text, source content, or search query text. The cockpit reads server-emitted Postgres rows first when `BRAIN_REVISION_DATABASE_URL` is configured.

Hosted auth failures write metadata-only events to the same table with event type `hosted_mcp_auth`, metadata source `hosted_mcp_server`, `timingLayer = "auth"`, and operation kind `auth`. These rows are meant to expose stale/disconnected connector credentials, token expiry, invalid grants, and missing bearer headers. They record sanitized reason codes and HTTP status; OAuth token failures use the detailed server-side failure class when available, such as `unknown_client_id` or `client_authentication_failed`, while keeping the OAuth error family as the safe target. They also record the non-secret OAuth `clientId` and `grantType` when derivable (raw `clientId` so it joins to the `oauth_state` `clients` registry; both sanitized — `clientId` is attacker-controlled on the failure path). They do not record access tokens, refresh tokens, authorization headers, request bodies, client secrets, `User-Agent`/IP, or Brain content. Auth events appear in usage counts and the Operation Log, and they drive a dedicated `hosted_mcp_auth_failures` doctor check, but they remain excluded from latency trendlines and SLO calculations. The `hosted_mcp_auth_failures` check counts failures (`metadata->>'ok' = 'false'`) in a trailing window and returns `warn`/`fail`, so the Checks tab and overall status reflect auth health. It returns a bounded summary for the cockpit: current-window failures and successes, failure rate, prior-window delta, first/last failure, active-vs-stale state, reason/client/grant/target/name/HTTP breakdowns, fixed buckets for a trendline, and recent metadata-only failures. It also classifies a benign **stale connector** — a single *unregistered* `clientId` looping `unknown_client_id` on a `refresh_token` grant past `BRAIN_HOSTED_MCP_AUTH_STALE_GRACE_MINUTES` (default 10) — via `connectorState`, and downgrades that case from `fail` to `warn` through `effectiveStatus` (the Checks tab reads `effectiveStatus`). The downgrade is conservative: any ambiguity (multiple client ids, mixed reasons, unknown registered set, or a short burst) keeps full severity. Tune the bounded auth read with `BRAIN_HOSTED_MCP_AUTH_EVENT_LIMIT`, `BRAIN_HOSTED_MCP_AUTH_RECENT_LIMIT`, and `BRAIN_HOSTED_MCP_AUTH_BUCKETS`. It shares its window, thresholds, and stale-connector downgrade with the alerter described next.

The hosted server also raises real-time Slack alerts on auth failures. When a `hosted_mcp_auth` failure is recorded, the server evaluates — best-effort and non-blocking, never adding latency to the auth path — whether to post: `warn` (default ≥ 3 failures in the trailing 60m) goes to the configured channel, and `fail` (default ≥ 10) goes to the configured operator DM with an `[Action needed]` prefix. A per-severity cooldown (default 30m) throttles a persistent condition while letting a worsening `warn → fail` escalate immediately. Alert dispatches are recorded as metadata-only `hosted_mcp_auth_alert` rows (`source = 'hosted_mcp_server'`, `kind = 'auth_alert'`) carrying only severity, count, window, reason codes, HTTP status, channel, and an `ok` flag — never tokens, headers, bodies, SQL text, or Brain content. Alerting requires `BRAIN_SLACK_BOT_TOKEN`, `BRAIN_SLACK_ALERT_CHANNEL`, and `BRAIN_SLACK_ALERT_DM`; if any is absent it is a no-op (so local/dev and tests stay hermetic and a deployment cannot silently alert the wrong destination). Configure the token as a Fly secret and both destinations explicitly, plus `BRAIN_AUTH_ALERT_WINDOW_MINUTES` (60), `BRAIN_AUTH_ALERT_WARN_THRESHOLD` (3), `BRAIN_AUTH_ALERT_FAIL_THRESHOLD` (10), `BRAIN_AUTH_ALERT_COOLDOWN_MINUTES` (30), and `BRAIN_AUTH_ALERT_ENABLED=0` to disable. Set `BRAIN_AUTH_ALERT_AWAIT=1` only to await the post for diagnostics.

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

Routine refresh remains read-only. Lint runs and fix application happen only on explicit button presses. The additional usage and operation-log views use bounded server-side Postgres reads over the existing telemetry table. They do not add hidden writes, a metrics daemon, another datastore, or a separate analytics service.

## Next Hardening

- Add an explicitly reviewed inbox-ingestion workflow only when its classification and source-record contract is specified; the current Maintenance scan remains visibility-only.
- Rehearse recovery/reseed from local Markdown and a restored Supabase project using `docs/hosted-brain-recovery-and-git-export.md`.
