# 006 - Brain Sync Architecture Simplification

**Status:** draft
**Type:** architecture review
**Source:** BACKLOG.md line "Urgent: design a Brain Sync menu-bar app, but first complete an architecture simplification review..."
**Roadmap link:** Milestone 2 / Milestone 3 / Milestone 4
**Decisions impact:** recommends new decisions on ERS sync authority, local-helper productization, Git backup/export, and local MCP fallback scope.
**Related:** `docs/specs/002-local-first-hosted-sync-contract.md`; `docs/specs/003-hosted-brain-sync-architecture.md`; `docs/hosted-brain-recovery-and-git-export.md`; `docs/ers-brain-hosted-pilot.md`; `docs/OWNERSHIP_AND_LIFECYCLE.md`; `docs/ROADMAP.md`; `docs/DECISIONS.md`

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

### Availability: the operator laptop is a correctness dependency, not just an ergonomics one

The surface count above understates the problem. The local sync agent is the **only** component that moves bytes between the two planes: the hosted server never reaches into SharePoint, and SharePoint knows nothing about the revision store. Sync is a 5-second poll loop (`BRAIN_SYNC_INTERVAL_MS`, default 5000) running `syncOnce()` — push, then pull — under the operator's menu-bar supervisor. There is no filesystem watcher, no Graph subscription, and no server-side trigger.

So whenever the operator laptop is asleep, offline, or has the agent stopped:

- SharePoint/Obsidian edits are invisible to every hosted client — Claude mobile, ChatGPT, Codex over HTTP, and any colleague on the hosted MCP;
- hosted MCP writes are invisible in SharePoint/OneDrive and to anyone reading the files;
- the two planes diverge silently for the whole interval, and **nothing surfaces the staleness to a reader** — a hosted read returns the last-synced content with no indication that a newer file-plane version exists (`brain_sync_status` reports health to an operator who goes looking, which is not the same thing).

For a single operator who is also the only reader, this is an ergonomics annoyance: the divergence resolves the next time the machine wakes, and the operator knows when they were offline. It stops being ergonomics the moment there is a second participant. A second pilot user gets a Brain whose freshness depends on whether *another individual's laptop happens to be open* — an availability model that is hard to defend at the ELT rollout gate (`01_ers-brain/brain/governance/brain-mcp-fork-signoff.md` item 14), independent of any Windows-portability or app-packaging argument.

This reframes the local-helper options below. Option A does not merely inherit "hard to guarantee always-on behavior on laptops" as a con; it makes an individual's device uptime a load-bearing part of a shared company system's correctness. Options B and E both remove that dependency by moving the sync trigger server-side, which is a stronger argument for them than the surface-count reduction on its own.

Two adjacent consequences worth carrying into the decision:

- **Attribution.** The agent pushes with `origin: "local_agent"` and the sync profile's single configured actor, so every file-plane edit is recorded as the operator regardless of who made it. A server-side Graph adapter (Option B) gets `driveItem` `lastModifiedBy` for free and closes that gap as a side effect; Option E closes it by removing the unattributed write path entirely. Tracked as its own BACKLOG item.
- **Write controls.** The hosted role gate (`reader` read-only, exact `owner`/`admin` on structural files) is only enforceable on the hosted path, so any library member can walk around it via the file plane. Whichever option is chosen has to state whether the file plane keeps unrestricted write access. Tracked as its own BACKLOG item.

Both collapse into the same Phase 1 question — whether SharePoint remains a human *editing* surface — which is a further reason to decide Phase 1 before building anything.

The menu-bar app remains urgent for John/operator ergonomics and should proceed as a consolidated **operator pilot app** for John's own platform. It should not be positioned as the ERS colleague rollout architecture until the colleague human surface is decided.

## Recommendation

Adopt a **hosted hub + human-facing web surface** target architecture for ERS production if the raw local Markdown/Obsidian constraint can be relaxed for colleagues. Keep Markdown as the Brain's durable, LLM-friendly content format and export/import representation, but do not require colleagues to understand or edit `.md` files.

If ERS must preserve direct human editing of Markdown files in SharePoint/OneDrive, use the **hosted hub + SharePoint adapter** architecture as the fallback target.

Supabase remains the hosted operational hub for MCP reads/writes, revision history, conflict tracking, source metadata, artifacts, telemetry, and access/audit control. A browser-based Brain surface can render Markdown as structured pages, search results, entity/project views, task/review queues, and source manifests. SharePoint/OneDrive remains important as an ERS document/source surface and may receive generated Markdown/HTML exports, but it does not need to be the primary human editing interface unless ERS explicitly wants file-based Brain editing.

The current macOS helper should be retained and improved as a **John-only/operator bridge**. The consolidated menu-bar app should be prioritized to reduce John's operator overhead and make the pilot stable and usable. It should not become the colleague rollout default unless a deliberate future decision makes local helper apps a supported product surface.

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

If the raw Markdown/Obsidian constraint is relaxed for ERS colleagues, the target simplifies further:

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
          -----------------------
          |          |          |
          v          v          v
   Browser UI   Markdown   SharePoint/Graph
 for humans     export     source/inbox/export
```

In this variant, Markdown remains the portable, LLM-digestible content format. It stops being the required human interface for most colleagues.

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
- **An individual's device uptime becomes load-bearing for a shared system's correctness.** With the sync trigger only on a laptop, both planes diverge silently whenever that machine sleeps and no reader is told (see [Availability](#availability-the-operator-laptop-is-a-correctness-dependency-not-just-an-ergonomics-one)). This is the strongest single argument against the option, and it is not fixed by better packaging.
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

**Verdict:** Recommended ERS production target if raw Markdown/Obsidian remains a colleague requirement. Run a read-only Graph spike before productizing any colleague-facing local sync app. This does not block the John/operator menu-bar app.

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

### Option E - Hosted hub with browser human surface; Markdown as storage/interchange

Supabase-backed hosted Brain is the operational source for MCP and human UI. Humans use a browser surface that renders Markdown into readable pages, search, filters, entity/project views, task queues, and review workflows. Markdown remains the stored/revisioned text format and export/import format, but colleagues do not edit raw `.md` files unless they choose to.

**Pros:**

- Strongest colleague usability: no Obsidian, local folders, Git, helper app, or OS-specific install.
- Cross-platform immediately: browser works on macOS, Windows, mobile, and managed devices.
- Keeps Markdown's LLM advantages: plain text, diffs, reviewability, exportability.
- Simplifies support and onboarding.
- Aligns with future ERS multi-user auth, audit, and permissions.

**Cons:**

- Requires building a real human-facing web app, not only MCP tools.
- Needs edit/review UX so humans can safely change Brain content without raw files.
- Requires role-based access, audit, and probably a better content model around Markdown sections/frontmatter over time.
- SharePoint/OneDrive no longer acts as the primary editing surface, which is a product decision.

**Verdict:** Preferred if John accepts that ERS colleagues do not need raw Markdown/Obsidian as their normal surface. This makes the Graph adapter a source/inbox/export connector rather than the main bidirectional Brain editing bridge.

## Surface Support Matrix

| Surface | Current role | Target role | Decision needed |
| --- | --- | --- | --- |
| Supabase Postgres | Hosted revision/conflict/telemetry store | Keep as operational hub | Confirm ERS-owned project before production |
| Supabase Storage | Source/artifact storage | Keep for immutable artifacts and extracted text support | Confirm ERS bucket ownership and byte-access policy |
| Hosted MCP | Remote/client access | Keep as normal API surface | Fork/deploy ERS-owned service before team rollout |
| SharePoint/OneDrive | ERS human-facing Markdown surface | Keep as document/source surface; make raw Markdown editing optional if browser UI is chosen | Decide whether it is primary editing surface or source/export surface |
| Browser Brain UI | Not built | Preferred colleague human surface if Markdown/Obsidian constraint is relaxed | Decide minimum read/write/review scope |
| macOS sync helper | John-only bridge to OneDrive | Consolidated John/operator tool; optional fallback for others | Build menu-bar app for John, not colleague default |
| Helper LaunchAgent | Auto-start implementation detail | Hide inside packaged app or retire | Not user-facing |
| Cockpit/doctor | Local operator dashboard | Move toward central/cloud operator dashboard | Local cockpit remains pilot fallback |
| GitHub repo backup | Backup/version layer | Async export/recovery only | Routine-ops deprecation active; restore rehearsal gates removal as emergency history |
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

Routine-ops deprecation is active as of 2026-06-25. Brain operators should not run Git commit/push/merge as part of normal hosted reads, writes, ingest, lint, doctor, cockpit, or sync checks.

Current recovery baseline:

- hosted sync status is clean for both `ai-brain-jem` and the John-only `ers-brain` pilot;
- Supabase physical backup metadata is visible;
- PITR is not currently enabled;
- Supabase Storage objects are not included in database backups and need separate recovery coverage;
- logical export and restore-to-new-project rehearsal remain gates before Git is removed as emergency history.

Canonical runbook: `docs/hosted-brain-recovery-and-git-export.md`.

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

The Brain Sync menu-bar app is now approved as a near-term John/operator priority. Its purpose is to make the current pilot lean, usable, and stable without terminal/operator overhead.

- **John/operator menu-bar app:** proceed. Shows helper health, last sync, conflicts, doctor status, restart/open logs/open cockpit actions. It owns the local sync watcher and cockpit server as child processes for each configured Brain profile in the consolidated John/operator stack.
- **ERS colleague app:** defer. Do not make colleagues install a sync app unless the Graph adapter is rejected.
- **Distributable package:** defer for broad colleague rollout until we know whether the app is a narrow operator tool or a cross-platform sync product. A lightweight John/operator package is acceptable if it reduces fragility.

Build it as an **operator pilot app**, not "the ERS Brain Sync product."

Implementation note 2026-06-24: the native macOS operator app generator has
shipped as `npm run sync:menubar:install`, with login auto-start generated by
`npm run sync:menubar:launchd:plist`. The app now supports multiple Brain
profiles through `BRAIN_MENUBAR_PROFILES_JSON`, owns each profile's local sync
watcher and cockpit server as child processes, reports per-profile
`brain-monitor-stack.json` supervisor status files for doctor, and keeps
doctor/log/cockpit actions in one menu-bar surface for John/operator use.
Signed/notarized distribution and any colleague-facing tray/menu-bar product
remain deferred.

## Relaxing The Raw Markdown / Obsidian Constraint

Relaxing this constraint materially changes the recommendation.

The original local-first contract protected a real user workflow: John works directly in Markdown and needs local files to remain first-class. That remains valid for John. It does not automatically follow that ERS colleagues should use the same surface.

For most colleagues, raw Markdown and Obsidian are likely implementation details. A better human surface may be:

- browser-readable Brain pages rendered from Markdown;
- search and source-backed snippets;
- entity/project/person views;
- change-review workflows;
- task/inbox queues;
- "suggest an update" forms that create reviewed Markdown patches;
- export to Markdown/HTML/PDF/SharePoint when needed.

In this model:

- Markdown remains valuable as the **content representation**: plain text, diffable, portable, LLM-friendly, easy to export.
- Markdown is not necessarily the **primary human UI**.
- SharePoint/OneDrive remains useful for source documents, published exports, and possibly an advanced raw-file mode.
- The Graph adapter becomes less urgent as a bidirectional Brain-file sync layer and more useful as source ingestion/export plumbing.
- The local helper becomes a John/operator convenience, not a platform requirement.

This is likely the cleanest path for ERS production if the product requirement is "colleagues can use the Brain" rather than "colleagues can edit Brain Markdown files."

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
- Build the consolidated John/operator menu-bar app as the next usability/stability slice.
- Do not add colleague onboarding to the helper.
- Label the menu-bar app as operator-pilot tooling, not ERS colleague product UI.
- Keep Git and local MCP as fallback surfaces, but label them as candidates for deprecation from normal ERS operations.

### Phase 1 - Decide colleague human surface

Before implementing a Graph sync adapter as the main ERS production path, decide whether colleagues need raw Markdown/Obsidian editing.

If the answer is no:

- prioritize a hosted browser Brain UI/read-review surface;
- keep Markdown as the backend/interchange format;
- narrow Graph to SharePoint source ingestion and export/publishing.

If the answer is yes:

- proceed to the SharePoint/Graph adapter spike below.

### Phase 2 - Graph adapter spike

Build a read-only spike against the ERS Brain SharePoint folder:

- resolve site/drive/root IDs;
- enumerate Brain Markdown files;
- read file content and metadata;
- capture delta token behavior;
- map Graph item IDs to Brain filenames;
- compare Graph-observed content against Supabase hosted heads;
- record latency/error behavior.

Exit criterion: clear evidence whether Graph can reliably observe ERS Brain Markdown changes without local OneDrive helper involvement.

### Phase 3 - Minimal bidirectional Graph sync

If raw SharePoint Markdown editing remains required and the Graph spike passes:

- local/SharePoint edit to Supabase revision;
- hosted MCP write to SharePoint file;
- conflict detection when both changed;
- source of truth and conflict UX documented;
- telemetry in existing sync/doctor surfaces.

Exit criterion: a real ERS Markdown edit through OneDrive appears in hosted MCP, and a hosted MCP write appears in SharePoint/OneDrive, without a local helper.

### Phase 4 - Operator surface consolidation

- Convert local cockpit/doctor into a central/cloud operator dashboard or scheduled health service where feasible.
- Keep local cockpit only for John/developer fallback.
- Route alerts to Slack/email with per-Brain labels.
- Track lint, inbox, sync, conflicts, auth, and latency centrally.

### Phase 5 - Deprecation and packaging decisions

- Decide whether local helper apps remain optional fallback or become a supported product.
- Decide whether Git export is required for ERS production.
- Decide whether local MCP remains documented for John/developers only.
- If the helper stays, build menu-bar/tray apps deliberately with installer/update/uninstall support.

## Acceptance Criteria

- Architecture review explicitly chooses one target path for ERS colleague rollout.
- Colleague human surface is classified as raw Markdown/Obsidian, browser UI, or both.
- Git backup/export is classified as emergency async export/history only, with routine Brain operations deprecated.
- Local stdio MCP is classified as normal user surface, developer fallback, or deprecated.
- macOS helper/menu-bar scope is classified as John/operator-only or colleague product.
- Windows support is addressed before any colleague-facing local helper plan is approved.
- SharePoint/Graph adapter feasibility is tested before rejecting it.
- The chosen path states explicitly whether Brain freshness may depend on an individual operator's device being awake, and if it may, whether readers are told when the two planes have diverged. No option is accepted for more than one participant while that dependency is undeclared.
- Doctor/cockpit/local automation responsibilities are assigned to either local operator tooling or cloud operations.
- ERS production path includes ERS-owned Supabase/project ownership before multi-user rollout.

## Out Of Scope

- Implementing the Graph adapter.
- Building the menu-bar app in this review document.
- Building the browser Brain UI.
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
- browser UI feasibility for rendering/searching/updating Markdown-backed Brain content if raw file editing is relaxed;
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

- ERS users may not need raw Markdown/Obsidian as their normal surface; this is now an explicit product decision.
- John remains the only user during the current pilot.
- ERS production requires ERS-owned Supabase and a dedicated ERS MCP deployment before team rollout.
- Local helper apps are acceptable for John/operator use but undesirable as a colleague prerequisite.
- Git backup remains valuable only as emergency async export/history, not as live sync fabric or a routine operator step.
- Local MCP remains valuable as fallback/developer tooling, but not as normal ERS colleague setup.

## Required User Decisions

1. Should the next implementation slice be the consolidated John/operator menu-bar app? Answered: yes; initial operator app shipped 2026-06-24.
2. For ERS colleagues, is raw Markdown/Obsidian editing required, optional/advanced, or unnecessary?
3. If raw Markdown editing is unnecessary for colleagues, should the next architecture spike be a hosted browser Brain UI instead of a bidirectional SharePoint/Graph sync adapter?
4. Should Git remain a required ERS emergency export/history layer after Supabase restore-to-new-project, Storage-object recovery, and any PITR decision are rehearsed?
5. Should local MCP stay documented only for John/developers once hosted MCP and Graph sync are proven?
