# 014 — Task-Context Compiler

**Status:** draft — deferred, trigger-gated successor stub; no implementation authority
**Source:** split from spec 013 after Fable 5 review 1
**Roadmap link:** conditional successor to Milestone 2 (multi-Brain routing)
**Decisions impact:** none until activation; the 2026-07-17 decision defaults to no compiler
**Related:** [`013-brain-context-architecture.md`](013-brain-context-architecture.md); [review 1](reviews/013-review1-architecture.md); [`008-brain-routing-evals.md`](008-brain-routing-evals.md); [`../DECISIONS.md`](../DECISIONS.md)

## Purpose

Reserve the design boundary for an optional server-side compiler that could assemble a bounded, explainable task packet in one MCP call:

```typescript
brain_load_context({
  brain_id: "ers-brain",
  task: "Review the Nexus build-versus-adopt position",
  max_tokens: 4000
})
```

This is not approved work. Spec 013 first slims the bootstrap, formalises the shallow graph, improves search and instruments follow-up reads. This spec activates only if that cheaper architecture leaves a measured residual problem that a compiler can solve.

## Activation trigger

Do not promote this stub to `draft` or implement it until JEM has completed spec 013 and the rebuilt packet/routing evaluator has recorded a stable post-slim baseline.

At least one of these evidence paths must then pass:

1. **Follow-up-read gap:** representative evaluated or observed sessions still require at least two follow-up Brain reads at a material frequency. The activation proposal must define and obtain approval for the materiality threshold before scoring; it cannot select the threshold after seeing results.
2. **Harness-variance gap:** controlled evidence shows weaker client harnesses fail routing or policy delivery in a way that a server-assembled packet corrects, without creating an unacceptable latency, security or maintenance regression.

The activation record must identify the failed tasks, measured baseline, proposed margin and why ranked search plus parallel reads cannot close the gap more cheaply.

## Kill criterion

If the slim-content baseline meets the agreed one-call/follow-up-read target with policy markers at 100%, do not build the compiler. Record the no-build decision in `docs/DECISIONS.md` and archive this stub as rejected.

The compiler is also killed if:

- the activation case depends on an evaluator that does not use production search and frozen fixtures;
- a simpler route/search/content correction closes the measured gap;
- the projected compiled p95 exceeds the measured bootstrap-plus-parallel-reads wall time;
- task or query text would need to be persisted; or
- ERS isolation and load-test prerequisites cannot be met.

## Preconditions if triggered

Before an implementation plan may be approved:

1. Structured scored search is available through the shared `BrainStore` interface.
2. A batch multi-file read API exists.
3. The packet/routing evaluator separates policy-marker and signpost assertions.
4. JEM's slim baseline and failure set are frozen.
5. The implementation is a pure, store-agnostic compiler module.
6. The threat model covers prompt injection, permission-filter timing, cycles, path escape, cross-Brain references and SSRF.

## Required contract

If activated, the detailed spec must require:

- compatibility: calls with only `brain_id` retain spec 013 behaviour;
- stable-prefix plus variable-suffix output layout;
- deterministic routes before ranked search;
- permission filtering before ranking or metadata disclosure;
- a caller-supplied token budget with deterministic truncation;
- an inclusion manifest naming every included file and mechanism code;
- manifest entries for every budget exclusion, truncation, missing reference and inaccessible cross-Brain target;
- name-only internal link expansion;
- no dereference of L2 external/canonical pointers;
- no task text, query text or retrieved snippets in persisted telemetry; and
- bounded cycle and expansion handling.

## Acceptance criteria if triggered

The promoted spec must set values before implementation for:

1. one-call sufficiency improvement over the measured slim baseline, including the required margin;
2. policy-marker preservation at 100%;
3. maximum packet size and truncation behaviour;
4. compiled p95 no worse than bootstrap plus parallel reads under 20 concurrent callers;
5. zero permission-inaccessible filename, alias or snippet disclosure;
6. manifest completeness for inclusions and exclusions; and
7. rollback to the simple bootstrap path through a per-Brain compatibility mode.

## Out of scope while deferred

- adding `task` or `max_tokens` to `LoadContextSchema`;
- compiling or ranking task packets;
- semantic/vector retrieval;
- packet caching;
- Brain-content changes; and
- ERS rollout.

## Promotion procedure

1. Attach the post-slim evidence packet.
2. Record which activation trigger passed and which kill checks did not.
3. Replace this stub with a complete work-unit spec.
4. Obtain a fresh independent architecture/security review.
5. Record explicit approval in `docs/DECISIONS.md`.

Until all five occur, the default decision is **do not build**.

## Current JEM gate evidence — 2026-08-22

- The cheaper content correction has now been completed first: all 45 current
  JEM source companions have reviewed direct Brain links and reciprocal
  backlinks, with zero index-only, unlinked, broken, or non-clickable findings
  in the repository-wide audit.
- Live search spot checks show the intended split: document-title queries find
  the source companion and its linked synthesis, while concept queries find the
  synthesis directly. The source registry also exposes 46 structured reviewed
  relationships to clients.
- This does **not** satisfy either activation trigger. There is not yet a frozen,
  representative post-content session set showing a material two-or-more-read
  frequency, and there is no controlled weaker-harness failure corrected by a
  server packet.
- Therefore spec 014 remains deferred. The next eligible activation checkpoint
  is after real JEM usage or a frozen production-search evaluation establishes
  a post-content baseline against a materiality threshold approved before the
  results are scored. If the simpler content/search path meets that target, the
  kill criterion applies and the compiler should not be built.

## Verification

For this stub:

- `git diff --check`;
- verify relative links;
- confirm it appears in in-flight spec discovery; and
- confirm spec 013 contains no compiler implementation phase.
