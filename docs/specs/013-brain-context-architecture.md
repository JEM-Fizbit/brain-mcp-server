# 013 — Brain Context Architecture

**Status:** draft — independent architecture review required before approval
**Source:** conversation request, 2026-07-17, after repeated root-loader bloat and a first-principles review of Brain retrieval architecture
**Roadmap link:** Milestone 2 (multi-Brain routing) and Milestone 4 (ERS multi-user access)
**Decisions impact:** would supersede the 2026-07-01 decision that lint may index orphans directly into `00_loader.md`; would refine, not reverse, the 2026-07-06 decision to retain the distinct JEM and ERS content schemas
**Related:** [`008-brain-routing-evals.md`](008-brain-routing-evals.md); [`009-brain-lint-apply-mode.md`](009-brain-lint-apply-mode.md); [`010-cockpit-fixes-tab.md`](010-cockpit-fixes-tab.md); [`../DECISIONS.md`](../DECISIONS.md); [`../OWNERSHIP_AND_LIFECYCLE.md`](../OWNERSHIP_AND_LIFECYCLE.md); `~/Projects/claude-ops/plans/brain-platform-review-2026-07/01_target-architecture-and-roadmap.md`

## Decision to be made

Choose the smallest Brain information and retrieval architecture that remains fast, accurate, explainable, maintainable and scalable across personal, shared-company and future departmental/work-personal Brains.

The current working recommendation is a **shallow content graph plus query-aware context compilation**:

1. Store knowledge through progressive disclosure.
2. Keep the normal retrieval path shallow: bootstrap → directly selected hub → canonical source.
3. Compile task-relevant context in one MCP round trip where practical, rather than forcing agents to walk every index manually.
4. Keep the server schema-agnostic: generic routing, graph, budget and permission mechanisms; Brain-specific knowledge remains in each Brain.

This is a proposal, not an approved decision. A Fable 5 independent review must challenge it before implementation.

## Why this work exists

The loader is currently overloaded as:

- the always-loaded Brain contract;
- a task-routing table;
- a complete file inventory; and
- the server's definition of whether content is discoverable.

That combination creates a structural growth loop:

1. A new file is created below an existing hub or index.
2. `brain_lint` checks whether the file is directly referenced by `00_loader.md`, rather than whether it is reachable through the Brain graph.
3. The file is reported as an orphan even when a lower-level index already links it.
4. `brain_lint({ fix: true })` proposes or performs a direct loader insertion.
5. Every future context load pays the token and attention cost of that new entry.

This is implemented in `src/services/lint.ts` (loader-direct orphan detection) and `src/services/lint-fix.ts` (orphan-to-loader insertion). It was deliberately specified in spec 009 and recorded in the 2026-07-01 decision log. The resulting bloat is therefore a platform-design defect, not primarily an agent-discipline problem.

Observed examples:

- The 2026-07-01 lint-apply run inserted orphan entries into the JEM loader.
- ERS template descriptors linked from `references/templates.md` are still reported as orphans because lint does not traverse the intermediate index.
- A project-specific Nexus route was added to the ERS loader even though `projects/README.md`, `projects/ai-transformation.md` and `projects/nexus-platform.md` already provided a valid hierarchy.

## Current baseline

There are two operational Brains:

- `ai-brain-jem` — personal, numerically prefixed and relatively flat;
- `ers-brain` — shared-company, foldered by domain.

Both are served by this codebase. The current John-only pilot exposes both through one hosted registry; the approved destination is two owner-scoped deployments of the same upstream codebase, with ERS consuming tagged releases through its private mirror.

Current mechanics relevant to this decision:

- `brain_load_context` accepts only `brain_id` and returns the complete `00_loader.md` plus complete `NOW.md`.
- The current fixed bootstrap is approximately 25.8 KB for ERS and 36.9 KB for JEM before task-specific files are read.
- Hosted Postgres Brains have keyword search but not a working semantic/vector retrieval path.
- The role model is `owner | admin | member | reader`; every non-reader currently has unrestricted file-write authority.
- `00_loader.md` and `NOW.md` are protected from deletion/rename, but not from ordinary update writes.
- Spec 008 has a 27-case deterministic routing baseline, but no live context-compilation or follow-up-read evaluation.

The July 2026 architecture review concluded that the distinct JEM and ERS schemas are fundamentally sound and do not warrant a wholesale restructuring. This proposal keeps that decision: optimise the shared retrieval and maintenance contract without forcing cosmetic schema uniformity.

## Architecture drivers

The decision should optimise the combined cost of:

1. **Fixed context tax** — material loaded on every relevant session.
2. **Round-trip latency** — sequential MCP reads needed before useful work begins.
3. **Retrieval effectiveness** — correct, sufficient and canonical context for the task.
4. **Attention quality** — irrelevant context can reduce model accuracy even when it fits within the context window.
5. **Explainability** — operators must be able to see why files were selected.
6. **Maintenance cost** — ordinary contributors should not need to understand root architecture.
7. **Scalability** — new projects, users and departmental Brains must not require server forks or loader growth.
8. **Access control** — inaccessible content and even sensitive metadata must not leak through routing or search.
9. **Portability** — Markdown remains the canonical, inspectable and exportable knowledge format.

## Alternatives to compare

### A. Flat comprehensive loader

List most tasks, projects and files directly in `00_loader.md`.

**Strength:** minimum first-hop ambiguity and no server-side routing intelligence.

**Weakness:** every addition imposes a permanent global token and attention cost; multi-user maintenance converges on bloat.

### B. Deep manual hierarchy

Keep the loader extremely small and require agents to traverse root index → domain index → programme hub → project hub → canonical source.

**Strength:** low fixed bootstrap and clear human organisation.

**Weakness:** multiple sequential tool calls; fragile when agents skip a layer; encourages indexes that add no synthesis.

### C. Search-first retrieval

Use keyword or semantic search as the normal entry point with minimal prescribed hierarchy.

**Strength:** shallow retrieval and low manual routing maintenance.

**Weakness:** weaker determinism, provenance and explainability; semantic search is not currently available on the hosted Postgres path.

### D. Shallow graph plus context compiler — current recommendation

Keep a small deterministic contract, directly retrievable hubs and canonical pointers. Use generic server-side routing, keyword search and graph expansion to assemble a bounded task packet in one call.

**Strength:** progressive storage without sequential turtles; explainable inclusion; shared mechanism across distinct Brain schemas.

**Weakness:** adds a retrieval subsystem and creates a new boundary between content-defined routes and server ranking logic.

The independent review may recommend another design or a staged combination.

## Proposed content architecture

### Level 0 — bootstrap

`00_loader.md` contains only:

- Brain identity, authority and canonicality rules;
- essential safety/access boundaries;
- six to ten stable top-level intent classes;
- instructions for task-aware retrieval and source escalation.

It does not contain:

- a complete file inventory;
- individual projects or people merely because they exist;
- temporary priorities;
- detailed output-specific routes that already belong in a domain index;
- maintenance history.

`NOW.md` is the dynamic hot set: current priorities, open decisions and direct links to actively relevant hubs. It should remain one-screen orientation, not a historical narrative or task repository.

Initial budget to validate rather than hard-code permanently:

- fixed bootstrap: approximately 1,500 tokens or less;
- `00_loader.md`: approximately 500–800 words;
- `NOW.md`: approximately 300–600 words.

### Level 1 — directly selected hub

A task normally selects one substantive hub: project, entity, governance, writing, commercial, technical-estate or reference hub.

A hub earns its existence only when it provides one or more of:

- substantive cross-document synthesis;
- distinct ownership or permissions;
- an independent lifecycle/update cadence;
- materially improved retrieval precision;
- a necessary size boundary.

An index that only forwards to another index is not a substantive hub and must not be a mandatory retrieval step.

### Level 2 — canonical source

The hub points to the live first-class home: project folder, policy corpus, register, CRM, repository, source document or other authoritative system.

That destination is outside the Brain hierarchy. It is not another Brain layer.

### Graph, not strict tree

Hubs may cross-link. Umbrella and project hubs can be siblings rather than mandatory parent/child traversal.

For example, a Nexus task should normally resolve:

```text
bootstrap → projects/nexus-platform.md → canonical Nexus project home
```

It should not require:

```text
bootstrap → projects/README → ai-transformation → nexus-platform
          → project README → working document
```

`projects/README.md` remains useful for human portfolio browsing and broad project discovery, but is not a compulsory machine retrieval hop.

## Proposed retrieval architecture

Extend `brain_load_context` compatibly:

```typescript
brain_load_context({
  brain_id: "ers-brain",
  task: "Review the Nexus build-versus-adopt position",
  max_tokens: 4000
})
```

When `task` is supplied, the server would:

1. load the compact Brain contract and current-state material;
2. resolve exact filenames, titles, aliases and deterministic intent routes;
3. run permission-filtered keyword search;
4. expand relevant links and canonical pointers;
5. rank and deduplicate candidates;
6. include complete small hubs or bounded relevant sections;
7. stop at the requested token budget; and
8. return an inclusion manifest naming each selected file and reason.

When `task` is omitted, existing callers receive the lean bootstrap. The first version must not depend on semantic/vector search. Semantic retrieval can be added later behind the same interface if production evaluations demonstrate value.

The server remains schema-agnostic. It understands generic Markdown headings, links, file metadata, aliases, hub relationships, roles and budgets; it contains no hardcoded JEM, ERS, Nexus or person-specific routes.

## Proposed maintenance and permission contract

### Reachability

Redefine an orphan as content that is unreachable through approved root routes, indexes, hubs or explicit metadata—not content absent from the root loader.

Lint should distinguish:

- genuinely unreachable content;
- broken links;
- content reachable only through an excessively deep route;
- missing canonical pointers;
- stale hubs;
- root-loader leakage;
- files exceeding context budgets.

### Auto-fix boundary

Remove orphan-to-loader insertion from `brain_lint({ fix: true })`.

Permitted automatic fixes may include deterministic link or nearest-index repairs when the target is unambiguous. Ambiguous classification becomes a review item. No automated fix modifies `00_loader.md`.

### Roles

- `reader` — read/search/load only.
- `member` — ordinary content and hub writes.
- `admin` / `owner` — structural files and routing-contract changes.

`00_loader.md` should require an admin/owner structural-write check. `NOW.md` remains curated operational content and does not require the same protection unless experience demonstrates a need.

Per-file ACLs are not required for this first implementation unless the ERS rollout introduces content that cannot be shared with all registered readers. The retrieval interface should nevertheless preserve a permission-filter-before-ranking seam so later ACLs do not require a redesign.

## Per-Brain migration

### JEM Brain

- Preserve numeric filenames as stable identifiers.
- Slim the root loader and remove the complete file inventory.
- Turn `05_projects.md` into a hub-of-hubs rather than a live state repository.
- Move current/historical narrative out of `NOW.md` as needed.
- Preserve direct identity, voice, career and mental-model routes where they materially improve task accuracy.
- Do not force ERS-style folders merely for uniformity.

### ERS Brain

- Preserve the existing domain-folder structure.
- Remove the loader's complete file inventory.
- Collapse detailed output-specific rows into stable domain routes where the output-pattern index already resolves them.
- Remove project-specific loader rows, including Nexus, once graph-aware discovery is proven.
- Keep `projects/nexus-platform.md` as the direct stable Nexus hub.
- Keep `projects/ai-transformation.md` as a sibling programme synthesis, not a mandatory parent route.
- Slim `NOW.md`, moving historical event detail to `JOURNAL.md`.

Do not backfill structured frontmatter across every existing file. Titles, headings, paths, links and index descriptions should drive the first implementation. Add optional typed metadata only to hubs where aliases, ownership, sensitivity or canonical location remain ambiguous.

## Implementation sequence

This work should ship as a separate release after the `v1.2.0` ERS deployment-fork baseline. Do not couple the information-architecture change to infrastructure migration or cutover.

### Phase 0 — independent review and decision

1. Run the Fable 5 xhigh review defined below.
2. Reconcile it against the July 2026 platform review and current server evidence.
3. Revise this spec.
4. Record the approved decision and superseded alternatives in `docs/DECISIONS.md`.
5. Obtain explicit approval before implementation.

### Phase 1 — tests and observability first

1. Extend routing fixtures to cover direct hubs, graph reachability and excessive-depth failures.
2. Add context-packet tests for inclusion reasons, permission filtering, token budgets and backward compatibility.
3. Add metrics for context bytes/tokens, selected files, routing reason, server latency and follow-up reads.
4. Record the current JEM and ERS baselines before changing content.

### Phase 2 — server changes behind compatibility boundaries

1. Add optional `task` and `max_tokens` to `LoadContextSchema`.
2. Implement deterministic + keyword + graph context compilation.
3. Replace loader-direct orphan detection with graph reachability.
4. Remove orphan-to-loader auto-fix.
5. Protect root-loader updates behind structural roles.
6. Expose diagnostic mode before changing the default client workflow.

### Phase 3 — one-Brain-at-a-time content migration

1. Migrate and evaluate JEM first.
2. Enable compiled loading for JEM and observe real use.
3. Migrate and evaluate ERS.
4. Keep old content snapshots/revision heads available for rollback.

### Phase 4 — release and rollout

1. Cut a new upstream minor release after all gates pass.
2. Deploy to the personal stack.
3. Adopt the same upstream tag through the ERS private mirror after the ERS baseline is stable.
4. Add the contract to future Brain scaffolding and onboarding guidance.

## Acceptance criteria

- A new project or hub does not require a loader edit.
- The Nexus query routes directly to `projects/nexus-platform.md` without a project-specific loader row.
- ERS template descriptors linked through `references/templates.md` are not reported as orphans.
- A genuinely unlinked content file is reported as unreachable.
- `brain_lint({ fix: true })` cannot modify `00_loader.md`.
- Members cannot modify `00_loader.md`; admins/owners can through an explicit structural path.
- Existing `brain_load_context({ brain_id })` callers continue to work.
- At least 90% of the agreed common-task golden set receives sufficient task context in one load call and no more than one follow-up Brain read.
- The fixed bootstrap and compiled packets remain within approved token budgets.
- Inclusion manifests explain every selected file.
- Permission filtering occurs before candidate ranking or metadata disclosure.
- Both JEM and ERS routing golden sets pass without imposing one Brain's filename/folder schema on the other.
- A feature flag or compatibility mode can restore the prior load behaviour during rollout.

## Failure modes to attack during review

- The compiler becomes an opaque RAG subsystem and agents cannot explain context selection.
- Keyword ranking misses important stable files that deterministic loader routes currently find.
- Generic path or title heuristics privilege one Brain schema.
- Link expansion creates context explosions or cycles.
- A malicious or compromised Brain file manipulates inclusion through links or instructions.
- Permission-inaccessible filenames, aliases or snippets leak during candidate ranking.
- Content writers create hubs that are technically reachable but semantically useless.
- Token budgets truncate the single load-bearing section a task needs.
- `NOW.md` becomes another unbounded loader by accumulating hot links and history.
- Simultaneous multi-user writes leave the graph/index in a transient inconsistent state.
- The maintenance system creates generated indexes or metadata that become a second source of truth.

## Rollback

- Keep `task` optional and preserve the simple bootstrap path.
- Gate compiled retrieval behind a runtime or per-Brain feature flag until production evidence is adequate.
- Make content slimming only after routing fixtures prove equivalent or better discovery.
- Use revision history to restore prior loader/NOW/hub content if a Brain migration reduces task success.
- Do not delete legacy routing tests until both Brains pass a sustained observation period.

## Independent review gate

Recommended reviewer setting: **Fable 5 · xhigh (Extra)**. Use ultracode only if the solo review finds unresolved competing architectures that need parallel investigation.

The reviewer must reconstruct the current architecture and choose among the alternatives independently. Do not frame the task as validating this proposal.

Required output:

- recommendation and confidence;
- strongest case against the recommendation;
- rejected alternatives and reconsideration triggers;
- precise boundary between content, registry and server responsibilities;
- normal and failure-path retrieval flows;
- minimal machine-readable contract, if any;
- security and multi-user implications;
- measurable acceptance criteria;
- migration, compatibility and rollback plan;
- explicit verdict: approve, revise or reject spec 013.

## Fable 5 kickoff prompt

```text
Use Fable 5 at xhigh effort. Perform an independent, read-only architecture review of the Brain context and retrieval design before implementation. Start with AGENTS.md and docs/specs/013-brain-context-architecture.md in /Users/johnemilad/Projects/brain-mcp-server, then inspect the current load/lint/write code, specs 008–010, both current Brain loaders/NOW files, and the July 2026 Brain platform architecture review linked from spec 013. Do not assume spec 013 is correct. Compare flat-loader, deep-hierarchy, search-first and shallow-graph/context-compiler approaches against latency, retrieval quality, explainability, maintenance, permissions and multi-user scale. Return a decision-grade recommendation with rejected alternatives, failure modes, measurable acceptance criteria, migration/rollback and an approve/revise/reject verdict. Do not edit files or implement anything.
```

## Verification commands

For this draft document:

- `git diff --check`
- verify every relative Markdown link resolves;
- confirm the file appears in the project's in-flight spec discovery.

For future implementation:

- focused unit tests for context compilation, graph reachability, role gates and budget enforcement;
- `npm run eval:brain:routing` against both current Brain roots;
- `npm test`;
- hosted read-only context evaluation against both Brain IDs;
- staged production observation before ERS rollout.

## Assumptions and proof gaps

- Initial token budgets are hypotheses to validate, not permanent constants.
- The target of 90% one-call task sufficiency requires a representative golden set and may need recalibration.
- Hosted semantic search is not required for the first implementation.
- ERS starts with broadly shared internal knowledge; per-file ACLs remain a later trigger unless rollout requirements change.
- No implementation authority is implied by this draft. Approval follows the independent review and spec revision.
