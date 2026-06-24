# ERS Brain Hosted Pilot

**Status:** John-only pilot active
**Last updated:** 2026-06-24

This runbook covers the first multi-Brain rollout: serving the ERS Brain through the hosted Brain MCP while John remains the only user.

This is **not** ERS team production access. The local ERS Brain checkout remains the canonical local-first mirror and fallback. ERS-owned Supabase, a dedicated ERS MCP deployment, onboarding/offboarding, and multi-user authorization remain later cutover work.

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

Generate a separate ERS sync LaunchAgent; do not reuse the JEM label.

For background sync, use a daemon-local checkout outside SharePoint/OneDrive. The
OneDrive checkout remains the human-facing ERS Brain checkout and fallback, but
macOS can deny launchd background processes direct access to CloudStorage paths.

```bash
git clone git@github-work:ERS-Genomics/ersg-ai-context-hub.git \
  "$HOME/Library/Application Support/Brain MCP/ers-brain-checkout"

mkdir -p "$HOME/Library/Application Support/Brain MCP/ers-brain-sync"

BRAIN_ID="ers-brain" \
BRAIN_REPO_ROOT="$HOME/Library/Application Support/Brain MCP/ers-brain-checkout" \
BRAIN_SYNC_STATE_FILE="$HOME/Library/Application Support/Brain MCP/ers-brain-sync/state.json" \
BRAIN_SYNC_LAUNCHD_LOG_DIR="$HOME/Library/Application Support/Brain MCP/ers-brain-sync" \
BRAIN_SYNC_LAUNCHD_LABEL="com.jem.ers-brain-sync" \
npm run sync:launchd:plist
```

Review the generated plist before installing. The plist must include both:

```text
BRAIN_ID=ers-brain
BRAIN_DIR=<daemon-local ERS checkout>/brain
BRAIN_SYNC_STATE_FILE=<daemon-local sync state>/state.json
```

This prevents the ERS sync daemon from defaulting to `ai-brain-jem`.

Install after review:

```bash
cp tmp/com.jem.ers-brain-sync.plist ~/Library/LaunchAgents/com.jem.ers-brain-sync.plist
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.jem.ers-brain-sync.plist
launchctl kickstart -k "gui/$(id -u)/com.jem.ers-brain-sync"
```

## Cockpit / Doctor

The cockpit can be run per Brain by pinning `BRAIN_ID` and `BRAIN_DIR`. Use a different label and port for ERS if running beside the JEM cockpit:

```bash
BRAIN_ID="ers-brain" \
BRAIN_REPO_ROOT="$HOME/Library/Application Support/Brain MCP/ers-brain-checkout" \
BRAIN_SYNC_STATE_FILE="$HOME/Library/Application Support/Brain MCP/ers-brain-sync/state.json" \
BRAIN_SYNC_LAUNCHD_LABEL="com.jem.ers-brain-sync" \
BRAIN_COCKPIT_LAUNCHD_LABEL="com.jem.ers-brain-cockpit" \
BRAIN_COCKPIT_PORT=8788 \
npm run hosted:cockpit:launchd:plist
```

The cockpit remains local-only and read-only.

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
