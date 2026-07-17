# 009 - Brain Lint Apply Mode (hosted mechanical auto-fix)

**Status:** implemented 2026-07-01; partially superseded 2026-07-17 by spec 013 — orphan indexing and loader reviewed-date writes are removed, ordinary task fixes remain
**Source:** conversation request, 2026-07-01, after retiring the `brain-health-audit` routine ([claude-ops/LOG.md](../../../claude-ops/LOG.md) 2026-07-01 CLEANUP). The routine's mechanical auto-fixes had no hosted equivalent; this brings them into the server as canonical logic so no scheduled routine has to re-implement (and drift from) `src/services/lint.ts`.
**Roadmap link:** Brain quality hardening; "maintenance is automation-first" (`docs/ROADMAP.md`).
**Decisions impact:** Relaxes the cockpit/Monitor **read-only invariant** — requires a new `docs/DECISIONS.md` entry (see §6).
**Related:** `src/services/lint.ts`; `src/tools/lint.ts`; `src/services/active-brain-store.js` (`writeFile`); `src/services/request-context.ts` (`revisionActor`, `assertWriteRole`); `src/constants.ts` (`BLOAT_EXEMPT`); `docs/hosted-cockpit.md`.

> Current contract: spec 013 and the 2026-07-17 decision supersede fixes A and C below. `brain_lint({ fix: true })` may relocate/date-stamp/archive ordinary `TASKS.md` content only; it never modifies `00_loader.md` or `NOW.md`. The remainder of this document records the original 2026-07-01 design.

## Problem

The retired `brain-health-audit` routine performed four **mechanical** Brain fixes (unambiguous, non-fabricating, verifiable, docs-only). The hosted stack only *detects* — `brain_lint` returns a report; the cockpit/doctor only nudge. Nothing remediates. Retiring the routine to kill its drift risk (a prose re-implementation of `getStalenessThreshold`/bloat/orphan/drift logic) therefore also dropped the auto-fixes. This spec restores them as one canonical implementation on the server, invokable from a Claude session and from the Brain Monitor.

## Design in one paragraph

Add a `fix` flag to the existing **`brain_lint`** tool (not a second tool). When `fix:true`, after producing its report it applies four dumb, mechanical fixes and writes them through the normal `activeBrainStore().writeFile` path (attributed, revision-tracked, conflict-guarded). Dates are handled **stamp-forward**: each Done task gets a visible ` (done: YYYY-MM-DD)` tag the first time the tool sees it, and old ones are **moved to an append-only archive file**, never deleted. No git, no revision-history archaeology.

## Acceptance criteria

- `brain_lint` gains `fix?: boolean` (default `false`) and `dry_run?: boolean` (default `false`, meaningful only with `fix`). `fix:true` applies the four fixes; `dry_run:true` returns the planned changes without writing.
- Fixes write through `activeBrainStore().writeFile(..., old_content, revisionActor(ctx))` — never a side channel. The optimistic `old_content` guard makes a concurrent edit surface as a conflict, not an overwrite.
- Fix logic reuses `src/services/lint.ts`; no threshold or rule is duplicated.
- The four fixes: **A** index orphans into the loader, **B** archive stamped-old Done items, **C** bump the last-reviewed date (gated), **D** relocate completed tasks to Done (with a date stamp).
- No-op safety: when nothing matches, the tool writes nothing and logs nothing. A `LINT-FIX` log line is appended only when ≥1 fix lands.
- The Brain Monitor exposes one confirm-gated "Apply lint fixes" action that **delegates** to `brain_lint(fix:true)` (dry-run → confirm → apply); the Monitor never mutates Postgres/Storage/files itself.
- `docs/DECISIONS.md` records the read-only-invariant relaxation; `docs/hosted-cockpit.md` is updated in the same change.

## The four fixes

All four are pure functions of the current Markdown — no history lookup.

- **A. Orphan indexing.** For each file not referenced in `00_loader.md`, append `` - `file.md` — (description pending review) `` under the correct "All Files" heading (reuse `extractFileReferencesFromContent` + the loader-category rules). The `(description pending review)` marker is mandatory — never fabricate a description.
- **D. Completed-task relocation.** Move `- [x]` lines out of any non-Done section of `TASKS.md` into Done, verbatim, and stamp each moved line with today's date (see §5). Ignore `[x]` inside code spans/fences.
- **C. Last-reviewed date.** Bump the "Last reviewed" line in `00_loader.md` to today **only** when this run also landed A, B, or D — never a bare bump (preserves the green fast-path).
- **B. Done archiving (replaces "prune >30d").** Move Done items whose date stamp is more than 30 days old out of `TASKS.md` and **append** them to `archive/tasks-done.md`. This is a move, not a delete — archived tasks stay in the Brain, synced and searchable.

Semantic/judgment items (bloat splitting, staleness review, drift resolution, capture-queue triage) stay report-only. This flag never touches them.

## Dates: stamp-forward, no archaeology (§5)

The revision store has only file-level timestamps, so reconstructing when a single line entered Done would require walking old file versions. We reject that. Instead the date lives in the line:

- The first time the tool encounters a Done item with no stamp, it appends a visible ` (done: YYYY-MM-DD)` tag (today) to the end of the line, so a human reading TASKS.md sees the completion date directly. The tool parses this tag to compute age.
- Fix D stamps items with today's date as it moves them.
- Fix B archives any item whose stamp is >30 days old.

Consequence, by design: **first run stamps everything today and archives nothing** (all fresh); real archiving begins ~30 days later. Pre-existing undated items are simply treated as "done today" — we accept an approximate start point rather than fake precision. This is the deliberate "set the foundation going forward" call for a nascent Brain; it is stated in the `docs/DECISIONS.md` entry.

## Monitor write button — invariant relaxation (§6)

Today's rule (`CLAUDE.md`, `docs/hosted-cockpit.md`): the cockpit/Monitor "does not expose Brain writes, conflict resolution, hosted admin mutations, or public network binding."

**Narrow relaxation:** the Monitor gains exactly one write action — "Apply lint fixes" — that:
- calls `brain_lint(fix:true, dry_run:true)`, shows the planned diff, and requires an explicit operator confirm before the `dry_run:false` apply;
- **delegates** to the governed tool; the Monitor never writes Postgres/Storage/files, never resolves conflicts, never performs admin mutations;
- stays local-bound; no public surface added.

Everything else stays read-only. The DECISIONS entry states this scope precisely so the invariant is not read as fully lifted.

## Out of scope

- No new scheduled routine (a thin routine calling `brain_lint(fix:true)` is a possible later item — no re-implemented logic, so no drift).
- No semantic/judgment auto-fixes.
- No conflict resolution or admin mutation from the Monitor; no public binding; no new metrics store.
- No back-dating of existing Done items (explicitly accepted above).

## Technical constraints

- One rule implementation, imported from `src/services/lint.ts`.
- `archive/tasks-done.md` is append-only and added to `BLOAT_EXEMPT` (it is expected to grow) and to `00_loader.md` so it is not perpetually re-flagged as an orphan.
- Writes use the optimistic `old_content` guard.
- Never delete a task; archiving is a move.

## Test plan

- Unit, each fix as a pure transform over fixture Markdown: orphan-append; task relocation + stamp; date-bump gating; archive-move of a stamped-old item.
- Unit: stamp-forward — undated Done item gets today's stamp; a >30d stamp triggers archive; a <30d stamp does not.
- Unit: `fix:true` no-op path writes nothing and logs nothing; `dry_run:true` returns a plan and writes nothing.
- Integration: `fix:true` against a seeded revision-backed test Brain — assert an attributed `brain_file_revisions` row and a `LINT-FIX` log line only when a fix lands; assert archived content lands in `archive/tasks-done.md`.
- Cockpit e2e (optional, `npm run test:cockpit:e2e`): the "Apply lint fixes" control renders the dry-run diff and requires confirm.

## Verification

QA tier: **Full** (logic change that mutates Brain content). Gate: `npm test` and `npm run build`; `git diff --check` for doc edits. Writes are revision-tracked and reversible, and archiving is non-destructive, so this is not an irreversible Hard Gate; the Monitor confirm step is the operator guard. Update `docs/hosted-cockpit.md` and add the `docs/DECISIONS.md` entry in the same change.

## Rollout

1. ✅ `brain_lint` `fix`/`dry_run` flags + the four fixes + stamp-forward dating + archive file + tests (PR #38).
2. ✅ Brain Monitor confirm-gated `Controls → "Apply Lint Fixes..."` action delegating to `scripts/brain-lint-fix.mjs`; `docs/hosted-cockpit.md` updated.
3. ✅ `docs/DECISIONS.md` entry (invariant relaxation + stamp-forward/no-archaeology decision).
4. Optional later: a thin scheduled routine calling `brain_lint(fix:true)` for cadence.
