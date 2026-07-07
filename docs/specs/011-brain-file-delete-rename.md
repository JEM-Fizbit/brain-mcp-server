# 011 - Brain file delete & rename (tombstone revisions + delete-aware sync)

**Status:** DRAFT — awaiting John's sign-off before code (per CLAUDE.md spec gate)
**Source:** Brain-platform review finding **A3-7** (`~/Projects/claude-ops/plans/brain-platform-review-2026-07/`), promoted to a **P0 pre-production blocker** 2026-07-07. The hosted revision store has no concept of delete or rename: local deletions resurrect within ~5s, and renames/moves leave a duplicate stale head served to hosted clients. Recurred ≥3× (2026-06-27 duplicate-brain-paths incident requiring the offline reconcile script; 2026-07-07 `ip_landscape.md` move during the A5 batch, neutralized with a redirect tombstone = registry action A11).
**Roadmap link:** platform-review roadmap P0; unblocks team content curation (delete/rename impossible today), A11, and lifts the interim "no renames/deletes in the Brain" rule.
**Decisions impact:** introduces tombstone revisions to the append-only store (schema migration) + delete-aware sync. Requires a `docs/DECISIONS.md` entry.
**Related:** `db/migrations/2026-06-14_001_hosted_brain_postgres.sql`; `src/sync/types.ts`; `src/sync/postgres-revision-store.ts`, `memory-revision-store.ts`, `file-revision-store.ts`; `src/sync/local-sync-agent.ts`; `src/services/{brain,revision-brain-store,brain-store}.ts`; `src/tools/update.ts`; `src/schemas/tools.ts`; `scripts/reconcile-duplicate-brain-paths-postgres.mjs`.

## Governing invariant

**Deletion removes the file from every human-readable surface (local filesystem, SharePoint/OneDrive, Obsidian graph). The tombstone exists only in the revision store — for history, attribution, and recovery. No tombstone artifact ever appears in the vault** (no `.tombstone` sidecar, no leftover stub). The Markdown files remain the canonical human surface; the DB is derived infrastructure that additionally remembers deletions.

## Design decisions (agreed with John 2026-07-07)

1. **Tombstone = an append-only revision, not a head flag.** A delete is a normal revision marked deleted; the head points at it; reads treat it as absent; history + actor + undelete are preserved.
2. **Rename = write-new + tombstone-old (one operation), NOT a first-class rename revision.** Linked via `renamed_from` / `renamed_to` metadata.
3. **Rename rewrites inbound wikilinks** across the brain (`[[old]]`→`[[new]]`, incl. alias and relative-path forms, and markdown links) — matching Obsidian-native rename, since the MCP path bypasses Obsidian's own link-fixer. *(Upgraded from the initial "thin" default at John's request 2026-07-07.)*
4. **Soft-delete, recoverable.** No hard purge in the normal tool (recoverability is what makes delete safe without an interactive confirm, which MCP can't do). Hard purge-from-history stays a separate break-glass op for secrets/PII only.
5. **Delete gets CAS.** Delete-vs-concurrent-edit → a `sync_conflict` for resolution, never silent loss.
6. **Protected files.** The delete/rename tools refuse to remove/rename the server's structural-contract files: `00_loader.md`, `NOW.md` (hardcoded in `constants.ts`).
7. **Scope v1:** hosted + local/stdio paths + delete-aware sync (both directions); fold in A11 (real-delete the `ip_landscape.md` stub) and demote `reconcile-duplicate-brain-paths-postgres.mjs` to break-glass. Defer: first-class rename revisions, a dedicated undelete tool, bulk cleanup of the 2026-06-27 residue (trivial once delete exists).

## Schema (migration `db/migrations/2026-07-07_001_brain_file_tombstones.sql`)

Additive, safe on the live personal Supabase; **must also be applied to the future ERS-owned project** (migration carries with the codebase).

- `brain.brain_file_revisions`: add `deleted boolean not null default false`; make `content` nullable (`content text` — enforce `content is not null` when `deleted=false` via a CHECK: `check (deleted or content is not null)`); a tombstone revision has `deleted=true`, `content=null`, `content_sha256` = a sentinel (e.g. sha of empty) or nullable. `origin` unchanged (a delete carries the normal `local_agent`/`hosted_mcp` origin + actor — deletion is attributable like any write).
- `brain.brain_files`: no new column required — a file is "deleted" iff its `current_revision_id` points at a `deleted=true` revision. (Optionally add `current_deleted boolean` denormalized for cheap filtering; decide in build.)
- Rename metadata: store `renamed_from` / `renamed_to` in the revision `metadata jsonb` (already exists) — no column.

## RevisionStore interface (`src/sync/types.ts`)

- `FileHead` gains `deleted?: boolean`.
- New: `proposeDeletion(input: { brainId, filename, baseRevisionId, origin, actor }): Promise<RevisionProposalResult>` — same CAS contract as `proposeRevision` (stale base → conflict), writes a tombstone revision, repoints head. `unchanged` if already deleted.
- `listFiles` gains a `{ includeDeleted?: boolean }` option (default **false** for the read/tool layer; the sync agent calls with `true` to see tombstones). `readFile` on a deleted head throws a typed `FileDeletedError` (so `brain_read_file` can report "deleted" cleanly, and undelete can still fetch prior content via revision history).
- Implement across all three backends: `postgres-revision-store.ts` (real), `memory-revision-store.ts` (substrate of `file-revision-store.ts`), so the default test suite exercises deletion on the memory/file path.

## Read/tool layer (deleted heads are invisible)

- `brain_list_files`, `brain_search`, `brain_load_context` filter out `deleted` heads (call `listFiles({includeDeleted:false})`; search/read skip tombstones).
- `brain_read_file` on a deleted file → clean "file was deleted (revision X, by actor, at time); use restore to recover" message, not a crash.

## New tools (`src/tools/update.ts`, `src/schemas/tools.ts`)

- **`brain_delete_file`** (`brain_id`, `filename`): `assertWriteRole`; protected-file guard; `proposeDeletion` against current head (CAS); **returns the inbound-link count** ("N files link to this — links will dangle") as an advisory in the result; writes a `LOG.md` entry (human-visible audit even for Obsidian-only users). Soft/recoverable.
- **`brain_rename_file`** (`brain_id`, `from`, `to`): `assertWriteRole`; protected-file guard on `from`; validate `to` (filename rules, not already a live file). Operation order: (1) read `from` content; (2) `proposeRevision` `to` with `renamed_from` metadata; (3) `proposeDeletion` `from` with `renamed_to` metadata; (4) **rewrite inbound wikilinks** brain-wide (`[[from]]`, `[[from|alias]]`, `[[relpath/from]]`, and markdown `](from)` forms → `to`), each as a normal revision on the linking file. Partial-failure handling: if step 2/3 conflict, abort before link rewrites and report; link-rewrite failures are reported per-file, non-fatal (lint's `dead-wikilink` rule is the backstop).

## Delete-aware sync (`src/sync/local-sync-agent.ts`) — the behavioral flip

Today: **push** only visits files that exist locally (a deleted file is never seen → no propagation); **pull** *resurrects* a missing-but-tracked local file (lines 290-316). Both change.

- **Sync cycle order becomes push-then-pull** (so a local delete is propagated as a tombstone before pull can act).
- **Push — propagate local deletes:** after scanning, diff `state.files` (tracked) against the scanned set. A tracked filename absent from the scan = an intentional local delete → `proposeDeletion(baseRevisionId = tracked.revisionId)`. Stale base → conflict (delete-vs-remote-edit). On accept, drop from `state.files`. **This replaces the pull-side resurrection** — a missing tracked file now means "deleted," and the tombstone is recoverable, so accidental disappearance (damage) is not silently lost forever.
- **Pull — apply remote tombstones:** `listFiles({includeDeleted:true})`. For a head with `deleted=true`: if the local file is absent → already consistent (drop from state). If present and clean (`localHash === tracked.contentHash`) → **unlink the local file** + drop from state (this is the delete arriving from another surface). If present and dirty (locally edited since) → **conflict** (remote-delete-vs-local-edit), never auto-delete.
- Remove/replace the old "restore missing tracked file on pull" branch (it is the resurrection bug). Missing-locally is now owned by the push path.

## Obsidian / human-readable behavior (documented, per John's Q)

- **Deleted file:** gone from the folder + Obsidian graph; no artifact left behind.
- **Dangling backlinks after delete:** inbound `[[links]]` go red / become broken graph edges — inherent to any deletion. Mitigations: the delete tool warns with the inbound-link count; the `dead-wikilink` lint rule (platform-review D4) flags them.
- **Rename:** old node → new node; inbound wikilinks **are rewritten** (decision 3) so the graph stays intact — parity with Obsidian-native rename. A human renaming *inside* Obsidian is already fine (Obsidian fixes links on disk; delete-propagation tombstones the old path instead of resurrecting).
- **History/recovery is DB-side:** a deleted file's who/when/undo lives in the revision store + the `LOG.md` entry, not the vault. Undelete is an MCP/operator action (v1: restore by writing a new revision from history; dedicated tool deferred).

## A11 + reconcile-script demotion (folded in)

- Once `brain_delete_file` exists, A11 = call it on the `ip_landscape.md` stub (its first real use) → the tombstone-redirect stub is removed cleanly from both surfaces.
- `scripts/reconcile-duplicate-brain-paths-postgres.mjs` → documented as **break-glass only**; the tool is the normal path. The 2026-06-27 residue (ERS state 115-vs-41) can be cleaned via the new delete once shipped.

## Testing (default `npm test`, memory/file backend)

- Tombstone round-trip: delete → head reports deleted → `listFiles` (default) omits it → `readFile` throws `FileDeletedError` → `listFiles({includeDeleted:true})` shows it.
- CAS: delete against stale base → conflict; concurrent delete-vs-edit → conflict.
- Sync: local delete → push tombstone → (second agent) pull → local unlink; remote-delete-vs-local-edit → conflict, no unlink; **regression: a locally-deleted file is NOT resurrected** (the A3-7 bug, pinned).
- Rename: content moves; `renamed_from/to` metadata set; **inbound `[[old]]`→`[[new]]` rewritten** across fixtures; protected-file rename refused.
- Protected-file delete refused; `assertWriteRole` denies a reader.
- Postgres-backed equivalents behind `BRAIN_POSTGRES_TEST_DATABASE_URL` (env-gated).

## Verification (cite per CLAUDE.md)

- `npm run build` — TypeScript compile.
- `npm test` — build + node test runner (all new tests; default memory/file path).
- `BRAIN_POSTGRES_TEST_DATABASE_URL=… npm test` — the Postgres tombstone/CAS path.
- Migration applied to the live project via the documented migration flow (hosted/Postgres-mutating — **Hard Gate**, operator-run, not routine verification).
- QA tier: **Full** + Hard Gate on the migration and the first live delete (data-integrity + irreversible-adjacent, though soft-delete keeps it recoverable).

## Rollout

1. Migration (additive) → live personal project.
2. Ship tools + sync changes; deploy to Fly; smoke a delete + rename round-trip on a throwaway test file (hosted + local).
3. Execute A11 (delete the `ip_landscape.md` stub).
4. Lift the interim no-rename/delete rule in ERS + JEM `AGENTS.md`.
5. Carry the migration into the ERS-owned project at infra migration.

## Non-goals (v1)

First-class rename revisions; a dedicated `brain_undelete` tool (restore-from-history is available via revision read + write); hard purge-from-history; bulk auto-cleanup of pre-existing duplicates (do via the new delete); `sources/`-archive/binary-artifact deletion (separate concern).
