# 025 — Reconcile Lint: Cross-File Contradiction Candidates

**Status:** done (code on `main`); hosted JEM and ERS deployments pending a guarded deploy
**Shipped:** 2026-10-26 — see `git log -- src/services/reconcile.ts`
**Source:** `BACKLOG.md` line "Deferred proactive lint: assess `--stale` and `--reconcile` first…" (Karpathy gap 3, JEM `sources/analysis/2026-04-14_brain-architecture-review-karpathy.md`)
**Roadmap link:** ad-hoc — Brain maintenance quality
**Decisions impact:** locks [2026-10-26 — Reconcile lint is deterministic, advisory and detection-only](../../DECISIONS.md#2026-10-26--reconcile-lint-is-deterministic-advisory-and-detection-only)
**Related:** `src/services/reconcile.ts`; `src/services/lint.ts`; `test/reconcile.test.mjs`; [2026-08-23 freshness decision](../../DECISIONS.md#2026-08-23--make-freshness-semantic-and-lint-diagnostics-owned)

## Problem

Brains repeat load-bearing facts on purpose: a hub states the headline and a
detail file holds the evidence. When one copy is corrected and another is not,
the Brain contradicts itself, and an agent loading either copy repeats the
wrong one. Staleness lint (shipped 2026-08-23 through review dates and cadence)
catches pages nobody has reviewed; it cannot see two reviewed pages that
disagree. The April review called this `--reconcile` and ranked it first.

## Acceptance criteria

- `brain_lint` reports cross-file candidates where the same subject and metric
  carry incompatible values, with both file:line locations, the raw figures and
  bounded excerpts.
- Detection only: no Brain write, no fix plan, no auto-resolution; the agent or
  owner adjudicates with source evidence.
- Advisory: candidates are excluded from `countLintIssues`, so Cockpit
  readiness and existing thresholds do not change.
- Operational and historical files (LOG, JOURNAL, TASKS, SOURCES, README,
  BUSINESS_IDEAS, loader, NOW, operations guide, `archive/`, `working/`,
  `acceptance/`, `test/`, `inbox/`, dot-directories) are never compared.
- Identical on filesystem and revision-backed stores; no new dependency,
  service, API key or model call.
- Measured on the real corpora before shipping (below).

## Method

1. Extract quantified claims: money (with currency and scale), counts with a
   unit noun, percentages and multiples, with bounds (`+`/over = lower,
   up to = upper, `~`/approx = approximate). Dates, years, ranges and
   document-mechanics units (days, lines, tokens, pages…) are ignored.
2. Attribute each claim to a subject: the nearest preceding entity mention on
   the line (wikilink, entity name or link alias), else the heading's entity,
   else the entity file itself, else the Brain owner.
3. Describe what it measures from its own context only: its clause, narrowed
   away from neighbouring quantities at the first connector ("£9M Series A +
   £6M extension"); table cells use their column header, not sibling cells.
   Identifiers join into qualifiers (`series-a`, `fund-ii`).
4. Pair claims in different files with the same subject, kind and unit when
   they share a qualifier or at least two context terms, have no conflicting
   qualifier, the same measure class (valuation and revenue words separate
   metrics) and no disjoint periods (`2025` vs `Q1`).
5. Flag pairs whose values are incompatible after bounds and tolerance (0.5%
   exact, 10% approximate). Cap at 40, report the remainder.

## Measurement (2026-10-26)

| Corpus | Files | Claims | Candidates | Actionable |
|---|---|---|---|---|
| `ai-brain-jem` | 24 | 272 | 6 | 6 — NBGI Fund I €30M vs €40M (3 pairs); Quanta Series A £9M/£6M vs £2.5M/£1.1M (3 pairs) |
| `ers-brain` (read-only local mirror) | 35 | 320 | 1 | 0 — section of a deck vs a deck template (`board, deck`) |

Tuning removed, in order: sync-recovery copies; dates read as counts; entity
name words as evidence; neighbouring figures sharing a clause; sibling table
cells; Fund I vs Fund II; round size vs pre-money valuation; 2025 vs Q1.

## Out of scope

- Resolving candidates or writing to any Brain (adjudication stays with the
  agent and the owner, through the normal reviewed write path).
- `--impute`, `--connections` and `--questions`, which remain in `BACKLOG.md`.
- Same-file contradictions, prose claims without a number, dates and tenures.
- Counting candidates as findings or surfacing them in Cockpit, until the
  false-positive rate is measured across real runs.

## Known limits

- Table rows supply the subject but not the row label as metric context, so
  "Series A extension" in a row can be compared with a "Series A round".
- An unattributed figure in a hub falls back to the Brain owner, so figures
  about different subjects can pair when two context terms overlap.

## Verification

`npm test` (681 tests, 0 failures); `node --test test/reconcile.test.mjs`;
local `runLint` against `ai-brain-jem` produced the six candidates above.
