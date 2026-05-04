# Specs

Work-unit briefs drafted on promotion from [`BACKLOG.md`](../../BACKLOG.md) (or, optionally, from a strategic roadmap row or an audit doc — see project `CLAUDE.md`). One spec per file, sequentially numbered (`001-slug.md`, `002-slug.md`, …).

Specs are **work units**. They differ from design/strategy docs (the WHAT/WHY) by describing the **HOW** of a piece of work.

## Lifecycle

`draft → approved → in-progress → done`

On ship (all in the same PR — the only multi-source coordination the system requires):

1. Move this file to [`archive/`](archive/). Set `Status: done` and append `Shipped: YYYY-MM-DD, commit <short-hash>`. The archived spec is the durable record.
2. Flip the source's status:
   - `BACKLOG.md` line → **delete it.** No "Shipped" section. The archive carries the history.
   - Strategic roadmap row (if used) → ⬜ → ✅, add a brief shipped note.
   - Audit doc item (if used) → ⬜ → ✅. If the audit's items are now all ✅, mark the doc `Status: Resolved <date>` at the top and `git mv` it to the project's audit-archive directory.

Authoritative reference: [ai-knowledge/protocols/ROADMAP_AND_BACKLOG.md](https://github.com/JEM-Fizbit/ai-knowledge/blob/main/protocols/ROADMAP_AND_BACKLOG.md) → "Lifecycle (on ship)". Project-specific verification commands live in the project's `CLAUDE.md`.

## Standard template

Use this for features, system additions, or any non-bug work.

~~~markdown
# NNN — <Title>

**Status:** draft
**Source:** BACKLOG.md line "<original one-liner>"  (or roadmap row "X.Y", or audit doc "<NAME> §N")
**Roadmap link:** Phase N, item N.M (or "ad-hoc")
**Decisions impact:** none (or "locks decision <X> in <project decision log>")
**Related:** <issue / PR links if any>

## Problem
<Expanded from the one-liner. Direct, no fluff.>

## Acceptance criteria
- <testable bullet>
- <testable bullet>

## Out of scope
- <adjacent things deliberately not touched>

## Technical constraints
<Found by reading code: load-bearing patterns, types, dependencies, gotchas.>

## Test plan
<How we verify. Cite test file paths if known.>

## Data files touched
<List config/data files if data changes; otherwise "none". Project-specific — see CLAUDE.md.>

## Verification commands
<Project-specific. See CLAUDE.md "Verification commands" for the canonical list.>

## Assumptions
<Inferences Claude made; flagged for the user to correct before "approved".>
~~~

## Bug shortcut template

Lighter form for bug reports. Use when "Problem / Acceptance / Out of scope / Technical constraints" is overkill for a small bug.

~~~markdown
# NNN — <Bug title>

**Status:** draft
**Type:** bug
**Source:** BACKLOG.md line "<original one-liner>"
**Roadmap link:** ad-hoc (or roadmap row if surfaced from one)

## Repro
<Steps to reproduce.>

## Expected
<What should happen.>

## Actual
<What happens.>

## Root cause hypothesis
<Best guess, found by reading code.>

## Fix approach
<What to change and where. Mention files.>

## Regression test
<Path: `tests/...`. Bug must be unreachable after the fix.>

## Verification
<Project-specific. See CLAUDE.md.>
~~~
