# Spec 011 — Review 2 (prior-art / best-practice lens, Fable 5, 2026-07-08)

Independent review of `docs/specs/011-brain-file-delete-rename.md` (v1 draft — same draft Review 1 saw). Judgments formed before reading Review 1; relation-to-R1 section written after. All external claims verified 2026-07-08 with citations.

## Per design-decision verdicts (spec v1 decisions 1–7)

| # | Decision | Verdict |
|---|---|---|
| 1 | Tombstone = append-only revision | **Idiomatic** — exactly CouchDB `_deleted` revisions (tombstone retained so deletes replicate and docs don't resurrect); Cassandra tombstones same rationale. Textbook shape for a per-file-head replicated store. |
| 2 | Rename = write-new + tombstone-old + pairing metadata | **Idiomatic** — git doesn't store renames at all (delete+add; similarity-detected at diff time); Syncthing transmits rename as delete+add with hash-based block reuse. Explicit pairing metadata is *stronger* than both. |
| 3 | Server-side wikilink rewrite on rename | **Acceptable, needs a collision rule** — Obsidian's link-updater runs in whichever process renames, so renamer-rewrites-links is the right division of labor; but duplicate basenames are a documented ambiguity source — naive `[[basename]]` regex can rewrite links to a *different* same-named file. Skip+warn on collision. |
| 4 | Soft-delete; "recoverability substitutes for confirmation" | **Half-contradicted** — soft-delete is universal (Obsidian `.trash`, OneDrive recycle bin, Dropbox Rewind) but prior art treats recoverability as a *complement to*, not substitute for, mass-delete confirmation (OneDrive interposes a review prompt even with a recycle bin). Single-file tool fine without confirm; the inference path is not. |
| 5 | Delete gets CAS → conflict | **Idiomatic** (CouchDB, Cassandra `gc_grace` design). |
| 6 | Protected files in tools only | **Incomplete** — the mature pattern (Syncthing `.stfolder`) goes further: a missing structural file means *folder unhealthy → stop*, not "propagate its absence." |
| 7 | Absence-inference for local deletes | **Contradicted as written; idiomatic once guarded** — absence-inference IS how every sync engine detects deletes, but none ships it bare. |

## Ranked findings

1. **[blocker] Absence-inference without folder-health marker + mass-delete threshold.** Syncthing `.stfolder` (missing marker → folder unhealthy → stop syncing); Unison `confirmbigdel` default-ON ("entire replica deleted" → confirm, and *abort* in batch mode — the daemon is batch mode); rsync `--max-delete`; OneDrive mass-delete review prompt despite recycle bin; Dropbox deletion notifications + Rewind. Cautionary: Syncthing has the marker but no threshold and users get burned by in-folder app-bug mass deletes (issue #9718, closed not-planned) — **marker alone insufficient, threshold alone insufficient; steal both.** Plus a two-consecutive-scan debounce for mid-move transients.
2. **[major] Delete tool ships to AI agents with no usable undelete.** Every system pairs delete with an easy restore surface. Spec defers `brain_undelete` while `brain_read_file` on a deleted head throws → v1 recovery is operator archaeology. A minimal `brain_restore_file` (new revision from last pre-tombstone content) should be v1.
3. **[major] Rename atomicity + receiver-side pairing.** One transaction around write-new+tombstone-old is the idiom. And the pull path should recognize the `renamed_from/to` pair and perform a local filesystem *move* instead of unlink+write — Obsidian then sees a rename, not delete+create (Syncthing's receive-side rename reconstruction).
4. **[minor] Basename-collision rule unspecified** (skip+warn; decide path-form links).
5. **[minor] Sync-inferred deletes must be as auditable as tool deletes** — LOG entries for inferred tombstones; mass events ride the existing Slack alerter (Dropbox/OneDrive both notify).
6. **[minor] Tombstone retention — say it out loud**: retain indefinitely; purge = existing break-glass; premature GC causes resurrection (Cassandra `gc_grace` framing).

## STEAL list
Syncthing `.stfolder` health marker (protected files double as marker) · Unison `confirmbigdel`/rsync `--max-delete` threshold-abort · OneDrive review-prompt → modeled as conflict-queue rows (MCP's only async confirm surface) · Dropbox Rewind as the shape for break-glass bulk restore · Obsidian `.trash` as optional extra explicit signal (non-default setting — cannot be the sole signal) · Syncthing receiver-side rename-as-move · CouchDB minimal `_deleted` tombstone · Cassandra retention framing.

## Simpler-alternative (explicit-signal-only v1): **NO.**
The motivating incidents (2026-06-27 duplicate paths; 2026-07-07 `ip_landscape.md`) were on-disk operations, not MCP calls — explicit-only leaves resurrection in place for exactly the paths that caused the P0. Obsidian `.trash` is non-default and can't be the sole human signal. No mature engine is explicit-only; guarded inference dominates on UX too (small deletes propagate; mass events hit the threshold and land in triage — same disaster-case outcome as explicit-only without losing the common case).

## Relation to Review 1
Blocker #1 **confirmed emphatically + refined** (marker = its "health sentinel," plus threshold + debounce as independent guards). Blocker #2 **confirmed + refined** — promote the protected files to *be* the health marker (one mechanism solves both). Major #3 **refined toward option B**: prior art does NOT keep resurrection (Syncthing propagates deletes and points at versioning/restore) — bring undelete into v1 instead. Major #4 confirmed (atomic txn + receiver-move). #7 collisions confirmed (Obsidian path-qualification is the reference). #9 recreate-over-tombstone confirmed (CouchDB treats write-on-deleted-leaf as normal recreate). #12 tombstone accumulation confirmed note-only.

## Overall
**Best-practice-defensible once amended.** Storage half is squarely the CouchDB/git/Syncthing idiom; nothing over-built. The single real deviation is shipping absence-inference without the two guards every serious system carries. Amend with guards, undelete-in-v1, atomic rename + receiver-move, collision rule, inferred-delete logging, retention statement → a design a mature team would ship for a 5–20-user knowledge base.

Sources: Syncthing FAQ + config + issue #9718 · Unison manual (`confirmbigdel`) · CouchDB document API · Cassandra tombstones · OneDrive restore + mass-delete prompt · Dropbox Rewind · git diffcore-rename · Obsidian manage-notes + duplicate-basename forum thread. (URLs in the review transcript; verified 2026-07-08.)
