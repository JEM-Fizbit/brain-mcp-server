# 011 - Brain file delete & rename (tombstone revisions + guarded delete-aware sync)

**Status:** DRAFT **v2** (2026-07-08) — revised against two adversarial reviews; awaiting John's sign-off before code (per CLAUDE.md spec gate).
**Reviews:** `reviews/011-review1-correctness.md` (Opus 4.8, against-the-code — 2 blockers, 5 majors, all accepted) · `reviews/011-review2-prior-art.md` (Fable 5, prior-art — storage half idiomatic; guarded-inference mandated; explicit-only alternative rejected with evidence). v1's sync design contained a mass-data-loss hole (empty/unmounted scan → tombstone the whole Brain); v2's guard set is the fix, stolen from Syncthing/Unison/rsync/OneDrive practice.
**Source:** platform finding **A3-7**, promoted P0 2026-07-07: the hosted revision store has no delete/rename concept — local deletions resurrect within ~5s; renames leave duplicate stale heads. Recurred ≥3× (2026-06-27 incident; 2026-07-07 `ip_landscape.md` move = registry action A11).
**Roadmap link:** platform-review roadmap P0; unblocks team curation, A11, and lifts the interim "no renames/deletes" rule.
**Decisions impact:** tombstone revisions (schema migration), guarded delete-aware sync, atomic rename. Requires a `docs/DECISIONS.md` entry on ship.
**Related:** `db/migrations/2026-06-14_001…sql`; `src/sync/{types,local-sync-agent,cli,postgres-revision-store,memory-revision-store,file-revision-store}.ts`; `src/services/{brain,revision-brain-store,brain-store,active-brain-store}.ts`; `src/tools/update.ts`; `src/schemas/tools.ts`; `docs/conflict-resolution.md` (must be updated — see Rollout); `scripts/reconcile-duplicate-brain-paths-postgres.mjs`.

## Governing invariants

1. **Deletion removes the file from every human-readable surface** (filesystem, SharePoint/OneDrive, Obsidian graph). The tombstone exists only in the revision store — history, attribution, recovery. No tombstone artifact in the vault.
2. **Absence-inference never runs unguarded.** A file missing from a local scan is a *candidate* delete only when the folder is provably healthy, the disappearance is small, and it persists across scans. Bulk disappearance is damage, not intent — zero tombstones, alert, triage. (Prior art: Syncthing `.stfolder`, Unison `confirmbigdel`, rsync `--max-delete`, OneDrive mass-delete review.)
3. **Delete ships with restore.** Recoverability is real only if an agent/operator can exercise it — `brain_restore_file` is v1 scope, not deferred.

## Design decisions (v2 — changes from v1 marked Δ)

1. Tombstone = append-only revision (`deleted=true`, `content=null`); head points at it. *(R2: textbook CouchDB `_deleted` shape.)*
2. Rename = write-new + tombstone-old with `renamed_from`/`renamed_to` metadata — **Δ executed in ONE store transaction** (atomic rename primitive; R1 #4: two txns can reproduce the duplicate-head bug on mid-rename conflict).
3. Rename rewrites inbound wikilinks — **Δ with the corrected link model**: extensionless-basename mapping (`foo.md` ↔ `[[foo]]`), escaped-pipe aliases in tables (`[[foo\|Alias]]`), plain aliases (`[[foo|Alias]]`), relpath forms, markdown `](path)` links; **collision rule = skip + warn** when the basename is non-unique (R1 #7, R2: Obsidian path-qualification is the reference). Link-rewrite failures are **first-class reported outcomes** — the v1 spec's "dead-wikilink lint backstop" does not exist in code (R1 #6) and is NOT relied on; D4 remains a separate roadmap item.
4. Soft-delete, recoverable — **Δ plus `brain_restore_file` in v1** (R1 #3 + R2 #2: every mature system pairs delete with an easy restore; recoverability complements, never substitutes for, the mass-delete guards).
5. Delete gets CAS: stale base → conflict; delete-vs-edit and edit-vs-delete both conflict, never silent.
6. Protected files (`00_loader.md`, `NOW.md`, from `constants.ts:22-23`) — **Δ enforced in BOTH the tools and the sync path, and promoted to the folder-health marker** (R1 #2 + R2: one mechanism solves both — their absence means "folder unhealthy," never "delete them").
7. **Δ Guarded inference** (replaces v1's bare absence-inference; explicit-signal-only alternative evaluated and rejected — the motivating incidents were on-disk ops, not MCP calls; R2 §4).

## Schema (migration `db/migrations/2026-07-08_001_brain_file_tombstones.sql`)

Additive; verified safe (R1): `add column deleted boolean not null default false` (metadata-only); `alter column content drop not null` + `check (deleted or content is not null)`; existing rows pass. **No RLS/grant change needed** (003 policies are `using(true)`; columns inherit table grants). `content_sha256` nullable for tombstones — **no sentinel sha** (R1 #5: sha256("") collides with deleting a legitimately-empty file via the short-circuit). Rename pairing in existing `metadata jsonb`. Optional denormalized `brain_files.current_deleted` — decide in build. Applies to the live personal project now (Hard Gate, operator-run) and carries to the ERS-owned project at migration.

## RevisionStore interface (`src/sync/types.ts`) — all three backends (postgres/memory/file)

- `FileHead.deleted?: boolean`.
- `proposeDeletion({brainId, filename, baseRevisionId, origin, actor})` — CAS as `proposeRevision`; **idempotency on `current.deleted`** (re-delete → `unchanged`), NOT sha equality (R1 #5).
- **Δ `proposeRename({brainId, from, to, baseRevisionId, origin, actor})`** — one transaction: create `to` revision (content of `from`, `renamed_from` metadata) + tombstone `from` (`renamed_to` metadata). Conflict on stale `from` base or live `to` head → whole txn aborts, nothing half-applied.
- `listFiles(brainId, {includeDeleted?: boolean})` — default **false**. **Δ enumerated callers** (R1 #11): tools/search/`warmActiveBrainStore` → false; sync agent → true; `brainExists` → **true** (an all-tombstoned brain still exists — its history does); `syncStatus`/CLI counts → report live + deleted counts separately.
- `readFile`/`getHead` on a deleted head → typed `FileDeletedError` (never build a head from null content — R1 #5 null-guards in `headFromRow`, `revisionFromRow`, memory `headOf`); `searchFiles` excludes deleted heads (`and not r.deleted`).
- **Δ Recreate-over-tombstone:** `proposeRevision` with `base=null` onto a `deleted` head = **accepted recreate** (CouchDB semantics), not a conflict (R1 #9).

## New tools (`src/tools/update.ts`, `src/schemas/tools.ts`)

- **`brain_delete_file`** (`brain_id`, `filename`): `assertWriteRole`; protected-file guard; CAS `proposeDeletion`; returns **inbound-link count** advisory ("N files link here — links will dangle"); writes a LOG.md entry. Soft, recoverable.
- **`brain_rename_file`** (`brain_id`, `from`, `to`): `assertWriteRole`; protected guard on `from`; validate `to` (filename rules; not a live head). Calls atomic `proposeRename`, then link rewrites (each a normal revision on the linking file; per-file failures reported in the result, non-fatal). LOG entry records the pair + rewrite outcomes.
- **Δ `brain_restore_file`** (`brain_id`, `filename`): restores the last pre-tombstone content as a new revision (accepted recreate); errors cleanly if the file isn't deleted. The "easy restore surface" prior art demands.

## Sync changes (`src/sync/local-sync-agent.ts`) — the guarded redesign

**Δ Correction (R1 #8):** the cycle is **already push-then-pull** (`local-sync-agent.ts:390-403`) — v1's "flip" claim was wrong; no reorder. The real changes:

**Push — guarded local-delete inference.** After the scan, tracked-but-absent files are delete *candidates*, propagated as tombstones ONLY if **all** guards pass:
1. **Folder-health marker** — scan must be non-empty AND contain both protected files (`00_loader.md`, `NOW.md`). Missing/unreadable root (`scanMarkdownFiles` must distinguish "dir unreadable" from "file absent" — today it swallows readdir errors, `:153`) or missing marker → **abort the cycle entirely**, log + alert, tombstone nothing. *(Kills R1 blocker #1's unmount case and blocker #2 in one mechanism.)*
2. **Mass-delete threshold** — candidates > `BRAIN_SYNC_MAX_DELETES` (default **5**) or > `BRAIN_SYNC_MAX_DELETE_PCT` (default **10%** of tracked) in one cycle → propagate **zero** tombstones; write conflict/triage rows + Slack alert (the async equivalent of OneDrive's review prompt). *(Kills the in-folder mass-wipe case Syncthing's marker misses — issue #9718.)*
3. **Two-scan debounce** — a candidate must be absent on **two consecutive scans** before tombstoning (rides out mid-move/cloud-sync transients at 5s cadence).
Surviving candidates → `proposeDeletion(base=tracked.revisionId)`; stale base → conflict (delete-vs-remote-edit). Accepted → drop from `state.files` + **LOG entry (inferred deletes are as auditable as tool deletes — R2 #5)**.

**Pull — apply remote tombstones + rename pairing.** `listFiles({includeDeleted:true})`:
- Tombstoned head, local absent → consistent; drop from state.
- Tombstoned head, local present + clean → **unlink** local file; drop from state.
- Tombstoned head, local present + dirty (edited since) → **conflict**, never auto-delete.
- **Δ Rename pairing (R2 #3):** a tombstone whose `renamed_to` pairs with a same-cycle new/changed head → apply as a local **move** (rename the file) instead of unlink+write — Obsidian and OneDrive see a rename, not delete+create.
- Protected files are never unlinked by pull (tombstoned protected head = alarm + conflict row, not deletion).

**Resurrection branch (`:290-317`) — removed, precisely** (R1 #10: ONLY that branch; the new-file write path `:358-382` is separate and preserved). Its two old jobs are re-covered: intentional deletes now propagate (this spec); genuine damage is caught by the guards (abort/threshold) and repaired via `brain_restore_file` — matching prior art, which propagates deletes and pairs them with easy restore rather than auto-resurrecting (R2 on R1 #3).

**Tombstone retention (R2 #6):** retained indefinitely; purge-from-history remains the break-glass op (secrets/PII only). Pull re-lists all heads per cycle so tombstones add O(deleted) work forever — accepted at this scale; compaction + the pre-existing `Number(ISO)=NaN` cursor bug are noted for the perf workstream (R1 #12), not this spec.

## Obsidian / human-readable behavior

Deleted file: gone from vault + graph; no artifact. Dangling inbound links after a *delete*: inherent; the delete tool warns with the count (lint backstop is future D4 — not claimed here). Rename: links rewritten (decision 3) and the pull side applies paired renames as moves, so both the graph and the OneDrive history see a rename. History/undo: `LOG.md` (human-visible) + revision store; restore via `brain_restore_file`. Obsidian-native renames/deletes on the local tree flow through the same guarded inference (a native rename appears as create+absence; the debounce + hash pairing keep it safe; worst case it propagates as delete+create — correct content, coarser history).

## A11 + reconcile-script demotion

First real delete = `brain_delete_file` on the `ip_landscape.md` redirect stub (A11). `reconcile-duplicate-brain-paths-postgres.mjs` → break-glass only. The 2026-06-27 residue cleanup uses the new tool. If a **bulk** restore is ever needed, shape it like Dropbox Rewind (R2 steal list): point-in-time, whole-brain, reconstructed from revision history — a break-glass script, not a tool.

## Testing (default `npm test` on memory/file backends; postgres suite env-gated)

Everything from v1 (tombstone round-trip, CAS delete-vs-edit both directions, protected-file refusal, reader-denied, rename metadata + link rewrites incl. `\|` aliases and collision-skip, no-resurrection regression) **plus the guard matrix (the point of v2)**:
- Empty scan / unreadable root → cycle aborts, zero tombstones (pins R1 blocker #1).
- Marker file missing → abort; marker present but N>threshold absent → zero tombstones + triage rows.
- Debounce: absent-once → no tombstone; absent-twice → tombstone.
- Protected file absent → never tombstoned (pins R1 blocker #2); tombstoned protected head on pull → conflict, not unlink.
- Atomic rename: mid-rename conflict → nothing applied (no duplicate head).
- Recreate-over-tombstone → accepted, not conflict. `brain_restore_file` round-trip.
- Pull rename-pairing → local move (file identity preserved).
- Sync-inferred delete writes a LOG entry.

## Verification

`npm run build` · `npm test` · `BRAIN_POSTGRES_TEST_DATABASE_URL=… npm test` · migration via documented flow (**Hard Gate**, operator-run) · QA tier: **Full** + Hard Gate on the migration and first live delete.

## Rollout

1. Migration (additive) → live personal project (Hard Gate).
2. Ship store + tools + guarded sync; deploy; smoke delete/rename/restore round-trip on a throwaway file (hosted + local).
3. **Update `docs/conflict-resolution.md` + `docs/hosted-brain-recovery-and-git-export.md`** — the "Recovery Bias / resurrection" language changes meaning (R1 #3); same change, same commit.
4. Execute A11. 5. Lift the interim no-rename/delete rule in both Brains' AGENTS.md. 6. Migration carries to the ERS-owned project.

## Non-goals (v1)

First-class rename revisions · hard purge (break-glass only) · tombstone GC/compaction · the D4 `dead-wikilink` lint rule (separate roadmap item; link-rewrite failures are reported, not lint-dependent) · Obsidian `.trash` integration (optional future explicit-signal enhancement; non-default setting, can't be the sole signal) · `sources/`-archive/binary deletion · cursor fix (`Number(ISO)=NaN`) and pull-scan perf (perf workstream).
