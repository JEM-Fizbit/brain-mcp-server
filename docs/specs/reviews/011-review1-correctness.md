# Spec 011 — Review 1 (codebase-correctness lens, Opus 4.8, 2026-07-07)

Adversarial review of `docs/specs/011-brain-file-delete-rename.md` against the actual codebase. Read-only. All findings verified against code with file:line evidence. Reconciled by the author (JEM's Claude) — status noted per finding. **Reviewer 2 (prior-art/best-practice, Fable 5) runs on the same draft next; the spec is revised once against both.**

## Verdict: needs rework before build (not merely edits)
Schema + tool half sound. **Sync-flip half has a real, severe data-loss hole and must be redesigned before code.**

## Blockers (accepted)
1. **Empty/partial/unmounted BRAIN_DIR → push tombstones the ENTIRE Brain; CAS does not protect.** `scanMarkdownFiles` swallows readdir errors (`local-sync-agent.ts:153`); an empty scan (routine for OneDrive/Dropbox/SharePoint paths for seconds at boot) makes every tracked file read as "intentionally deleted." With resurrection removed, all get tombstoned + propagated + unlinked on every client. CAS matches (nothing changed remotely) so all deletions are *accepted*, not conflicted. **The killer.** Fix: bulk-disappearance guard + Brain-health sentinel; distinguish "dir unreadable/missing → abort cycle" from "dir present, file gone → candidate delete."
2. **Protected-file guard only in the tools, not the sync push path.** A locally-missing `00_loader.md`/`NOW.md` (or finding #1's transient unmount) tombstones them → breaks `brain_load_context` for all clients (`active-brain-store.ts:92-98`). Existing test `sync.test.mjs:139` relies on resurrection to keep `NOW.md` alive. Fix: protected set enforced in the sync path too (treat missing protected file as damage-to-restore).

## Majors (accepted)
3. **Removing resurrection regresses documented damage-recovery; "recoverable" overstated** — the branch self-heals genuinely-lost files too (`conflict-resolution.md` "Recovery Bias"), and undelete is deferred, so damage becomes operator-only recovery. Fix: keep a narrow damage-detection resurrection, OR bring `brain_undelete` into v1; update the recovery docs.
4. **Rename not atomic → reproduces the duplicate-head bug.** create-`to` then tombstone-`from` are two txns; if step 3 conflicts, both live. Fix: store-level atomic rename (one txn) or compensating tombstone of `to` on failure.
5. **Nullable/sentinel content breaks head/search/read across all 3 stores** — `headFromRow` line/byte counts, `searchFiles` split, memory `headOf` all assume non-null. Sentinel=sha256("") also collides with deleting a legitimately-empty file (short-circuit → `unchanged`). Fix: nullable + `deleted` flag as sole truth + null-guards + `proposeDeletion` idempotency on `current.deleted` (not sha); exclude deleted from `searchFiles` + default `listFiles`.
6. **The cited `dead-wikilink` lint backstop (D4) does not exist in code** — it's an unshipped platform-review finding. v1 has no backstop for dangling/partial-rename links. Fix: bring D4 into scope, or make link-rewrite failures a first-class reported outcome.
7. **Wikilink rewrite model wrong/incomplete** vs real link forms (empirically: `[[basename]]` no-`.md`; escaped `\|` alias in tables; relpath+alias; `INDEX.md` basename collisions). Fix: extensionless-basename mapping made explicit, handle `\|`, define collision behavior.

## Minors (accepted)
8. **"Flip to push-then-pull" is a no-op — it's already push-then-pull** (`local-sync-agent.ts:390-403`). Author rigor miss. Fix: correct the spec; real changes are resurrection-removal + delete-propagation.
9. **Re-create over a tombstone → spurious conflict** (base=null vs tombstone head). Fix: treat "current deleted, base null, new content" as accepted un-delete/recreate.
10. **"Remove the resurrection branch" risks over-removal** breaking the separate new-file write path (`:358-382` vs resurrection `:290-317`). Fix: specify exact removal target.
11. **`listFiles` default-exclude ripples** — `brainExists` (all-tombstoned brain reads as non-existent), `syncStatus`, CLI counts/cursor. Fix: enumerate every caller + intended `includeDeleted`.
12. **Tombstone accumulation** — pull re-lists all heads each cycle (+ pre-existing `Number(ISO)=NaN` cursor bug), so every tombstone is reprocessed forever. Perf, not correctness; note for v1, compact later.

## Verified correct (not invented)
- Protected constants exist (`constants.ts:22-23`); `AGENTS.md` is parent-level, not deletable via these paths.
- Migration is additive/safe; **no RLS/grant change needed** (migration 003 policies `using(true)`); resolves the spec's "decide in build" uncertainty.
- CAS-on-delete vs concurrent remote edit is sound.
