# 013 — Brain Context Architecture

**Status:** approved; server Phases 1–3 and the JEM/ERS content migrations are deployed through `v1.4.1` on 2026-07-17; both Brains are in advisory `graph_shadow` observation, while the private-mirror cutover and compiler decision remain pending
**Reviews:** [`reviews/013-review1-architecture.md`](reviews/013-review1-architecture.md) (Fable 5 ultracode, 2026-07-17; verdict **revise**, reconciled in this revision)
**Source:** conversation request, 2026-07-17, after repeated root-loader bloat and a first-principles review of Brain retrieval architecture
**Roadmap link:** Milestone 2 (multi-Brain routing) and Milestone 4 (ERS multi-user access)
**Decisions impact:** supersedes the 2026-07-01 decision that lint may index orphans or bump review dates directly in `00_loader.md`; preserves the 2026-07-06 decision to retain distinct JEM and ERS content schemas
**Related:** [`008-brain-routing-evals.md`](008-brain-routing-evals.md); [`009-brain-lint-apply-mode.md`](009-brain-lint-apply-mode.md); [`010-cockpit-fixes-tab.md`](010-cockpit-fixes-tab.md); [`014-task-context-compiler.md`](014-task-context-compiler.md); [review 1](reviews/013-review1-architecture.md); [`../prototype-brain-context-inventory.md`](../prototype-brain-context-inventory.md); [`../DECISIONS.md`](../DECISIONS.md); [`../OWNERSHIP_AND_LIFECYCLE.md`](../OWNERSHIP_AND_LIFECYCLE.md); `~/Projects/claude-ops/plans/brain-platform-review-2026-07/01_target-architecture-and-roadmap.md`

## Decision

Adopt a **shallow content graph plus ranked search**, without a server-side task-context compiler in this work unit:

1. Keep the always-loaded bootstrap small and deterministic.
2. Route from the bootstrap to one substantive hub, then to the canonical source when needed.
3. Replace loader-direct orphan detection with convention-aware graph reachability.
4. Remove all mechanical lint writes to `00_loader.md`.
5. Harden roles fail-closed before restricting structural files.
6. Instrument routing and search before deciding whether server-side context compilation is necessary.

The optional `task`/`max_tokens` compiler is deferred to [spec 014](014-task-context-compiler.md). It may activate only if the post-slimming evidence meets that spec's trigger; it is killed if the slim architecture already meets the agreed sufficiency target.

Implementation approval for server Phases 1–3 was given on 2026-07-17. That approval did not include Brain-content changes, deployment, release, JEM/ERS migration, or the task-context compiler.

Release A was approved separately later on 2026-07-17. The FTS migration and security recheck passed, and `v1.3.1` was deployed with `ai-brain-jem=graph_shadow` and `ers-brain=legacy`. The first guarded `v1.3.0` attempt correctly stopped before Fly after its test subprocess inherited live `.env.local` runtime configuration; the resulting test-only JEM revisions were identified by their exact time window, rolled back to the verified pre-test heads in Postgres and the local mirror, and removed completely. `v1.3.1` adds regression-tested test-environment isolation to the guarded deploy. Final verification found no surviving incident-window revisions, 35 JEM and 46 ERS live files, zero open conflicts, and clean local sync cycles. No Brain-content migration or compiler work was performed.

The first shadow-observation pass later on 2026-07-17 found that fenced code blocks could desynchronise the inline-backtick matcher and hide valid references appearing later in a file. This made JEM's explicitly listed `archive/tasks-done.md` look graph-unreachable. The parser now removes fenced examples before extracting any edge syntax, with a regression test proving that fenced pseudo-routes stay non-edges while later inline references remain visible.

The correction was released as `v1.3.2` (`f80fbe1`) on 2026-07-17 without changing the JEM-shadow/ERS-legacy override. Fly machine version 45 passed its health check; `/health` reported `1.3.2` with Postgres revisions, Supabase artifacts, Postgres OAuth state and the git hot path disabled. Read-only checks executed against the deployed artifact reported 35 JEM and 46 ERS files, zero open conflicts, and only the two adjudicated JEM working-artifact findings. A one-off read-only ERS graph calculation left only `governance/brain-mcp-fork-signoff.md` unreachable and confirmed both template descriptors reachable. No Brain content, schema, task-context compiler or migration changed.

The JEM Phase 4 content release was approved separately after that observation pass and deployed as `v1.4.0` (`0115afb`) on 2026-07-17. Before the hosted revision-tracked writes, the consolidated local sync stack was paused and a 35-file local/hosted hash-matched snapshot was recorded at `~/Projects/ai-brain-jem/.brain-sync/snapshots/spec013-phase4-pre-migration-20260717T125736Z`. The coordinated release rotated JEM history, created the named operating destinations, slimmed the loader and current-state surface, and revised the server/tool descriptions without changing schema or building the task-context compiler.

Post-release JEM verification reported 39 hosted files, zero open conflicts, cursor `2026-07-17T13:51:17.209Z`, a 1,851-token loader-plus-`NOW.md` bootstrap (down from 9,265 estimated tokens), and unchanged evaluator results: 27/27 routing cases, 17/17 policy markers, 92/92 signposts and 10/10 search cases. Graph shadow retains only the same two adjudicated historical working-artifact findings and remains advisory. The restarted local mirror hash-matched all ten migrated payloads and completed healthy sync cycles. ERS remained at 46 files with zero conflicts and its pre-release cursor `2026-07-16T23:54:36.335Z` unchanged in `legacy`; no ERS content was readied for migration. Fly machine version 46 and `/health` reported `1.4.0` with the existing Postgres/Supabase/OAuth storage contract intact.

An optional interactive read-only test-drive was stopped when Chrome supplied the unregistered `jemilad-ers` GitHub session; the server rejected that principal as designed. The current John-only pilot authorizes `JEM-Fizbit`, including for John's access to `ers-brain`. This account-selection event did not modify Brain content and is not a release regression; direct authenticated MCP reads plus health, lint, sync and hash checks supplied the release evidence.

John then delegated the detailed JEM review and conditionally approved the ERS content migration. The bounded JEM audit found 39 hosted files, zero conflicts, the same 1,851-token bootstrap, unchanged 27/27 routing and only the two already-adjudicated historical working artefacts as graph-unreachable. Two files just over the bloat threshold and three stale capture-queue items remain ordinary content debt, not migration blockers. Spec 011 A3-7 delete propagation, the 2026-07-07 ERS content-state audit and P0 correction batch, the JEM observation gate and a quiet sync window supplied the four ERS preconditions.

Before ERS writes, the sync stack was paused and 46-file local and hosted snapshots were hash-matched at `~/Library/Application Support/Brain MCP/ers-brain-onedrive-sync/snapshots/spec013-phase5-pre-migration-20260717T142000Z`. The coordinated migration preserved the foldered ERS schema, collapsed project-specific loader routes behind `projects/README.md`, added the human map and operations guide, and rotated all JOURNAL/LOG history losslessly. One stale sync-state base treated the new root `README.md` as a simultaneous local deletion and hosted edit; the watcher was paused again, the reviewed file was placed locally, all 13 duplicate conflict records were resolved to that exact content, and the full 50-file local/hosted trees then matched with zero open conflicts.

The ERS lint profile and content contract were released as `v1.4.1` (`23c209d`) and the two-Brain shadow override became active on Fly machine version 49. `/health` reports `1.4.1` with Postgres revisions, Supabase artifacts, Postgres OAuth state and the git hot path disabled. ERS now has 50 hosted files, a 1,600-token bootstrap, zero graph-unreachable files and three deliberate rotated-history exemptions. The post-migration evaluator remains 27/27 routing cases, 17/17 policy markers, 92/92 signposts and 10/10 search cases. JEM remains unchanged in `graph_shadow`. This release did not change schema, build the task-context compiler, add team access, change the hosted principal or perform the dedicated ERS infrastructure/private-mirror cutover.

## Why this work exists

The loader is currently overloaded as:

- the always-loaded Brain contract;
- a task-routing table;
- a complete file inventory;
- a detailed ingestion and output-capture manual; and
- the server's definition of whether content is discoverable.

The server also disagrees with both Brains' documented orphan convention. `brain_lint` tests whether files are directly named in `00_loader.md`, while the Brains describe orphans as files with no inbound graph path. The current parser ignores wikilinks, nested paths and SharePoint link mappings, so valid ERS content can be reported as orphaned.

The mechanical orphan-to-loader fix contributed less historical bloat than first assumed: most growth came from human- and agent-authored protocols, file inventories and retrieval-miss patches. Both causes matter:

- remove the server mechanism that rewards direct loader insertion; and
- relocate detailed loader content into named, discoverable destinations.

`NOW.md` has a parallel problem. It is always loaded, can grow into a changelog and currently carries the same instruction-injection potency as the loader without the same proposed write protection.

## Pre-migration baseline

There are two operational Brains:

- `ai-brain-jem` — personal, numerically prefixed and relatively flat;
- `ers-brain` — shared-company, foldered by domain.

Both are served by this codebase. The John-only pilot currently exposes both through one hosted registry; the approved destination is two owner-scoped deployments of the same upstream codebase, with ERS consuming tagged releases through its private mirror.

Mechanics recorded when this decision was approved:

- `brain_load_context` accepts only `brain_id` and returns complete `00_loader.md` plus complete `NOW.md`.
- The pre-migration fixed bootstrap was approximately 36.9 KB for JEM and 25.8 KB for ERS.
- Hosted Postgres search is boolean line matching without useful ranking; structured results are flattened before reaching the shared store interface.
- The role model is `owner | admin | member | reader`, but the current write check rejects only `reader` and fails open for unknown role strings.
- `00_loader.md` and `NOW.md` are protected from delete/rename, but not ordinary updates.
- `brain_lint({ fix: true })` can write the loader through both `orphan_index` and `reviewed_date`.
- Spec 008 has a deterministic routing baseline, but no production-search or follow-up-read evaluation.

The July 2026 platform review concluded that the JEM and ERS schemas are fundamentally sound. This work keeps both schemas and changes only the shared content, retrieval, lint and permission contracts.

## Architecture drivers

Optimise the combined cost of:

1. **Fixed context tax** — material loaded in every Brain-aware session.
2. **Round-trip latency** — sequential reads before useful work starts.
3. **Retrieval effectiveness** — correct, sufficient and canonical context.
4. **Attention quality** — irrelevant context can reduce accuracy.
5. **Explainability** — operators can see why a route exists.
6. **Maintenance cost** — ordinary contributors need not understand root architecture.
7. **Scalability** — new projects, users and Brains do not force loader growth or server forks.
8. **Access control** — inaccessible content and metadata do not leak through routing or search.
9. **Portability** — Markdown remains canonical and inspectable.

Caching is not a decision driver: every session pays the bootstrap once, and within-session re-reads can be cached under any option.

## Alternatives

### A. Flat comprehensive loader — rejected

It is deterministic and transparent, but every addition creates a permanent token and attention tax and a shared write-contention surface.

Reconsider only if multi-user plans are abandoned. Retain its useful property through generated file listing, not a hand-maintained inventory.

### B. Deep manual hierarchy — rejected as deep

It reduces bootstrap size but adds hops, stale indexes and client-harness dependence that the current corpus size does not justify.

Its shallow core — bootstrap, one substantive hub, canonical pointer — is adopted.

### C. Pure search-first — rejected as the primary entry point

Search is useful for routing gaps and broad discovery, but cannot reliably push policy, authority and safety markers at cold start. Current hosted search also lacks ranking.

Its structured-search and ranking improvements are adopted as a fallback and measurement track. Reconsider search as the primary entry point if the corpus passes roughly 100 substantive sources and hub routing measurably degrades.

### D. Shallow graph plus task-context compiler — split

The shallow graph is adopted. The compiler is unmeasured and would add several new subsystems before proving a residual problem. It is deferred to spec 014 behind explicit trigger and kill criteria.

## Responsibility boundary

### Brain content

Each Brain owns:

- stable intent classes and policy markers;
- hub files and their links;
- canonical L2 pointers;
- current-state content in `NOW.md`; and
- human-readable operations and onboarding guidance.

Routing knowledge always retains a Markdown home. Server routes may be derived from content but do not become a second source of truth.

### Registry

Per-Brain registry configuration owns:

- graph-lint mode;
- graph root and exemption options;
- SharePoint URL mappings;
- relative-parent-link scope; and
- roles.

Add a typed optional field to `BrainDefinition`:

```typescript
interface BrainLintConfig {
  reachability_mode?: "legacy" | "graph_shadow" | "graph";
  graph_roots?: string[];
  relative_parent_scope?: "disabled" | "within_brain";
  sharepoint_url_mappings?: Array<{
    url_prefix: string;
    brain_path_prefix: string;
  }>;
  exempt_globs?: string[];
}
```

The default is `legacy`. `graph_shadow` computes and reports old and new orphan sets without changing enforcement or applying graph-derived fixes. `graph` becomes available only after the shadow acceptance gate passes.

Because the registry is currently baked into the deployment image, add an environment override:

```text
BRAIN_LINT_MODE_OVERRIDES={"ai-brain-jem":"graph_shadow","ers-brain":"legacy"}
```

The server parses and validates this JSON map at startup. Unknown Brain IDs, unknown modes or malformed JSON fail startup rather than silently falling back. The override changes only `reachability_mode`; edge mappings and exemptions remain typed registry content. This allows a secrets/config change plus restart without rebuilding and preserves independent per-Brain rollout.

### Server

The server owns generic mechanisms only:

- unchanged bootstrap loading;
- structured and scored search;
- link parsing and reachability;
- role enforcement at the store boundary;
- context-budget lint; and
- metadata-only operational metrics.

No JEM-, ERS-, Nexus- or person-specific routes belong in server code. Existing hardcoded semantic checks should be removed or represented through generic content/configuration during implementation.

## Content architecture

### Level 0 — bootstrap

`00_loader.md` contains only:

- Brain identity, authority and canonicality rules;
- essential safety, capture and access boundaries;
- six to ten stable top-level intent classes with formal links to hubs;
- the fallback rule when no route fits; and
- a concise pointer to operations guidance.

It does not contain a complete file inventory, individual projects or people merely because they exist, detailed ingestion procedures, temporary priorities, maintenance history or routes already owned by a hub.

`NOW.md` is a one-screen hot set: current priorities, open decisions and links to active hubs. It does not contain an embedded changelog, a task repository or unreviewed agent instructions.

The combined `00_loader.md` + `NOW.md` bootstrap budget is **2,500 tokens per Brain**, enforced by lint. This is a provisional budget: the decision log records it and later evidence may amend it. Word counts remain advisory, not release gates.

Both always-loaded files are structural and require `admin` or `owner` to update. Members remain able to edit ordinary hubs and content files.

### Level 1 — substantive hub

A task normally selects one substantive project, entity, governance, writing, commercial, technical-estate or reference hub.

A hub earns its existence only when it provides synthesis, distinct ownership or permissions, an independent lifecycle, improved retrieval precision or a necessary size boundary. An index that only forwards to another index is not a mandatory machine hop.

Optional hub frontmatter is limited to `aliases`, `canonical` and `owner` where ambiguity is real. If aliases later become deterministic routing inputs, they move into an admin-gated artifact; member-writable frontmatter must not silently acquire routing authority.

### Level 2 — canonical source

The hub points to the live first-class project folder, policy corpus, register, CRM, repository or source document. That destination is outside the Brain hierarchy and is a terminal pointer, not another Brain layer.

For example:

```text
bootstrap → projects/nexus-platform.md → canonical Nexus project home
```

`projects/README.md` remains useful for human portfolio browsing and broad discovery but is not a compulsory retrieval hop.

## Named destinations for evicted loader content

No loader block may be removed until its destination exists and the replacement pointer has been tested.

| Loader content | JEM destination | ERS destination | Delivery rule |
|---|---|---|---|
| Brain identity, authority, safety and canonicality | Remains concise in `00_loader.md`; detail in existing identity/working-style hubs | Remains concise in `00_loader.md`; detail in `governance/README.md` and `governance/guardrails.md` | Push content remains in bootstrap |
| Stable intent routes | Formal links from `00_loader.md` to existing numbered/domain hubs | Formal links from `00_loader.md` to existing domain `README.md` hubs | Six to ten intent classes only |
| Ingestion, inbox, source categories and output-capture protocol | New `12_brain_operations.md` | New `governance/brain-operations.md` | `brain_ingest` and `brain_scan_inbox` tool descriptions also carry concise operational pointers and source-category help |
| Work-capture routing | One-line boundary stays in loader; detailed rules in `12_brain_operations.md` | One-line boundary stays in loader; detailed rules in `governance/brain-operations.md` | Critical destination rules remain push content |
| Full file inventory | `brain_list_files` plus links from numbered/entity hubs | `brain_list_files` plus domain `README.md` hubs | Never hand-maintained in loader |
| Backlink, naming, review and maintenance procedures | `12_brain_operations.md` | `governance/brain-operations.md` | Lint/tool help points to the file |
| Human quickstart and glossary | New root `README.md` | New root `README.md` | Human-facing; not loaded by default |
| Temporary priorities and open decisions | `NOW.md`, within budget | `NOW.md`, within budget | Admin/owner curated |
| Historical events and maintenance history | `JOURNAL.md` / `LOG.md`, rotated before migration | `JOURNAL.md` / `LOG.md`, rotated before migration | Excluded from default search |

The server self-description must change in the same release as the content migration. It must no longer claim that the loader is the complete ingestion protocol; it should identify the loader as the bootstrap contract and point agents to the relevant operations file and tool descriptions.

## Graph edge grammar

### Roots and reachability

- Required roots are `00_loader.md` and `NOW.md`.
- Additional roots may be named in the per-Brain `graph_roots` registry field.
- A content Markdown file is reachable when a valid directed edge path exists from a root.
- External canonical destinations are terminal pointers: they validate discoverability but are never crawled.
- Cycles are valid but do not create reachability unless the cycle is itself reachable from a root.

### Counted edges

1. **Wikilinks:** `[[path]]` and `[[path|label]]`; an omitted `.md` suffix is inferred.
2. **Relative Markdown links:** `[label](path.md)` and fragment variants. Percent-encoding is decoded before path normalisation.
3. **Backtick file references:** an exact Brain-relative or source-file-relative `path.md`.
4. **Backtick directory references:** resolve to that directory's `README.md`, then `INDEX.md`; they do not make every descendant reachable.
5. **Mapped SharePoint URLs:** an absolute URL counts only when it matches a configured `url_prefix`; the remainder maps to `brain_path_prefix` and resolves to a Brain file.

Paths are normalised case-sensitively after URL decoding. Fragments do not affect file reachability. A relative `../` edge counts only when `relative_parent_scope` is `within_brain` and the normalised target remains inside the Brain root.

### Non-edges and failures

- links and path snippets inside fenced code examples;
- bare prose mentions and unformatted filenames;
- external URLs outside an approved SharePoint mapping;
- absolute local filesystem paths;
- directory references with no `README.md` or `INDEX.md`;
- paths that escape the Brain root;
- inaccessible files; and
- cross-Brain references that the current principal cannot resolve.

Invalid or inaccessible edges produce named diagnostics, never silent reachability. Search and lint must permission-filter before disclosing target filenames or metadata.

### Exemptions

Exemptions are explicit per-Brain globs, not hardcoded schema assumptions. The initial narrow exemption is rotated journal material such as `archive/JOURNAL-*.md`. Ordinary archive files are not automatically exempt.

### Shadow rollout

`graph_shadow` reports:

- the legacy orphan set;
- the graph-unreachable set;
- added and removed findings;
- unresolved/malformed edges by syntax; and
- exemption use.

It cannot alter fix plans. Both live corpora must produce zero adjudicated false-positive graph orphans before either Brain moves to `graph`.

## Lint and automatic-fix contract

- `brain_lint({ fix: false })` is read-only and available to any role with Brain read access.
- `brain_lint({ fix: true })` continues to require write authority for each target file.
- The `orphan_index` fix is removed; lint never inserts an orphan into the loader.
- The `reviewed_date` fix is removed from Brain-content writes. Lint may report `last_checked_at` through operation status/telemetry, but it does not rewrite the loader.
- No automatic fix may modify `00_loader.md` or `NOW.md`.
- Deterministic ordinary-content repairs may remain only when their target is unambiguous and the caller is authorised for that target.
- Bootstrap budget excess, graph ambiguity and structural-file changes are review items, not auto-fixes.

This explicitly supersedes fixes A and C in the 2026-07-01 lint-apply decision while retaining its confirm-gated model for safe ordinary-content fixes.

## Role and write-gate sequencing

1. First harden role parsing and authorisation deny-by-default. Only the known `owner | admin | member | reader` values are accepted; unknown roles are rejected.
2. Then enforce a store-layer structural-file allowlist: only `owner` and `admin` may write `00_loader.md` or `NOW.md`.
3. Apply the gate to every hosted update path that reaches the shared store, not only the MCP tool wrapper.
4. Test member rejection, admin acceptance and unknown-role rejection at the store boundary.

Known limitations must remain explicit: local filesystem edits, SharePoint edits and sync ingestion do not pass through the hosted role gate; current stdio/system principals are also treated as owner across all Brains. Those bypasses remain until deployment isolation and sync principal hardening land through the ERS fork. The structural gate reduces hosted multi-user risk but is not represented as universal enforcement.

## Search and retrieval track

Spec 013 does not change the `brain_load_context({ brain_id })` interface or add a task packet.

The retrieval work in scope is:

1. Promote structured `SearchResult[]` to the shared `BrainStore` interface instead of flattening Postgres results.
2. Add Postgres full-text search and deterministic scoring.
3. Default-scope search to knowledge files, excluding `LOG.md`, `JOURNAL.md`, `archive/**` and `working/**` unless explicitly requested.
4. Preserve a permission-filter-before-ranking seam for future per-file ACLs.
5. Use production search code in routing evaluation rather than a separate fuzzy matcher.

Normal flow:

```text
brain_load_context(brain_id)
  → slim loader + NOW
  → one L1 hub selected from formal intent routes
  → one parallel read batch for the hub and any directly required source
  → L2 canonical destination when live evidence is needed
```

Failure flow:

- no intent route fits → say so and use ranked `brain_search`;
- hub is stale → existing drift lint reports it;
- referenced file is absent → report the named missing edge and continue;
- cross-Brain target is unavailable → report access failure, never silently omit it.

## Telemetry contract

Persist only metadata such as mechanism codes, result counts, bytes/tokens, latency and follow-up-read counts. Never persist task text, search-query text or retrieved snippets in routing/search telemetry. A routing reason is a bounded code such as `intent_route`, `exact_path`, `fts_fallback` or `graph_edge`, not user content.

## Per-Brain migration

### JEM Brain first

- Rotate `JOURNAL.md` and `LOG.md` before slimming.
- Preserve numeric filenames as stable identifiers.
- Create `12_brain_operations.md` and root `README.md`.
- Turn `05_projects.md` into a hub-of-hubs rather than a live-state repository.
- Preserve identity, voice, career and mental-model routes where they improve task accuracy.
- Evaluate before and after content changes.
- Do not force ERS-style folders.

### ERS Brain second

ERS migration may start only after:

1. spec 011 delete/rename is verified end-to-end on hosted `ers-brain`, closing the standing A3-7 rename/delete freeze;
2. the ERS content-state audit has landed;
3. JEM has passed its observation gate; and
4. an onboarding quiet window is agreed.

Then:

- rotate `JOURNAL.md` and `LOG.md`;
- preserve the current domain-folder structure;
- create `governance/brain-operations.md` and root `README.md`;
- remove detailed output and inventory rows after graph shadow proves reachability;
- remove project-specific loader rows, including Nexus;
- retain `projects/nexus-platform.md` as the direct stable Nexus hub;
- retain `projects/ai-transformation.md` as a sibling synthesis; and
- evaluate before and after content changes.

The ERS private mirror stays pinned to the pre-013 upstream tag until its content migration is ready; unflagged lint or role behaviour must not arrive through an earlier shared release.

## Implementation sequence

### Phase 0 — specification and approval

1. Reconcile the Fable review into this spec.
2. Record the decision and rejected alternatives.
3. Create the trigger-gated compiler successor spec.
4. Obtain explicit implementation approval.

### Phase 1 — instrument first

1. Promote structured search through the store interface and add production FTS/scoring.
2. Rebuild the packet/routing evaluator around frozen fixtures and production search code.
3. Separate policy-marker assertions from signpost assertions.
4. Record fat-bootstrap baselines for both Brains, including tokens, route success, policy markers, follow-up reads and latency.

### Phase 2 — server release A, flagged with no default change

1. Implement the edge parser and graph reachability in `graph_shadow`.
2. Remove `orphan_index` and loader-writing `reviewed_date`.
3. Allow read-only lint for read-authorised roles.
4. Add bootstrap-budget lint.
5. Add search default scoping.

### Phase 3 — authorisation

1. Ship P1 deny-by-default role hardening.
2. Add the store-layer `00_loader.md` + `NOW.md` owner/admin gate.
3. Verify every hosted write path and document remaining local/sync bypasses.

### Phase 4 — JEM migration

1. Rotate logs and take sync-aware snapshots.
2. Create the named destinations.
3. Deploy the revised server self-description and tool descriptions in the same coordinated release as those destinations.
4. Slim content.
5. Run the before/after evaluator and policy-marker checks.
6. Observe real use before proceeding.

Steps 1–5 were released in `v1.4.0`; the bounded step-6 audit closed the JEM gate for the separately approved ERS content migration. JEM remains in `graph_shadow`; this does not approve graph enforcement.

### Phase 5 — ERS migration

1. Satisfy the four ERS preconditions.
2. Adopt the tested upstream tag through the private mirror.
3. Run graph shadow and content migration in a quiet window.
4. Verify and observe before graph enforcement.

The John-only hosted pilot completed steps 1 and 3 and entered step 4 in `v1.4.1`. Step 2 remains part of the separately governed dedicated ERS deployment cutover rather than a prerequisite for validating the content contract in the current pilot. Keep ERS in advisory `graph_shadow` until its observation gate closes.

### Phase 6 — compiler decision

Evaluate the measured residual gap against spec 014. Record either activation of that spec or an explicit no-build decision.

## Acceptance criteria

1. Combined bootstrap is at most 2,500 tokens per Brain and lint enforces the provisional budget.
2. Graph shadow produces zero adjudicated false-positive orphans on both live corpora using the specified edge grammar. ERS template descriptors are reachable; `governance/brain-mcp-fork-signoff.md` remains correctly flagged if still genuinely unreachable.
3. No `fix: true` code path writes `00_loader.md` or `NOW.md`, including `reviewed_date`.
4. Store-layer tests reject member writes to both structural files, accept admin/owner writes and reject unknown role strings.
5. Read-only lint works for read-authorised roles without granting fix authority.
6. The packet/routing evaluator uses frozen fixtures and production search code; policy-marker assertions are separate from retargetable signpost assertions.
7. The post-slim JEM golden set is at least as good as the recorded pre-slim baseline on retargeted routing, with policy markers at 100%.
8. `brain_load_context({ brain_id })` retains byte-identical assembly/envelope behaviour for unchanged fixture content and existing callers; content migration is the only intended payload change.
9. Search returns structured scored results and excludes operational/history paths by default.
10. Per-Brain lint mode defaults to `legacy`; the validated environment override can place either or both Brains in shadow without enabling graph enforcement.
11. All evicted loader blocks have the named destination and replacement pointer defined above.
12. Telemetry contains no task text, query text or retrieved snippets.

## Rollback

### Server behaviour

- Switch the affected Brain's mode to `legacy` through `BRAIN_LINT_MODE_OVERRIDES` and restart.
- Redeploy the prior upstream tag if search, lint or role behaviour regresses.
- Keep legacy routing fixtures until both Brains pass their observation periods.
- Keep the future ERS private mirror pinned to an explicitly reviewed upstream tag.

### Content migration

Rollback is sync-aware; revision restore alone is insufficient:

1. Pause the local sync agent for the affected Brain.
2. Export and tag both local and hosted heads, recording file hashes.
3. Restore the pre-migration snapshot on both local and hosted sides.
4. Verify file sets and hashes match the tagged export.
5. Run load, lint and routing smoke checks.
6. Resume sync and verify no conflict or immediate re-push.

The A3-7 freeze is closed. Future rollback still requires the same paused-sync, dual-snapshot procedure.

## Verification

For this revised documentation:

- `git diff --check`;
- verify every relative Markdown link resolves;
- confirm specs 013 and 014 appear in in-flight spec discovery;
- confirm each Fable §10 required revision maps to an explicit section;
- confirm only docs changed.

Completed for the JEM and ERS content releases:

- focused tests for edge parsing, graph shadow, lint fix exclusions, read-only lint, fail-closed roles, structural-file gates, budgets and per-Brain overrides;
- frozen routing/policy fixtures using production search;
- `npm run eval:brain:routing`;
- `npm test`;
- hosted read-only evaluation against both Brain IDs;
- sync-aware snapshot and local/hosted hash verification; and
- staged production deployment followed by JEM observation in `graph_shadow`;
- all four ERS preconditions plus a hash-matched 46-file rollback snapshot;
- lossless ERS history rotation and exact 50-file local/hosted convergence; and
- post-release ERS graph shadow with zero unreachable files and three deliberate history exemptions.

Still required: bounded ERS real-use observation before any graph enforcement; separate governance for the private ERS mirror/dedicated infrastructure; and the independent spec 014 compiler decision.

## Assumptions and proof gaps

- The 2,500-token bootstrap cap is provisional and may be amended by evidence.
- Attention-quality harm from the current bootstrap remains asserted rather than directly measured.
- Hosted latency evidence is based on small samples.
- Client-surface variance must be measured by the rebuilt evaluator.
- Per-file ACLs remain out of scope unless rollout requirements change.
- The JEM/ERS content releases do not imply authority for graph enforcement, schema changes, the task-context compiler, hosted-principal changes or dedicated ERS infrastructure.
