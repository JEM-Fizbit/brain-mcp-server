# ERS Brain Hosted Pilot

**Status:** John-only pilot active
**Last updated:** 2026-06-24

This runbook covers the first multi-Brain rollout: serving the ERS Brain through the hosted Brain MCP while John remains the only user.

This is **not** ERS team production access. The OneDrive-backed ERS Brain checkout remains the human-facing local-first source and fallback for Obsidian/manual edits. Supabase is the hosted MCP operational store for this pilot. ERS-owned Supabase, a dedicated ERS MCP deployment, onboarding/offboarding, and multi-user authorization remain later cutover work.

## Brain Identity

| Brain | Hosted `brain_id` | Owner boundary | Notes |
|---|---:|---|---|
| JEM Brain | `ai-brain-jem` | Personal | Existing hosted default Brain. |
| ERS Brain | `ers-brain` | ERS content asset | John-only hosted pilot. |

The hosted registry is versioned at:

```text
config/brain-platform.john-ers-pilot.json
```

Fly reads that image-bundled registry directly:

```text
BRAIN_PLATFORM_CONFIG=/app/config/brain-platform.john-ers-pilot.json
```

Do not rely on an old `/data/config/registry.json` volume file for this phase; it can contain stale single-Brain state.

## Current Migration State

ERS Brain source checkout:

```text
/Users/johnemilad/Library/CloudStorage/OneDrive-SharedLibraries-ERSGenomics/Systems & IT - Documents/01_ers-brain
```

Repository baseline used for the first hosted seed:

```text
56bf84e Ignore hosted sync state
```

Hosted Supabase pilot state created on 2026-06-24:

- `brain.brains` row for `ers-brain`;
- 40 ERS Markdown Brain files seeded into the revision store;
- fresh mirror pull verified all 40 files byte-for-byte;
- 0 sync conflicts after seed;
- 128 ERS source artifacts inventoried;
- 128 source artifacts uploaded to private Storage bucket `brain-artifacts`;
- 57 text/PDF artifacts extracted for hosted source search;
- 71 unsupported binary artifacts marked without failure;
- 0 missing source files and 0 extraction failures.

The raw local source file count may be one higher than the hosted inventory because inventory intentionally ignores operational cruft such as `.DS_Store` and `.gitkeep`.

## Local Sync

Use a separate ERS sync identity; do not reuse the JEM label or state file.

For John's workstation, the shared menu-bar monitor is the preferred local stack
owner. It is the only JEM/ERS Brain login item; it starts and supervises each
Brain's sync watcher plus cockpit server as child processes. Grant
`~/Applications/Brain Monitor.app` Full Disk Access in macOS Privacy & Security
so the ERS child sync watcher can read the OneDrive/SharePoint checkout.

Generate the shared monitor:

```bash
mkdir -p "$HOME/Library/Application Support/Brain MCP/ers-brain-onedrive-sync"

BRAIN_MENUBAR_APP="$HOME/Applications/Brain Monitor.app" \
BRAIN_MENUBAR_BUNDLE_ID="com.jem.ers-brain-monitor" \
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

John's current shared monitor intentionally reuses the previously authorized
`com.jem.ers-brain-monitor` bundle identity so macOS Full Disk Access continues
to cover the OneDrive-backed ERS sync child after consolidating JEM into the
same app. Future fresh installs can use a new bundle id, but then the new app
identity must be granted Full Disk Access before enabling the ERS profile.

The generated monitor app must pin, per profile:

```text
BRAIN_ID=<brain id>
BRAIN_DIR=<Brain checkout>/brain
BRAIN_SYNC_STATE_FILE=<profile sync state>/state.json
BRAIN_SYNC_SUPERVISOR=menubar
```

This prevents either sync watcher from falling back to the wrong Brain defaults.

Install the companion login LaunchAgent:

```bash
BRAIN_MENUBAR_APP="$HOME/Applications/Brain Monitor.app" \
BRAIN_MENUBAR_LAUNCHD_LABEL="com.jem.brain-monitor" \
BRAIN_MENUBAR_LAUNCHD_PLIST="$HOME/Library/LaunchAgents/com.jem.brain-monitor.plist" \
BRAIN_MENUBAR_LAUNCHD_LOG_DIR="$HOME/Library/Application Support/Brain MCP/brain-monitor" \
npm run sync:menubar:launchd:plist

launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.jem.brain-monitor.plist"
launchctl kickstart -k "gui/$(id -u)/com.jem.brain-monitor"
```

Use the older sync helper app or a daemon-local checkout only as a temporary
fallback if the OneDrive monitor app cannot be authorized.

## Cockpit / Doctor

The ERS cockpit remains local-only and read-only at
`http://127.0.0.1:8788/`, but in the consolidated setup it is started by
`Brain Monitor.app`, not by a standalone cockpit LaunchAgent.

## Menu-Bar Operator App

The app is a John/operator pilot surface, not ERS colleague rollout packaging.
It shows sync health in the macOS menu bar and provides menu actions to refresh
doctor output, open the local cockpit, open logs, and restart the local sync +
cockpit stack.

## Verification Commands

Metadata row:

```bash
node -e "<load .env.local, apply db/seeds/2026-06-24_001_bootstrap_ers_brain_pilot.sql, query brain.brains>"
```

Markdown seed:

```bash
BRAIN_ID="ers-brain" \
BRAIN_DIR="/Users/johnemilad/Library/CloudStorage/OneDrive-SharedLibraries-ERSGenomics/Systems & IT - Documents/01_ers-brain/brain" \
npm run sync:seed:all-markdown:postgres
```

Source inventory/upload/extract:

```bash
BRAIN_ID="ers-brain" \
BRAIN_REPO_ROOT="/Users/johnemilad/Library/CloudStorage/OneDrive-SharedLibraries-ERSGenomics/Systems & IT - Documents/01_ers-brain" \
npm run sources:inventory:postgres

BRAIN_ID="ers-brain" \
BRAIN_REPO_ROOT="/Users/johnemilad/Library/CloudStorage/OneDrive-SharedLibraries-ERSGenomics/Systems & IT - Documents/01_ers-brain" \
BRAIN_ARTIFACT_BYTE_ACCESS="admin" \
npm run sources:upload:postgres

BRAIN_ID="ers-brain" \
BRAIN_REPO_ROOT="/Users/johnemilad/Library/CloudStorage/OneDrive-SharedLibraries-ERSGenomics/Systems & IT - Documents/01_ers-brain" \
npm run sources:extract-text:postgres
```

Source-list verification:

```bash
BRAIN_ID="ers-brain" \
BRAIN_EXPECTED_SOURCE_COUNT="128" \
BRAIN_EXPECTED_CATEGORY_COUNTS="" \
npm run sources:verify-list:postgres
```

Hosted client smoke after deployment:

```text
brain_list_brains()
brain_describe({ "brain_id": "ers-brain" })
brain_sync_status({ "brain_id": "ers-brain" })
brain_load_context({ "brain_id": "ers-brain" })
brain_list_sources({ "brain_id": "ers-brain" })
brain_lint({ "brain_id": "ers-brain" })
```

When more than one Brain is accessible, hosted clients should pass `brain_id` explicitly for all task-specific reads and writes.

## Claude Automation Follow-Up

Claude-side ERS Brain automations currently include `~/.claude/scheduled-tasks/ers-brain-auto-pull/`, which assumes a GitHub-pull-to-SharePoint review flow. That remains useful until the hosted sync path is fully operational, but it should be reviewed before ERS hosted traffic becomes normal:

- keep or replace the GitHub-pull review loop;
- add hosted `brain_lint({ brain_id: "ers-brain" })` checks;
- ensure alerts distinguish ERS sync/hosted issues from JEM sync/hosted issues;
- avoid duplicated or conflicting writes between SharePoint, GitHub, local sync, and hosted MCP.
