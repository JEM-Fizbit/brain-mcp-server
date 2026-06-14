# 003 - Hosted Brain Sync Architecture

**Status:** draft
**Source:** 2026-06-14 hosted Brain rebuild after the Fly/git pilot was reverted from Codex.
**Related:** `docs/specs/001-brain-platform-phase-1-2.md`; `docs/specs/002-local-first-hosted-sync-contract.md`; `docs/DECISIONS.md`; `docs/deploy-fly.md`

## Problem

The hosted pilot proved that remote MCP clients can authenticate and call Brain tools, but it used a separate hosted git working copy as the live write path. That left John's local Markdown Brain stale until a manual pull, and it gave local edits no automatic path back to hosted clients.

The next hosted build must preserve the current local stdio MCP baseline while adding remote/mobile access. The product target is one logical Brain state across local Markdown, hosted MCP, and later SharePoint/OneDrive-backed Brains.

## Decision Summary

Use a conflict-aware replicated revision model:

- Local Markdown files remain a first-class editing surface and the local stdio MCP remains the default/gold path.
- Hosted MCP uses a durable hosted revision store for remote-only reads and writes.
- A local sync agent keeps the local Markdown tree and hosted revision store synchronized automatically.
- Git is removed from the hot path. It becomes an async backup/export/history layer.
- Sync conflicts are explicit records, never silent overwrites.

This is closest to candidate B from `002`: cloud/hosted state plus local Markdown mirror, with an important constraint: Markdown remains the user-visible content format, not an implementation detail that can drift out of sight.

## Current Baseline To Preserve

- Active Codex connector: local stdio `mcp__brain`.
- Accessible Brain confirmed in this session: `ai-brain-jem`.
- Storage backend: filesystem.
- Local Brain directory: `/Users/johnemilad/Projects/ai-brain-jem/brain`.
- Hosted `brain-hosted` is intentionally not available as an active connector while this architecture is rebuilt.

The rebuild must not degrade:

- `brain_load_context`
- `brain_read_file`
- `brain_search`
- `brain_update_file`
- `brain_commit`
- `brain_list_files`
- source archive access
- ingest/log/lint/inbox workflows

## Authority Model

The Brain state is a replicated set of Markdown file revisions. There is no longer a single git checkout that implicitly wins.

### Hosted Revision Store

The hosted store is the operational authority for remote-only clients. It stores:

- current head revision per Brain file;
- immutable file revisions;
- per-revision content hashes;
- origin metadata: local agent, hosted MCP, import, or system;
- actor metadata from OAuth or local stdio/system identity;
- sync client cursors;
- conflict records;
- latency and sync event telemetry.

The hosted store must support transactional compare-and-swap writes by `brain_id`, filename, and expected base revision.

### Local Markdown Tree

The local Markdown tree remains the primary human working surface. Obsidian, local editors, local Codex/Claude stdio MCP, and direct file edits continue to operate on ordinary `.md` files.

A local sync agent maintains internal sync metadata beside the local checkout, for example under `.brain-sync/`. That metadata is not Brain content and should not create user-facing variant Brain filenames.

The local agent records:

- sync client id;
- last applied hosted revision per file;
- last applied content hash per file;
- local file hash at last successful sync;
- pending local edits;
- blocked/conflict status.

### Git Export

Git is backup, audit, rollback, and optional human review history. It is not live sync.

Allowed git roles:

- commit clean local snapshots after successful sync;
- push/pull as a backup/export mechanism;
- provide human-readable diffs and rollback;
- preserve history for the private Brain repo.

Rejected git roles:

- required transport between local and hosted;
- pull-before-read on hosted MCP requests;
- push-before-local-visibility on hosted writes;
- conflict resolver of first resort for remote/local edits.

## Core Sync Protocol

Each Markdown file has a current hosted `revision_id` and `content_hash`.

Each write carries a base revision:

```text
brain_id
filename
base_revision_id
new_content
origin
actor
```

The hosted store accepts the write only if `base_revision_id` is still the file head. If not, it records or returns a conflict.

Idempotent duplicate content may be accepted without a new conflict when the incoming content hash already equals the current head hash.

## Hosted To Local

1. Hosted MCP write creates a new revision transactionally.
2. Local sync agent receives or polls the hosted revision cursor.
3. If the local file hash equals the agent's last applied hash, the agent writes the hosted content to the Markdown file and updates local sync metadata.
4. If the local file hash differs from the last applied hash, the agent leaves the local file untouched and records a sync-blocked conflict.
5. No hosted change silently overwrites dirty local Markdown.

## Local To Hosted

1. Local sync agent detects file changes by watcher or scheduled scan.
2. The agent compares the current file hash with the last applied hash.
3. If changed, the agent submits the local content with the stored base revision.
4. The hosted store accepts the write only if the base revision is still current.
5. If hosted changed first, the hosted store records a conflict and the local file remains untouched.

The first implementation may start with a one-shot scan/push/pull command before adding continuous file watching. The acceptance test remains the same: normal use cannot require manual commit/push/pull rituals.

## Conflict Model

Conflicts are first-class sync state.

A conflict contains:

- `brain_id`
- filename
- local base revision
- remote head revision
- local content hash
- remote content hash
- local actor/origin
- remote actor/origin
- timestamps
- status: open, resolved, superseded

Conflict content should live in the hosted revision/conflict store or sync metadata, not as `_v2`, `_FINAL`, `_conflict`, or similar user-facing Brain filenames.

Resolution is explicit:

- user or agent reviews local and remote content;
- writes a resolved Markdown version with the conflict base acknowledged;
- sync marks the conflict resolved;
- git export may commit the resolved clean state later.

## Required Interfaces

### `RevisionStore`

The hosted layer should be coded against an interface before a provider is treated as final.

Minimum methods:

```typescript
interface RevisionStore {
  getHead(brainId: string, filename: string): Promise<FileHead | null>;
  readFile(brainId: string, filename: string): Promise<RevisionContent>;
  listFiles(brainId: string): Promise<FileHead[]>;
  searchFiles(brainId: string, query: string, options: SearchOptions): Promise<SearchResult[]>;
  proposeRevision(input: RevisionProposal): Promise<RevisionAccepted | RevisionConflict>;
  listChanges(brainId: string, sinceCursor?: string): Promise<ChangePage>;
  recordConflict(input: ConflictInput): Promise<ConflictRecord>;
  listConflicts(brainId: string, status?: "open" | "resolved"): Promise<ConflictRecord[]>;
}
```

The first local test provider can be in-memory, file-backed JSON, or SQLite. The production hosted provider is Postgres. A single-node file/SQLite provider is acceptable only for local tests or a temporary single-host harness.

### `LocalSyncAgent`

Minimum responsibilities:

- initialize local sync metadata from hosted heads;
- scan local files for changes;
- push clean local edits to hosted;
- pull hosted edits to local files;
- block on dirty local files;
- surface conflict status;
- emit latency and sync telemetry;
- run without requiring the MCP client to know sync internals.

The agent can start as a CLI/daemon beside the local Brain checkout. Later the Mac mini can run the same agent logic with a different local root and host configuration.

### MCP Tools

The existing Brain tools should keep their names and schemas unless a sync-specific tool is needed.

Likely new tools for hosted/control surfaces:

- `brain_sync_status`
- `brain_list_conflicts`
- `brain_resolve_conflict`

These should not be added until the underlying sync state exists. The local stdio path does not need to expose hosted sync tools as its primary workflow.

## Storage Provider Decision

Production storage is Postgres plus Supabase Storage:

- Postgres is the production `RevisionStore` and metadata database.
- Supabase Storage private buckets store original binary/source artifacts.
- The file-backed JSON store remains a local harness only.
- Git remains async export/history only.

Postgres owns:

- Brain registry and principals, or a DB-backed mirror of the config registry;
- current Markdown file heads;
- immutable Markdown file revisions;
- sync clients and cursors;
- sync conflicts;
- source provenance and artifact manifests;
- extracted text/OCR/Markdown conversion metadata;
- source chunks and future embeddings;
- ingest jobs and operational telemetry.

Supabase Storage owns:

- original PDFs, DOCX files, images, audio, and other binaries;
- Markdown/text conversion artifacts when they should be retained as files;
- thumbnails or derived previews;
- immutable snapshots of external sources when policy requires a retained copy.

Postgres should not store original binaries as `bytea` except for tiny test fixtures. Store checksums, MIME type, size, storage bucket/path, retention status, and external source pointers in Postgres instead.

The default private Storage bucket is `brain-artifacts`. Object paths are immutable and content-addressed:

```text
brains/{brain_id}/sources/{source_id}/{artifact_kind}/{sha256_prefix}_{sanitized_original_filename}
```

Uploads should use `upsert=false` by default. Re-ingesting changed source content creates a new object path and a new manifest row instead of replacing a prior artifact.

### Security Gate

Hosted Brain migration work that touches sensitive data must pass the Supabase security gate before import or sync runs continue. For the pilot project, the recorded gate is `docs/security/hosted-brain-supabase-security-gate.md`.

Required baseline:

- `brain` remains a private schema with no grants to `anon`, `authenticated`, or `public`;
- all `brain.*` tables have RLS enabled;
- no public/client RLS policies are added until the hosted access model is explicitly designed;
- `brain-artifacts` remains a private Storage bucket;
- service role keys, database passwords, and privileged connection strings are stored only in secret managers;
- Supabase advisors are rerun after migrations that touch schema, RLS, functions, Storage, or user data.

### Source Artifacts

Source ingestion must retain provenance separately from curated Brain Markdown revisions.

Recommended source model:

- `sources`: one logical source event/document set, with label, category, status, and provenance.
- `source_artifacts`: original and derived files for that source.
- `source_artifact_text`: extracted full text or Markdown conversion for search/indexing.
- `source_chunks`: chunked text and future embedding rows.
- `ingest_jobs`: processing state and errors.

For JEM, original source artifacts can live in a private Supabase Storage bucket. For ERS, SharePoint/OneDrive may remain canonical for some business documents. In that case Postgres stores a SharePoint/Graph pointer plus metadata; Supabase Storage stores an immutable snapshot only when the Brain needs retained evidence or remote-only access independent of SharePoint availability.

## Runtime Configuration

The first hosted Brain Supabase target is a new dedicated project in John's private Supabase org. It is a pilot/control project for rebuilding hosted MCP correctly, not the long-term ERS production owner.

ERS production cutover requires a separate ERS-owned Supabase project. The application must treat Supabase project refs, URLs, keys, bucket names, and database URLs as deployment configuration. Do not bake John's private org, project ref, or account assumptions into code, migrations, object paths, OAuth callbacks, or Brain ids.

Local/default harness:

```bash
BRAIN_REVISION_STORE=filesystem
BRAIN_ARTIFACT_STORE=filesystem
```

Production hosted Brain target:

```bash
BRAIN_REVISION_STORE=postgres
BRAIN_REVISION_DATABASE_URL=postgresql://...
BRAIN_ARTIFACT_STORE=supabase
BRAIN_SUPABASE_URL=https://<project-ref>.supabase.co
BRAIN_SUPABASE_SERVICE_ROLE_KEY=<server-side secret only>
BRAIN_SUPABASE_STORAGE_BUCKET=brain-artifacts
```

Supabase credentials are deployment secrets, not chat inputs. The Supabase MCP connector can manage projects and migrations after the target project is selected, but the running MCP server still needs its own server-side Supabase URL/key in Fly, Mac mini launch config, or the eventual hosting secret manager.

Live application gate: do not apply the production migration to an existing Supabase project. Apply it only to the new dedicated hosted Brain project.

The local sync CLI can target either the file-backed harness or Postgres:

```bash
npm run sync -- status
```

For the Postgres-backed pilot, set `BRAIN_REVISION_STORE=postgres` and provide `BRAIN_REVISION_DATABASE_URL` from local/deployment secrets before running `npm run sync -- push`, `pull`, `once`, or `status`. Do not store that URL in the repository or paste it into chat.

The pilot project is bootstrapped with `db/seeds/2026-06-14_001_bootstrap_pilot_brain.sql`, which creates the `ai-brain-jem` registry row only. It does not grant API roles, add RLS policies, or expose Storage objects.

Before bulk-seeding real Brain content, use `BRAIN_SYNC_INCLUDE_FILES` for a single-file canary:

```bash
BRAIN_SYNC_INCLUDE_FILES=NOW.md npm run sync -- push
```

The include list is comma-separated and applies to push, pull, and once. This prevents accidental whole-Brain sync during pilot verification.

Pilot verification on 2026-06-14:

- temporary smoke Brain push/status/pull round trip passed against Supabase Postgres;
- real `ai-brain-jem` canary push of `00_loader.md` passed;
- real `ai-brain-jem` canary pull of `00_loader.md` into a fresh mirror passed;
- staged core seed of 14 root Brain files passed and a fresh mirror matched all files byte-for-byte;
- temporary Postgres BrainStore smoke test passed read/write/list/search through the MCP-facing storage abstraction;
- full `ai-brain-jem` Markdown seed of 49 files passed and a fresh mirror matched all files byte-for-byte;
- source/original artifact inventory recorded 70 pointer-only manifests before upload;
- source/original artifact upload completed for 70 files into the private `brain-artifacts` bucket with active Postgres manifests and distinct immutable Storage paths;
- Postgres-backed Brain store can list source manifests and search source paths by filename/path metadata; full extracted-text/OCR source search remains a later ingestion step;
- no conflicts were recorded for the canary push.

### Supabase Project Portability

The private-org pilot and ERS production projects should be structurally identical:

- same migration files from this repository;
- same private Storage bucket name unless ERS policy requires a different configured name;
- same logical `brain_id` values;
- no app code that depends on Supabase project ref, org id, region, or generated URLs;
- all secrets and URLs supplied through environment/config;
- export/import procedures verified before ERS data is introduced.

ERS cutover procedure:

1. Create ERS-owned Supabase project.
2. Apply the repository migrations to the ERS project.
3. Create/configure server-side secrets for the hosted MCP runtime.
4. Put the private-org pilot into read-only or paused-write mode.
5. Export the `brain` schema data with stable IDs preserved.
6. Copy `brain-artifacts` Storage objects and verify checksums against `brain.source_artifacts`.
7. Import data into the ERS project.
8. Run schema, row-count, revision-head, conflict, and artifact checksum verification.
9. Point the hosted MCP environment at the ERS project.
10. Re-run the local-first hosted sync acceptance tests before declaring ERS production live.

The private-org pilot may remain as an archive only after cutover; it must not continue accepting writes for ERS production Brains.

## ERS And SharePoint/OneDrive

ERS Brain adds a collaboration layer outside the JEM local-only case:

- SharePoint/OneDrive is the primary shared file sync surface for ERS.
- A OneDrive-synced local working copy can be treated as a local sync-agent root, but OneDrive caching and eventual consistency must be measured.
- Office document lock/caching behavior is separate from Markdown sync. For business spreadsheets/docs, users should close Excel/Office files before automated edits.
- A future SharePoint/Graph adapter may sync directly between hosted revision store and SharePoint rather than relying on a local OneDrive client.

The JEM implementation must not assume that every Brain has GitHub as its collaboration layer.

## Latency Instrumentation

Every hosted MCP request and sync cycle should record separate timings:

- MCP transport/auth overhead;
- tool handler time;
- revision store read/write time;
- local agent scan time;
- local file write time;
- provider/network time;
- git export time, if triggered.

Acceptance should be based on measured end-to-end user-visible loops, not only server internals.

## Acceptance Tests

Before hosted becomes recommended/default again:

1. **Local baseline still works:** local stdio MCP can read, search, update, lint, ingest, and commit against the local Brain.
2. **Hosted to local:** a hosted write appears in the local Markdown file automatically within the measured target window.
3. **Local to hosted:** a local Markdown edit appears in hosted MCP reads automatically within the measured target window.
4. **Dirty local block:** hosted write does not overwrite a locally dirty file; conflict status is visible.
5. **Dirty hosted block:** local edit based on an old hosted revision does not overwrite a newer hosted write; conflict status is visible.
6. **No git hot path:** all read/write sync tests pass with git export disabled.
7. **Git export recovery:** git export failure does not corrupt sync state and is reported separately.
8. **Latency budget:** timings separate MCP, storage, sync, network/provider, and git/export work.
9. **Surface parity plan:** Claude, ChatGPT/OpenAI, Codex, desktop, web, mobile, local-filesystem, and remote-only clients are covered in the test matrix.
10. **ERS path accounted for:** SharePoint/OneDrive behavior is either tested or explicitly deferred behind a named adapter with risks.

## Implementation Sequence

1. Add pure sync-domain types and tests: revisions, heads, hashes, conflicts, cursors.
2. Add an in-memory or SQLite `RevisionStore` test provider.
3. Add `LocalSyncAgent` one-shot push/pull tests against a temporary Markdown tree.
4. Prove local-to-hosted, hosted-to-local, and conflict-blocked tests without git.
5. Add latency instrumentation to the sync and hosted MCP paths.
6. Wire hosted HTTP tools to `RevisionStore` for read/update paths.
7. Add optional async git export after clean sync.
8. Run parity tests against the local stdio baseline.
9. Only then re-enable `brain-hosted` as a controlled test connector.
10. Promote hosted only after the full local-first contract passes.

## Open Questions

- What exact name should we give the dedicated private-org Supabase pilot project?
- What are the exact private Storage bucket names and retention policies for JEM sources?
- Should local sync run as a long-lived daemon, launchd service, MCP-adjacent subprocess, or manual one-shot command before daemonization?
- How should conflict resolution be exposed to remote-only mobile clients without encouraging blind overwrites?
- What is the exact latency target for sync propagation on JEM: seconds, low tens of seconds, or task-dependent?
- Should git export happen from the local agent, hosted hub, or both?
- What is the first ERS-specific sync adapter: OneDrive local agent root or direct SharePoint/Graph?
