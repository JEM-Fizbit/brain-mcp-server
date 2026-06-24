# 006 - Brain Sync Architecture Simplification

**Status:** draft
**Type:** architecture review
**Source:** BACKLOG.md line "Urgent: design a Brain Sync menu-bar app, but first complete an architecture simplification review..."
**Roadmap link:** Milestone 2 / Milestone 3 / Milestone 4
**Decisions impact:** recommends new decisions on ERS sync authority, local-helper productization, Git backup/export, and local MCP fallback scope.
**Related:** `docs/specs/002-local-first-hosted-sync-contract.md`; `docs/specs/003-hosted-brain-sync-architecture.md`; `docs/ers-brain-hosted-pilot.md`; `docs/OWNERSHIP_AND_LIFECYCLE.md`; `docs/ROADMAP.md`; `docs/DECISIONS.md`

## Problem

The current John-only ERS pilot now works, but it has accumulated too many operational surfaces to be a credible colleague rollout model:

- OneDrive/SharePoint local checkout for human Markdown editing;
- hosted MCP on Fly;
- Supabase Postgres revision store and Supabase Storage artifact store;
- macOS native sync helper app;
- helper LaunchAgent;
- local cockpit/doctor;
- GitHub backup/version repo;
- local stdio MCP fallback;
- older Claude scheduled routines and local automation assumptions.

This is acceptable as a controlled single-operator pilot, but it is not acceptable as the default ERS production model. It is especially weak for Windows/PC colleagues, because the current helper is macOS-specific and requires Full Disk Access, local app install, per-user state paths, and launchd. A Windows equivalent is possible, but it would create a second support surface rather than simplifying the architecture.

The menu-bar app remains urgent for John/operator ergonomics, but it should not be productized until we decide whether local helper apps are a real long-term architecture or only a temporary adapter.

## Recommendation

Adopt a **hosted hub + SharePoint adapter** target architecture for ERS production.

Supabase remains the hosted operational hub for MCP reads/writes, revision history, conflict tracking, source metadata, artifacts, telemetry, and access/audit control. SharePoint/OneDrive remains the ERS human-facing file surface. A new hosted Microsoft Graph adapter should synchronize Markdown between Supabase revisions and the ERS SharePoint document library directly.

The current macOS helper should be retained as a **John-only/operator bridge** while the Graph adapter is designed and proven. It should not become the colleague rollout default unless the Graph adapter proves unworkable.

## Target Architecture

```text
Claude / ChatGPT / Codex / future ERS clients
                  |
                  v
        Hosted Brain MCP / OAuth / authz
                  |
                  v
     Supabase Postgres revision/conflict store
     Supabase Storage artifact/archive store
                  |
          -------------------
          |                 |
          v                 v
 SharePoint/Graph      Async Git export
 Markdown adapter      backup/history only
          |
          v
 ERS OneDrive/SharePoint document library
          |
          v
 Humans using Obsidian / file explorer / Office surfaces
```

For JEM/personal use, local Markdown and the macOS helper can remain a pragmatic path. For ERS colleague rollout, the installed local helper should be optional, not required.

## Architecture Options Considered

### Option A - Productize the local helper model across macOS and Windows

Each user runs a local sync app: macOS menu-bar app plus LaunchAgent; Windows tray app plus scheduled task/service. The helper watches the user’s OneDrive-synced folder and syncs with Supabase.

**Pros:**

- Closest to the working John pilot.
- Preserves local Obsidian/file editing directly.
- Can reuse current sync engine.
- Avoids Microsoft Graph app-consent complexity in the short term.

**Cons:**

- High support burden: installs, permissions, paths, local state, upgrades, logs, crashes.
- Platform split: macOS Full Disk Access and LaunchAgents vs Windows tray/service/task scheduler.
- Every colleague becomes part of the sync topology.
- Hard to guarantee always-on behavior on laptops.
- More likely to produce divergent states and support tickets.

**Verdict:** Keep as John/operator fallback. Do not make this the ERS colleague default unless Option B fails.

### Option B - Hosted hub with direct SharePoint/Graph adapter

A hosted worker/service syncs Supabase revisions with the ERS SharePoint/OneDrive library using Microsoft Graph. It uses Graph drive item APIs for file content and delta/change tracking, while Supabase remains the MCP operational store and conflict authority.

**Pros:**

- Cross-platform by design: colleagues use normal SharePoint/OneDrive/Obsidian workflows.
- No per-device Brain sync install required.
- Centralized configuration, telemetry, retries, alerts, and upgrades.
- Cleaner audit/control model for ERS production.
- Aligns with ERS-owned infrastructure and future multi-user governance.

**Cons:**

- Requires Microsoft Graph app registration, permissions, token lifecycle, and ERS admin consent.
- Requires careful conflict handling between Graph changes and hosted MCP writes.
- Must account for OneDrive caching/eventual consistency and SharePoint version behavior.
- Needs a hosted background worker or scheduled job.

**Verdict:** Recommended ERS production target. Run a read-only Graph spike before menu-bar productization.

### Option C - Supabase-only canonical Brain, SharePoint as export/projection

Supabase becomes the only write authority. SharePoint/OneDrive gets generated Markdown snapshots or exports, but humans do not manually write Brain Markdown there.

**Pros:**

- Cleanest backend architecture.
- Simplest consistency model.
- Strong hosted audit trail and access control.

**Cons:**

- Breaks the stated ERS expectation that OneDrive/SharePoint is a primary human-facing source.
- Weakens Obsidian/manual file editing.
- Requires new ERS user-facing editing tools sooner.

**Verdict:** Not recommended for this phase. Revisit only if ERS stops requiring manual Markdown editing in OneDrive/Obsidian.

### Option D - OneDrive/Git as the main source, hosted MCP as thin cache

OneDrive or Git remains canonical, and hosted MCP reads/writes through that layer.

**Pros:**

- Conceptually close to old local-first/git workflows.
- Uses familiar file/version surfaces.

**Cons:**

- Git is already rejected as a hot path in prior decisions.
- OneDrive is not a transactional multi-client application database.
- Hosted latency, conflicts, auth, and telemetry become harder.
- Remote/mobile MCP clients still need a durable hosted state.

**Verdict:** Reject.

## Surface Support Matrix

| Surface | Current role | Target role | Decision needed |
| --- | --- | --- | --- |
| Supabase Postgres | Hosted revision/conflict/telemetry store | Keep as operational hub | Confirm ERS-owned project before production |
| Supabase Storage | Source/artifact storage | Keep for immutable artifacts and extracted text support | Confirm ERS bucket ownership and byte-access policy |
| Hosted MCP | Remote/client access | Keep as normal API surface | Fork/deploy ERS-owned service before team rollout |
| SharePoint/OneDrive | ERS human-facing Markdown surface | Keep as ERS human surface | Decide direct Graph adapter scope |
| macOS sync helper | John-only bridge to OneDrive | Transitional/operator-only unless Option B fails | Do not productize as colleague default yet |
| Helper LaunchAgent | Auto-start implementation detail | Hide inside packaged app or retire | Not user-facing |
| Cockpit/doctor | Local operator dashboard | Move toward central/cloud operator dashboard | Local cockpit remains pilot fallback |
| GitHub repo backup | Backup/version layer | Async export/recovery only | Define export cadence and recovery authority |
| Local stdio MCP | Trusted fallback | Developer/operator fallback only | Do not require for colleagues |
| Daemon-local mirror | Temporary workaround | Retire | Keep only as emergency recovery pattern |
| Claude scheduled routines | Fragile scheduled QA | Replace with cloud ops service | Preserve until cloud service exists |

## Git Backup Position

Git should remain useful, but it should not be treated as live sync infrastructure.

Recommended role:

- async export from accepted hosted/SharePoint state;
- human-auditable history;
- emergency recovery snapshot;
- optional developer workflow for local repos.

Not recommended:

- Git pull/push as routine propagation between hosted MCP and OneDrive;
- Git conflicts as the primary user-facing conflict model;
- requiring colleagues to understand or run Git.

Deprecation condition: once Supabase backup/restore, SharePoint versioning, and async export/recovery are documented and tested, Git can be removed from normal ERS operator runbooks and kept as an implementation backup.

## Local MCP Position

The local stdio MCP remains valuable for John and developers because it is fast, inspectable, and resilient when hosted infrastructure is unavailable.

It should not be part of ERS colleague onboarding.

Recommended role:

- John/developer fallback;
- local filesystem-heavy maintenance;
- emergency recovery and debugging;
- compatibility/regression baseline.

Deprecation condition: hosted MCP plus SharePoint/Graph sync must pass the local-first acceptance tests, including read/write parity, conflict handling, latency, and recovery. Even then, local MCP can remain a developer tool, but it should be removed from normal user documentation.

## Menu-Bar App Position

The Brain Sync menu-bar app is still useful, but its scope must be explicit before implementation:

- **John/operator menu-bar app:** good near-term value. Shows helper health, last sync, conflicts, doctor status, restart/open logs/open cockpit actions. It can wrap the current macOS helper and LaunchAgent.
- **ERS colleague app:** defer. Do not make colleagues install a sync app unless the Graph adapter is rejected.
- **Distributable package:** defer until we know whether the app is a narrow operator tool or a cross-platform sync product.

If we build now, name it as an **operator pilot app**, not "the ERS Brain Sync product."

## Windows / PC Portability

If Option A becomes necessary, Windows requires a separate product surface:

- tray app, not menu-bar app;
- installer/MSIX or signed setup executable;
- per-user OneDrive path discovery;
- scheduled task or Windows service for auto-start;
- local logs and health view;
- safe upgrade/uninstall path;
- equivalent conflict and doctor notifications.

That is a real product build, not a small packaging tweak. This is the main reason Option B is preferred for ERS colleagues.

## SharePoint / Graph Feasibility Notes

Microsoft Graph provides file primitives that are directionally aligned with Option B:

- `driveItem` represents files/folders in OneDrive and SharePoint document libraries;
- drive item delta APIs can track changed items over time;
- small file content can be created or updated by a single content upload call;
- large files can use upload sessions;
- drive item version APIs expose version metadata/content paths.

This does not prove the adapter is easy. It does mean a Graph spike is technically plausible and should be evaluated before we invest in cross-platform local sync apps.

References:

- Microsoft Graph `driveItem` resource: `https://learn.microsoft.com/en-us/graph/api/resources/driveitem`
- Microsoft Graph drive item delta: `https://learn.microsoft.com/en-us/graph/api/driveitem-delta`
- Microsoft Graph small-file content upload/update: `https://learn.microsoft.com/en-us/graph/api/driveitem-put-content`
- Microsoft Graph large-file upload sessions: `https://learn.microsoft.com/en-us/graph/api/driveitem-createuploadsession`
- Microsoft Graph drive item versions: `https://learn.microsoft.com/en-us/graph/api/driveitem-list-versions`

## Proposed Phased Plan

### Phase 0 - Freeze architecture creep

- Keep the current macOS helper running for John.
- Do not add colleague onboarding to the helper.
- Do not start menu-bar implementation until the operator-vs-product scope is approved.
- Keep Git and local MCP as fallback surfaces, but label them as candidates for deprecation from normal ERS operations.

### Phase 1 - Graph adapter spike

Build a read-only spike against the ERS Brain SharePoint folder:

- resolve site/drive/root IDs;
- enumerate Brain Markdown files;
- read file content and metadata;
- capture delta token behavior;
- map Graph item IDs to Brain filenames;
- compare Graph-observed content against Supabase hosted heads;
- record latency/error behavior.

Exit criterion: clear evidence whether Graph can reliably observe ERS Brain Markdown changes without local OneDrive helper involvement.

### Phase 2 - Minimal bidirectional Graph sync

If Phase 1 passes:

- local/SharePoint edit to Supabase revision;
- hosted MCP write to SharePoint file;
- conflict detection when both changed;
- source of truth and conflict UX documented;
- telemetry in existing sync/doctor surfaces.

Exit criterion: a real ERS Markdown edit through OneDrive appears in hosted MCP, and a hosted MCP write appears in SharePoint/OneDrive, without a local helper.

### Phase 3 - Operator surface consolidation

- Convert local cockpit/doctor into a central/cloud operator dashboard or scheduled health service where feasible.
- Keep local cockpit only for John/developer fallback.
- Route alerts to Slack/email with per-Brain labels.
- Track lint, inbox, sync, conflicts, auth, and latency centrally.

### Phase 4 - Deprecation and packaging decisions

- Decide whether local helper apps remain optional fallback or become a supported product.
- Decide whether Git export is required for ERS production.
- Decide whether local MCP remains documented for John/developers only.
- If the helper stays, build menu-bar/tray apps deliberately with installer/update/uninstall support.

## Acceptance Criteria

- Architecture review explicitly chooses one target path for ERS colleague rollout.
- Git backup/export is classified as hot path, backup/export, or deprecated.
- Local stdio MCP is classified as normal user surface, developer fallback, or deprecated.
- macOS helper/menu-bar scope is classified as John/operator-only or colleague product.
- Windows support is addressed before any colleague-facing local helper plan is approved.
- SharePoint/Graph adapter feasibility is tested before rejecting it.
- Doctor/cockpit/local automation responsibilities are assigned to either local operator tooling or cloud operations.
- ERS production path includes ERS-owned Supabase/project ownership before multi-user rollout.

## Out Of Scope

- Implementing the Graph adapter.
- Building the menu-bar app.
- Changing current running helper/LaunchAgent behavior.
- Removing Git, local MCP, or cockpit.
- Changing Supabase schema or security policy.
- ERS team onboarding.

## Technical Constraints

- Brain schema remains private; do not expose Brain tables to browser/client roles.
- Hosted MCP runtime uses Supabase Postgres and Storage; ERS production requires ERS-owned infrastructure before team rollout.
- Current Graph work must respect ERS Microsoft 365 admin consent and least-privilege policy.
- Sync must preserve the existing conflict model: no silent overwrite of local/manual or hosted changes.
- OneDrive/SharePoint may have caching/eventual consistency; tests must measure this rather than assume instantaneous propagation.
- Current macOS helper requires a signed/native app identity for CloudStorage access; a shell/Node LaunchAgent is not enough.

## Test Plan For The Next Architecture Slice

No code is changed by this review. The next implementation spec should test:

- Graph read-only enumeration of ERS Brain Markdown files;
- Graph delta behavior after manual OneDrive/Obsidian edits;
- hosted-head comparison for Graph-observed files;
- permission and token lifecycle failure modes;
- conflict cases where hosted and SharePoint copies both change;
- latency and retry behavior for file reads/writes;
- recovery when delta token is invalid or stale.

## Data Files Touched

None in this review.

## Verification Commands

For this review document:

```bash
git diff --check
```

For the current pilot health baseline:

```bash
BRAIN_ID="ers-brain" \
BRAIN_DIR="/Users/johnemilad/Library/CloudStorage/OneDrive-SharedLibraries-ERSGenomics/Systems & IT - Documents/01_ers-brain/brain" \
BRAIN_SYNC_STATE_FILE="$HOME/Library/Application Support/Brain MCP/ers-brain-onedrive-sync/state.json" \
BRAIN_SYNC_LAUNCHD_LABEL="com.jem.ers-brain-sync.helper" \
node scripts/hosted-doctor.mjs
```

## Assumptions

- ERS users should continue to see SharePoint/OneDrive as the normal shared file surface for Brain Markdown unless John decides otherwise.
- John remains the only user during the current pilot.
- ERS production requires ERS-owned Supabase and a dedicated ERS MCP deployment before team rollout.
- Local helper apps are acceptable for John/operator use but undesirable as a colleague prerequisite.
- Git backup remains valuable, but not as live sync fabric.
- Local MCP remains valuable as fallback/developer tooling, but not as normal ERS colleague setup.

## Required User Decisions

1. Should the first implementation slice be a read-only SharePoint/Graph adapter spike?
2. Is the macOS menu-bar app allowed to proceed as a John/operator-only pilot while the Graph adapter is evaluated?
3. Should Git remain a required ERS backup/export layer after Supabase and SharePoint versioning are verified?
4. Should local MCP stay documented only for John/developers once hosted MCP and Graph sync are proven?
