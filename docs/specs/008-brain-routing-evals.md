# 008 - Brain Routing Evals Baseline

**Status:** in-progress
**Source:** conversation request, 2026-06-27, to add evals for Brain MCP behavior, Brain loaders, and routing instructions
**Roadmap link:** ad-hoc Brain quality hardening
**Decisions impact:** none yet
**Related:** `evals/brain-routing/golden.json`; `evals/brain-routing/evaluator.mjs`; `scripts/eval-brain-routing.mjs`; `test/brain-routing-*.test.mjs`

## Problem

Conventional unit tests prove server mechanics, but they do not catch regressions in how agents are signposted through Brain loaders, cross-Brain authority rules, source escalation, or personal-vs-secret storage policy. Recent failures around personal non-secret identifiers and cross-session retrieval showed that routing behavior needs a repeatable baseline.

## Acceptance criteria

- A deterministic golden set covers diverse Brain behavior surfaces, not only one academic-credential edge case.
- The golden set checks routing, signposts, registry authority metadata, search tolerance, fallback disclosure, and secret-storage refusal markers.
- The runner is read-only and uses local Markdown snapshots plus registry metadata.
- The runner exits non-zero on failure so it can become a CI or pre-merge gate.
- The baseline command passes against the current JEM and ERS local Brain roots.

## Current baseline

`evals/brain-routing/golden.json` starts with 27 cases across these behavior surfaces:

- personal contact lookup;
- private personal details;
- stable account identifiers versus forbidden secrets;
- cross-Brain authority and fallback disclosure;
- ERS work contact and template lookup;
- source archive escalation;
- task routing;
- project and working-artifact routing;
- writing voice, career, investor, and opportunity context routing.

The evaluator intentionally checks durable routing evidence rather than exact natural-language answers. This keeps the baseline lean and resistant to wording churn while still catching broken signposts.

## Out of scope

- No hosted MCP calls in this slice.
- No model-in-the-loop scoring in this slice.
- No Brain writes or Brain content mutation.
- No broad eval framework, dashboard, trace store, or scorecard service.
- No hardcoded claim that JEM and ERS are the only possible Brain pair. They are the pilot fixtures for this baseline.

## Technical constraints

- The Brain MCP remains content-agnostic; routing rules live in Brain loaders and registry metadata.
- The runner accepts explicit Brain roots so future tenants or snapshot directories can reuse the same evaluator shape.
- Search matching is deliberately lightweight: normalization handles punctuation, spacing, camel case, compact forms, and meaningful-token fallback.
- Golden assertions should test the intended signpost or route, not accidental phrase choices inside individual Brain files.

## Test plan

- `test/brain-routing-eval.test.mjs` verifies evaluator behavior with small fixtures.
- `test/brain-routing-golden.test.mjs` verifies coverage shape and read-only command wiring.
- The live baseline command runs the golden set against local JEM and ERS Brain roots.

## Next slices

- Add a hosted read-only mode that loads files through the Brain MCP instead of local Markdown paths.
- Add a small model-in-loop eval that asks real agent questions and checks trace/tool behavior against the same expected routes.
- Add regression cases when real incidents reveal missing categories.
- Decide whether weekly drift checks belong in CI, hosted doctor, cockpit, or a separate operator workflow.

## Data files touched

- `evals/brain-routing/golden.json`

## Verification commands

- `node --test test/brain-routing-eval.test.mjs test/brain-routing-golden.test.mjs`
- `npm run eval:brain:routing -- --jem-dir "/Users/johnemilad/Projects/ai-brain-jem/brain" --ers-dir "/Users/johnemilad/Library/CloudStorage/OneDrive-SharedLibraries-ERSGenomics/Systems & IT - Documents/01_ers-brain/brain"`
- `npm test`

## Assumptions

- Deterministic routing evidence is the right first baseline because it is cheap, repeatable, and debuggable.
- Model-in-loop evals are still needed later because static Markdown checks cannot prove that a live client will choose the right tool sequence.
