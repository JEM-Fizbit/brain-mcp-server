# 008 - Brain Routing Evals Baseline

**Status:** implemented — rebuilt for spec 013 Phase 1 on 2026-07-17
**Source:** conversation request, 2026-06-27, to add evals for Brain MCP behavior, Brain loaders, and routing instructions
**Roadmap link:** ad-hoc Brain quality hardening
**Decisions impact:** none yet
**Related:** `evals/brain-routing/golden.json`; `evals/brain-routing/evaluator.mjs`; `scripts/eval-brain-routing.mjs`; `test/brain-routing-*.test.mjs`

## Problem

Conventional unit tests prove server mechanics, but they do not catch regressions in how agents are signposted through Brain loaders, cross-Brain authority rules, source escalation, or personal-vs-secret storage policy. Recent failures around personal non-secret identifiers and cross-session retrieval showed that routing behavior needs a repeatable baseline.

## Acceptance criteria

- A deterministic golden set covers diverse Brain behavior surfaces, not only one academic-credential edge case.
- The golden set checks routing, signposts, registry authority metadata, search tolerance, fallback disclosure, and secret-storage refusal markers.
- The runner is read-only and supports frozen fixture bundles or explicit local Markdown roots plus registry metadata.
- Search assertions execute the production deterministic ranking code rather than a separate fuzzy matcher.
- Policy-marker assertions are reported separately from retargetable signpost assertions.
- The result records per-Brain bootstrap bytes/estimated tokens, route-file success, follow-up reads, search mechanisms, and evaluator latency.
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

The evaluator intentionally checks durable routing evidence rather than exact natural-language answers. Production search ranking is imported from `dist/search-ranking.js`. `evals/brain-routing/fixtures/server-foundation.json` freezes a non-sensitive two-Brain regression bundle; explicit local roots remain the read-only fat-bootstrap baseline lane.

## Out of scope

- No hosted MCP calls in this slice.
- No model-in-the-loop scoring in this slice.
- No Brain writes or Brain content mutation.
- No broad eval framework, dashboard, trace store, or scorecard service.
- No hardcoded claim that JEM and ERS are the only possible Brain pair. They are the pilot fixtures for this baseline.

## Technical constraints

- The Brain MCP remains content-agnostic; routing rules live in Brain loaders and registry metadata.
- The runner accepts explicit Brain roots so future tenants or snapshot directories can reuse the same evaluator shape.
- Search matching is the same deterministic exact/normalised/compact/token ranking implementation used by the server.
- Golden assertions should test the intended signpost or route, not accidental phrase choices inside individual Brain files.

## Test plan

- `test/brain-routing-eval.test.mjs` verifies evaluator behavior with small fixtures.
- `test/brain-routing-golden.test.mjs` verifies coverage shape and read-only command wiring.
- `test/search-ranking.test.mjs` verifies the shared production ranking/scoping path.
- The live baseline command runs the golden set against local JEM and ERS Brain roots.

## Next slices

- Add a hosted read-only mode that loads files through the Brain MCP instead of local Markdown paths.
- Add a small model-in-loop eval that asks real agent questions and checks trace/tool behavior against the same expected routes.
- Add regression cases when real incidents reveal missing categories.
- Decide whether weekly drift checks belong in CI, hosted doctor, cockpit, or a separate operator workflow.

## Data files touched

- `evals/brain-routing/golden.json`
- `evals/brain-routing/fixtures/server-foundation.json`
- `evals/brain-routing/baselines/2026-07-17-fat-bootstrap.json`

## Verification commands

- `node --test test/brain-routing-eval.test.mjs test/brain-routing-golden.test.mjs`
- `npm run eval:brain:routing -- --fixtures evals/brain-routing/fixtures/server-foundation.json`
- `npm run eval:brain:routing -- --jem-dir "/Users/johnemilad/Projects/ai-brain-jem/brain" --ers-dir "/Users/johnemilad/Library/CloudStorage/OneDrive-SharedLibraries-ERSGenomics/Systems & IT - Documents/01_ers-brain/brain"`
- `npm test`

## Assumptions

- Deterministic routing evidence is the right first baseline because it is cheap, repeatable, and debuggable.
- Model-in-loop evals are still needed later because static Markdown checks cannot prove that a live client will choose the right tool sequence.
