# 002 - Local-First Hosted Sync Contract

**Status:** draft
**Source:** 2026-06-14 hosted Brain pilot reset after Codex/Fly tests exposed local-file drift and unacceptable latency.
**Related:** `docs/specs/001-brain-platform-phase-1-2.md`; `docs/DECISIONS.md`; `docs/deploy-fly.md`

## Problem

The hosted Brain pilot proved that a remote MCP endpoint can authenticate and write to the Brain, but it did not preserve the core product requirement: John's local Markdown Brain remains the primary working surface. A remote write that reaches GitHub but does not appear locally is a regression. A local Markdown edit that does not reach the hosted MCP server quickly is also a regression.

GitHub was originally a cheap backup/versioning layer for a local-first Markdown repo. The pilot accidentally promoted git/GitHub into the live sync fabric. That must be re-derived from first principles rather than inherited from the old local-only architecture.

The target is not "a cloud MCP" for its own sake. The target is one Brain capability that works across every required surface, including clients that cannot access local Markdown files directly, while preserving the speed and ergonomics of the current local MCP.

## First-Principles Requirements

1. Local Markdown remains a first-class editing surface.
2. Remote MCP clients see the same Brain state quickly and safely.
3. Local/manual Markdown edits sync to the hosted server without a manual commit/push ritual.
4. Hosted MCP edits sync back to local files without a manual pull ritual.
5. Sync must never silently overwrite local or remote work.
6. Normal read/write latency should feel like memory access, not a slow web app.
7. Git history is valuable, but git is not automatically the right operational sync substrate.
8. The interim architecture must be portable to a future persistent headless Mac mini.
9. The ERS Brain has an additional canonical collaboration layer: SharePoint/OneDrive. Any final design must account for local files, SharePoint sync, and the hosted MCP server.
10. The MCP/hosting solution must work across all required surfaces: private/JEM and ERS Brains; SharePoint-backed and non-SharePoint Brains; Claude and ChatGPT/OpenAI surfaces; desktop, web, and mobile apps; and remote-only clients with no local filesystem access.
11. No cloud or hosted rebuild may regress from the current local MCP baseline. The local stdio MCP remains the gold path for speed, direct Markdown access, existing tool behavior, and operator trust until a hosted design meets or exceeds it in measured end-to-end tests.

## Surface Coverage Contract

The final Brain platform must provide a coherent read/write experience across:

- JEM private Brain and ERS Brain.
- Local-only Markdown storage and SharePoint/OneDrive-backed storage.
- Claude, ChatGPT/OpenAI, Codex, and other MCP-capable clients.
- Desktop, web, and mobile app surfaces.
- Clients with local filesystem access and clients that only have HTTPS access to a hosted MCP endpoint.

Surface support is a product requirement, not a hosting preference. The implementation may use different adapters for local stdio, hosted HTTPS, SharePoint/OneDrive, future Mac mini hosting, cloud storage, or git export, but those adapters must preserve one logical Brain state and one conflict model.

The local MCP baseline is the regression floor:

- Local reads and writes must continue to work directly against the local Markdown Brain.
- The local path must not require hosted availability.
- The hosted path must not introduce manual commit/push/pull rituals into normal use.
- Any new hosted or sync design must pass parity tests against the local stdio MCP before it becomes the recommended/default path.

## Brain-Specific Authority Models

### JEM Brain

- Primary human surface: local Markdown files, typically through Obsidian and direct file edits.
- Cloud storage: to be selected or provisioned; not currently SharePoint-backed.
- Hosted MCP: needed for remote-only clients such as ChatGPT/mobile/Codex surfaces that cannot use local stdio.
- GitHub: candidate for backup/export/history only unless it wins the sync-substrate decision on merits.

### ERS Brain

- Primary shared sync surface: SharePoint/OneDrive.
- Local files: OneDrive-synced working copy used by agents and humans.
- Hosted MCP: future remote access layer.
- GitHub: currently version/backup layer, not user-facing sync.
- Final solution must work with or around SharePoint behavior, including OneDrive caching, eventual consistency, and document lock patterns for Office files.

## Interim Hosting Requirement

Before the Mac mini exists, the hosted MCP server needs an interim host that:

- is always reachable over HTTPS;
- can run the same storage/sync abstraction intended for the Mac mini;
- does not bake Fly-specific assumptions into the core Brain model;
- supports safe bidirectional sync with the local editing surface;
- supports remote-only clients, including mobile apps, that cannot mount or read the local Markdown files;
- can be migrated by changing adapters/configuration rather than rewriting Brain tools.

The interim host can remain Fly only if the sync contract is met. If Fly's persistent-volume/git-working-copy model cannot meet the contract without excessive complexity or latency, replace it.

## Git Question

Git should be evaluated as one possible component, not a default.

Potential roles:

- Good fit: durable history, diff, rollback, backup/export, human-auditable commits.
- Weak fit: low-latency live sync, conflict-free concurrent editing, multi-surface state propagation, SharePoint bridging.

Resolved decision: git is demoted out of the hot path. It remains emergency async export/history only behind the hosted revision store; see `docs/specs/003-hosted-brain-sync-architecture.md` and `docs/hosted-brain-recovery-and-git-export.md`.

## Candidate Architectures

### A. Git-Backed Working Copies as Hot Path

Local files and hosted files are separate working copies synced through git.

Pros: minimal migration from current code; Markdown remains natural; preserves history.

Cons: pull/push discipline, conflict handling, local watcher needed, hosted pull-before-read/write needed, poor fit for SharePoint, latency and drift risk.

### B. Cloud Store Canonical, Local Markdown Mirror

A database/content store is canonical for hosted MCP. Local Markdown is a mirror maintained by a sync agent.

Pros: transactional writes, easier hosted reads, structured sync state, better multi-client semantics, easier indexing.

Cons: more engineering; local Markdown becomes a projection; needs robust mirror conflict UX; git history becomes export rather than native state.

### C. Object Store Plus Metadata DB

Markdown files live as objects; metadata, versions, locks, and sync cursors live in a DB.

Pros: keeps file-shaped artifacts; clearer version metadata; portable to cloud or Mac mini.

Cons: still needs sync engine; more moving parts than pure DB.

### D. Mac Mini as Canonical Filesystem Host

The future Mac mini runs the MCP server and serves the canonical local filesystem directly.

Pros: preserves local-file mental model; no cloud DB required; portable from current Node code.

Cons: not available yet; uptime, security, remote HTTPS, backups, and mobile access need proper ops; ERS SharePoint still needs separate treatment.

## Required Sync Behaviors

### Hosted to Local

- Hosted write completes only after durable storage succeeds.
- Local sync agent detects remote changes and updates local files automatically.
- If local tree is clean, fast-forward/apply automatically.
- If local files are dirty, preserve local changes and surface a sync-blocked state.
- No silent conflict resolution for Brain content.

### Local to Hosted

- Local file changes are detected promptly.
- Changes are pushed or transmitted to the hosted server automatically when safe.
- Hosted server refreshes before reads and before writes, or receives change notifications.
- If the hosted copy has changed since the local edit base, block and surface conflict rather than overwrite.

### Latency

- Read-path target: common Brain context reads should be measured in low seconds end-to-end, with server-side file reads in milliseconds.
- Write-path target: small log/update writes should complete in seconds, not tens of seconds.
- Instrumentation must separate server work, sync work, network/git/provider work, MCP client overhead, and model/tool orchestration.

## Root Cause Analysis

### What Went Wrong

1. The Phase 1+2 spec preserved "filesystem + git working copy" as an implementation detail without restating the local-first product invariant as an acceptance criterion.
2. The hosting decision optimized for the fastest path to remote OAuth/MCP reachability, not for bidirectional sync with the actual primary surface.
3. GitHub's old role as backup/versioning was implicitly promoted to live sync without a first-principles decision.
4. Verification tested remote MCP authentication and hosted writes, but not the complete user workflow: remote write visible locally, local edit visible remotely, conflict behavior, and latency.
5. The spec said "keep stdio working" but did not say "local files remain the primary live workspace and must stay current."
6. The implementation moved ahead after the spec despite the kickoff instruction to get sign-off before coding; that removed a checkpoint where this gap might have been caught.

### Why It Was Missed

- The existing local implementation made git feel load-bearing because commits were already part of the workflow.
- The remote-client forcing function was clear; the local-sync consequence was treated as operational plumbing rather than core product behavior.
- "Hosted can write" was mistaken for "hosted is integrated."
- The test plan used component success, not human-surface success.

### Corrective Actions

- Treat sync and latency as acceptance criteria, not follow-up polish.
- Make the storage/sync substrate an explicit architecture decision before more hosting work.
- Keep local stdio as the fast path until hosted meets the local-first contract.
- Keep the local MCP as the active/default Codex path while the hosted architecture is rebuilt.
- Add end-to-end tests for hosted-to-local, local-to-hosted, conflict-blocked, and latency-instrumented flows.
- Add surface-parity tests for JEM, ERS, SharePoint-backed, non-SharePoint, Claude, ChatGPT/OpenAI, desktop/web, and mobile/no-filesystem scenarios before declaring hosted successful.
- Record architecture reversals in `docs/DECISIONS.md` instead of quietly layering patches over prior decisions.

## Acceptance Criteria For The Next Build

- A selected architecture explicitly says whether git is hot path, backup/export, or removed. Current answer: emergency async export/history only; no routine Brain commit/push/merge.
- JEM local Markdown edits propagate to hosted MCP automatically in a measured, bounded time.
- Hosted MCP edits propagate to JEM local Markdown automatically in a measured, bounded time.
- Dirty local files block or queue sync visibly; they are not overwritten.
- ERS design covers the SharePoint/OneDrive layer separately from the JEM local-only case.
- Remote-only surfaces, including mobile apps, can read and write through the hosted layer without direct local filesystem access.
- Claude and ChatGPT/OpenAI surfaces are both included in the compatibility test plan.
- The current local stdio MCP remains operational, fast, and behaviorally compatible throughout the rebuild.
- Hosted/cloud is not the default or recommended path until it passes local baseline parity tests.
- Migration path to Mac mini is documented as adapter/config movement, not a rewrite.
- Tests include the complete user-visible loop, not just server internals.
