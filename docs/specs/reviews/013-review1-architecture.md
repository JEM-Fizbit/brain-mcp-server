# Spec 013 — Review 1 (independent architecture lens, Fable 5, 2026-07-17)

Independent, read-only architecture review of [`../013-brain-context-architecture.md`](../013-brain-context-architecture.md), run per the spec's own review gate (Fable 5, ultracode). The reviewer reconstructed the current architecture from source and chose among the alternatives independently; spec 013 was treated as a proposal, not a baseline. **Reconciled 2026-07-17:** spec 013 was revised against all ten requirements in §10, the compiler was split into [spec 014](../014-task-context-compiler.md), and the architecture decision was recorded in [`docs/DECISIONS.md`](../../DECISIONS.md). The review findings below are unchanged.

**Baseline:** `brain-mcp-server` @ `06838db` (clean); live JEM Brain (`~/Projects/ai-brain-jem/brain/`) and ERS Brain (SharePoint `01_ers-brain/brain/`); July 2026 platform review corpus (`~/Projects/claude-ops/plans/brain-platform-review-2026-07/`); specs 008–010; hosted doctor telemetry (`~/Projects/ai-brain-jem/.brain-sync/hosted-doctor.out.json`). Method: lead-reviewer primary-evidence pass over the load/lint/write/role code and both loaders, plus a 15-agent workflow (6 evidence readers, 4 approach advocates, 4 adversarial attackers, 1 completeness critic; ~1.6M tokens). Every High finding was re-verified against primary sources by the lead. No files were edited during the review.

---

## Verdict: REVISE

Split the spec. **Approve the content-architecture and maintenance layer** — slim L0/L1/L2, graph-reachability orphans, orphan-auto-fix removal, role-gated loader, bootstrap budgets, evals-first — subject to the ten revisions in §10. **Remove the server-side task compiler from this spec** — it is premature and unmeasured; it belongs in a successor spec gated on a demonstrated residual gap *after* content slimming lands. Confidence: **high** on the split verdict; **medium** on whether the compiler will ever be justified (the deferral is designed to measure exactly that).

---

## 1. The spec's factual baseline checks out — and the real defect is worse than the spec says

Every mechanical claim in spec 013 verified against source:

| Spec claim | Verdict | Evidence |
|---|---|---|
| `brain_load_context` takes only `brain_id`, returns complete loader + complete NOW | Confirmed | `src/schemas/tools.ts:13`; `src/services/active-brain-store.ts:87-107` |
| Bootstrap = 36.9 KB JEM / 25.8 KB ERS (~9.2k / ~6.5k tokens) | Confirmed by measurement | `wc -c`: 27,798+9,114 and 11,840+14,009 bytes |
| Hosted Postgres has keyword search, no working semantic path | Confirmed | `pathsForBrain` throws for non-filesystem backends (`src/services/registry.ts:318-325`); the local "vector" is a 128-dim hashed token count, not embeddings |
| Every non-reader has unrestricted write authority | Confirmed | `assertWriteRole` rejects only `role === "reader"` (`src/services/request-context.ts:33-37`) — and it **fails open** for any unknown role string |
| Loader/NOW protected from delete/rename but not update | Confirmed | `src/services/brain-store.ts:42-49`; never called on any write path |
| Lint orphans = absent-from-loader, not reachability | Confirmed | `src/services/lint.ts:250-276` |

Two things the spec understates:

**The server contradicts the Brains' own documented contract.** Both loaders define an orphan as *"content files with zero inbound `[[backlinks]]`"* — a graph definition. The server's `extractFileReferencesFromContent` (`src/services/lint.ts:100-117`) parses only backtick-quoted `.md` names and *single-segment* directory refs; it ignores wikilinks entirely and cannot match nested paths like `references/templates/`. The orphan redefinition is not a new idea — it fixes a drift between the implementation and the Brains' stated convention, and it mechanically explains the ERS template-descriptor false orphans.

**But the growth loop is a smaller contributor than the spec implies.** The JEM loader grew 19.6 KB → 27.8 KB (+40%) over ten weeks; lint's orphan auto-fix contributed exactly **one line** (`archive/tasks-done.md — (description pending review)`, filed under the wrong heading, unreviewed 16 days later). The dominant bloat is ~1,900 words of ingestion/output-capture protocol (~55% of the file) plus a 37-row inventory, accreted by humans and agents — with a second documented vector: retrieval-miss churn (the 2026-06-27 CNetID incident added three routing rows in one day). Spec 013's framing "platform-design defect, not agent-discipline problem" is half right: the *mechanism* is a defect worth removing, but removing it does not fix most of the bloat. Content relocation does — and that is content work, not server work.

NOW.md rot is confirmed on both Brains: JEM's is a month stale against its weekly cadence and contains a routing instruction contradicting the loader (`Reference_ERS_Brain_Context/`, slimmed to a pointer 2026-06-30); ERS's NOW (14 KB — larger than its loader) is ~60% embedded changelog, with its one CEO-team-facing section an empty placeholder.

## 2. The four approaches compared

Consolidated scores (1–5) from the advocacy panel, adjusted by the lead:

| Dimension | A. Flat loader | B. Deep hierarchy | C. Search-first | D. Graph + compiler |
|---|---|---|---|---|
| Latency | 4 | 3 | 3 | 4 |
| Retrieval quality | 3 | 3 | 4 | 3 (unproven) |
| Explainability | 5 | 5 | 4 | 5 (if manifest ships) |
| Maintenance | 2 | 4 | 5 | 3 |
| Permissions | 2 | 3 | 4 | 3 |
| Multi-user scale | 2 | 3 | 3 | 4 |

The decisive observations, none owned by a single approach:

- **The hub graph already exists.** ERS `projects/README.md` specifies a formal hub contract; `nexus-platform.md` is a model L1 file (self-declared "orientation layer, not the live record", with an L2 canonical pointer) reachable three independent ways — the loader's Nexus row is demonstrably redundant. JEM's five entity hubs + numbered files are a de facto L1 layer. Spec 013's L0/L1/L2 mostly *finishes* what both Brains converged on organically.
- **The graph is not yet parseable.** The July review measured both loaders/NOWs as link-graph islands (ERS loader: zero outbound formal links; 13 strict orphans including all 7 READMEs under wikilink-only counting; four coexisting link syntaxes, including house-mandated absolute SharePoint URLs). Any reachability lint without an explicit, convention-aware edge grammar floods ERS with false positives during the exact window the team is learning to trust the system.
- **Deep hierarchy is wrong for a ~74-file corpus** — one hub hop covers nearly everything; extra levels add hops and staleness surfaces without discoverability gain.
- **Search is the only retrieval primitive that works on hosted today and is immune to the link-syntax mess** — but it has no ranking at all (boolean line-match, alphabetical, first-N-wins; `src/search-match.ts:83-107`), and the 167 KB ERS `LOG.md` (2× past its own rotation threshold) will dominate any naive scan. Search cannot deliver push content (policy, guardrails, hard boundaries) — a thin loader contract must.

## 3. Recommendation

**Adopt the shallow-graph content architecture (spec 013 minus the compiler), plus the search upgrade as the retrieval track.**

1. **Content layer (approve):** slim L0 loader (contract + intent classes), NOW as one-screen hot set, L1 = the existing hub layer formalized (promote the ERS `projects/README.md` hub contract to both Brains), L2 = the canonical-pointer convention codified (`templates.md`'s "mirror defers to canonical; where they disagree, the README wins"). Every evicted loader block gets a **named destination**: ingestion protocol → a protocol file + the `brain_ingest`/`brain_scan_inbox` tool descriptions (which can carry the source-category table); file inventory → `brain_list_files` + hubs; colleague quickstart/glossary → a human-facing README (a July-review rollout requirement). Update the server's self-description string in the same release — it currently tells every client the loader *is* the ingestion protocol.
2. **Maintenance layer (approve with definition):** orphan = graph-unreachable, with the edge grammar **written into the spec**: `[[wikilinks]]` + relative markdown links + backtick file/dir refs count; absolute SharePoint URLs resolve via a per-Brain base-URL mapping in registry config; `archive/` rotated journals exempt. Ship **advisory/shadow mode first**, comparing old vs new orphan sets on both Brains before enforcement. Remove fix A (orphan-to-loader) — blast radius verified contained (cockpit/menubar/CLI degrade gracefully; only tests and one print line change). Also relocate or exempt the `reviewed_date` fix, which writes the loader and falsifies the spec's own acceptance criterion as written. Add the bootstrap token-budget lint (review-endorsed).
3. **Roles (approve with sequencing):** structural write gate on `00_loader.md` as a **store-layer allowlist** (`admin`/`owner` only, fail-closed), sequenced **after** the P1 deny-by-default role hardening — layering it on today's fail-open check is theater. Gate NOW.md the same way or strip agent-directed imperatives from it at load time: it is always-loaded and member-writable, an injection channel exactly as potent as the loader the spec gates. State honestly that stdio/system/sync/SharePoint write paths bypass the gate until the ERS fork isolates them.
4. **Retrieval track (approve instead of the compiler):** promote structured `SearchResult[]` to the `BrainStore` interface (it already exists inside `PostgresRevisionStore` and is flattened away), add Postgres FTS/scoring, and default-scope search to knowledge files (exclude LOG/JOURNAL/archive/working). This is the July review's funded recommendation (fusion → rerank → pgvector at P3), and it becomes the compiler's discovery leg if the compiler is ever built.
5. **Compiler (defer to its own spec, behind a kill criterion):** the `task`/`max_tokens` one-call packet is not approved now. Reconsideration trigger: after JEM slimming, the packet-mode golden set shows sessions still needing ≥2 follow-up reads at material frequency, or harness-variance evidence shows weak clients failing routing that a server packet fixes. Kill criterion: if the slim-content baseline meets the one-call target, the compiler is not built. Prerequisites if triggered: pure store-agnostic compiler module, batch multi-file fetch, stable-prefix + variable-suffix output layout, manifest listing exclusions and truncations, name-only link expansion (never dereference L2 pointers — SSRF), task text never persisted to telemetry, load-test gate before ERS.

### Strongest case against this recommendation

D's advocate is right that content slimming without the compiler leaves routing quality hostage to each user's client harness — and the July review's own data says harness effects swing accuracy by 16+ points (Opus 93.1% vs 76.7% across harnesses). A weak claude.ai-connector agent that won't do multi-hop reads gets no server-side backstop, and nothing in this recommendation measures that failure mode until the packet-mode eval exists. If ERS onboarding surfaces exactly this, the compiler deferral will have cost a quarter's delay on the fix. The deferral holds anyway because the compiler is equally unmeasured in the other direction, costs ~6 new subsystems on a bus-factor-1 team mid-fork, and the eval that would adjudicate is 1.5–2 days of work — buy the instrument before the machine.

### Rejected alternatives and reconsideration triggers

- **A (flat comprehensive loader)** — rejected: the map already outweighs the biggest content hub (6,950 vs 6,480 tokens); one governed hot file becomes the write-contention focal point at 5–20 users; structurally incompatible with any future per-file visibility. *Steal:* generated (not hand-maintained) file inventory; the "referenced file may be absent — note and proceed" escape hatch as the manifest's miss-handling contract. *Reconsider if:* multi-user plans are abandoned entirely.
- **B (deep manual hierarchy)** — rejected as "deep": wrong for ~74 files; multiplies staleness surfaces; hostage to client harness with no backstop. Its shallow core (slim loader, hub contract, L2 pointers) **is** the approved content layer.
- **C (pure search-first)** — rejected as the *primary* entry point: no delivery mechanism for push content (policy markers, hard boundaries), weak on cold-start orientation intents, and unranked today. Its search-upgrade track is adopted wholesale. *Reconsider if:* corpus passes ~100+ sources and hub routing degrades (the review's own re-open trigger).
- **D-as-bundled (spec 013 as written)** — rejected: couples a measured, cheap, reversible content fix to an unmeasured, expensive server subsystem, gated on an acceptance criterion (90% one-call) that **no current instrument can score** — the evaluator never calls `brain_load_context`, has no packet concept, and its matcher reduces `01_identity.md` to the token "identity" matched anywhere in the brain (`evals/brain-routing/evaluator.mjs:4-17,33-35,75`). *Reconsider per the trigger in §3.5.*

## 4. Boundary: content vs registry vs server

- **Content (each Brain owns):** intent classes, hub files and their links, canonical L2 pointers, policy/guardrail prose, NOW. Routing knowledge always keeps a markdown home — server routes may be *derived from* content, never a second source of truth.
- **Registry (per-Brain config owns):** edge-grammar options (SharePoint URL base mapping, `../` scope), lint-mode flag (`legacy` | `graph`, default `legacy`), future `context_mode`, packet exclusion lists, roles. The registry is currently **baked into the Docker image** (`Dockerfile:31`, `fly.toml:18`) — the spec must name an env-override mechanism (e.g. `BRAIN_GRAPH_LINT_BRAINS=...`) so a flag flip is a secrets change + restart, not a rebuild. On the shared pilot server a deployment-wide env var cannot enable JEM while keeping ERS legacy — the flag must be per-Brain.
- **Server (generic mechanisms only):** load, read, structured search + scoring, link parsing/reachability, role enforcement in the store layer, budgets, manifests. No JEM/ERS/Nexus-specific routes — the current lint already violates this in miniature (two hardcoded JEM filenames in `suggestedSemanticChecks`, `src/services/lint.ts:370-391`); clean that up in passing.

## 5. Retrieval flows

**Normal:** `brain_load_context(brain_id)` → slim contract + NOW (~1.5–2k tokens, byte-stable between content edits) → agent selects one L1 hub from intent classes → 1–2 parallel `brain_read_file` calls (~200–300 ms e2e each, measured) → hub's L2 pointer if the live record is needed. Expected wall time ≈ today's, at ~20% of the token load.

**Failure paths:** intent not covered → loader's gap-flagging rule (say so; `brain_search` fallback, now ranked and scoped). Hub stale vs NOW → surfaced by the existing drift lint. Referenced file absent → escape-hatch convention. Cross-Brain pointer (`jem_writing_voice` → JEM Brain) → **explicit named failure**, never a silent omission; this rule must carry into any future packet manifest.

## 6. Minimal machine-readable contract

Do **not** backfill frontmatter corpus-wide (spec 013 is right). The only structured additions justified now: optional hub frontmatter (`aliases`, `canonical`, `owner`) on the ~15 hub files where ambiguity is real — and if aliases ever become *deterministic route* inputs, they must live in an admin-gated artifact, not member-writable frontmatter (otherwise routing authority silently migrates into content the role model doesn't protect).

## 7. Ranked findings

| # | Sev | Finding | Evidence | Disposition |
|---|---|---|---|---|
| F1 | High | Compiler bundled with content fixes despite zero measurements of the problem it uniquely solves; ~6 missing subsystems (structured search, batch read, token counting, section parsing, scoring, graph model); latency win ≈ one parallel read batch, roughly cancelled by O(corpus) compile cost (search p95 388 ms at 34 files; no batch read API) | telemetry + seams inventory; July review d2:138 (harness > retrieval); the review recommended search fusion, never a load-time compiler | Split spec (§3.5) |
| F2 | High | The 90% one-call acceptance criterion is unmeasurable by any existing instrument; the gate would read green on a broken implementation and red on test artifacts | `evals/brain-routing/evaluator.mjs:33-35,75` whole-brain fuzzy matching; no `load_context` call; all-or-nothing scoring | Phase-1 eval rebuild is a hard precondition |
| F3 | High | Graph-orphan redefinition has no edge grammar; wikilink-only counting flags ~13 ERS files incl. all 7 READMEs; acceptance criteria unsatisfiable as written | `src/services/lint.ts:100-117`; ERS corpus inbound-edge analysis (template descriptors reachable only via relative markdown links + absolute SharePoint URLs) | Define edges in spec; shadow mode; per-Brain config |
| F4 | High | Structural role gate sits on a fail-open check and is bypassed by stdio/system principals — the very writer class that produced the loader pollution; NOW.md exemption leaves an equal-potency injection channel open | `src/services/request-context.ts:33-37`; `src/services/registry.ts:238-240` (stdio/system → owner on ALL brains) | Sequence after deny-by-default; store-layer allowlist; gate or sanitize NOW |
| F5 | High | Rollback-by-revision-restore doesn't work: the sync agent re-pushes slimmed content over a restore, hosted deletes historically don't propagate, and guarded-delete caps (5 files / 10%) block a full revert; ERS is under a standing P0 rename/delete freeze (A3-7) | `src/sync/local-sync-agent.ts:45-58`; ERS `state/README.md` tombstone; ERS NOW Thread 1 | Sync-aware scripted rollback runbook; ERS migration gated on spec-011 verified end-to-end hosted |
| F6 | Med | Loader slimming orphans the ~1,900-word ingestion protocol with no named destination, while the server's own instructions tell every client the loader is the protocol's single source of truth | live connector instructions; July review c-jem-schema.md:64 | Named destinations + same-release instruction update |
| F7 | Med | `reviewed_date` fix also writes the loader, falsifying "fix:true cannot modify `00_loader.md`"; lint requires write role even for detection | `src/services/lint-apply.ts:146-161`; `src/tools/lint.ts:50` | Enumerate all loader writers; allow read-only lint |
| F8 | Med | Per-Brain feature flag has no home — registry baked into the image; flipping = redeploy | `Dockerfile:31`, `fly.toml:18` | Spec the mechanism (typed field + env override) |
| F9 | Med | Unflagged Phase-2 lint/role changes ride the shared upstream tag into the ERS mirror before ERS content migrates | spec 012 mirror policy | Flag lint mode per Brain; pin ERS mirror until its Phase 3 |
| F10 | Med | `task` text in Phase-1 "routing reason" metrics collides with the metadata-only telemetry policy (no search-query text) | CLAUDE.md telemetry contract | One spec line: mechanism codes only in persisted telemetry |
| F11 | Low | ERS NOW slimming trips never-exercised JOURNAL/LOG rotation (LOG already 2× threshold) mid-onboarding | measured sizes (LOG.md 167.6 KB vs 80 KB threshold) | Rotate first; quiet-window scheduling |

**Lead-reviewer correction to the panel:** both the "compiled packets are cache-hostile" attack and the "fat bootstrap is cheap because cached" defense rest on an unverified premise — that MCP tool results occupy cross-session-stable cacheable prefix positions on the client surfaces in use. They generally do not (tool results land mid-conversation after session-specific content; caching is within-session). The robust residual facts: every session pays the bootstrap tokens at least once at full price; within-session re-reads are cached under *any* architecture; and the attention-quality cost of ~9.2k irrelevant tokens is asserted but unmeasured everywhere. Net: caching neither saves the fat loader nor kills the compiler — it drops out of the decision, which is why slimming (a pure win) and the compiler (an unmeasured bet) separate so cleanly.

## 8. Revised measurable acceptance criteria

Content/lint/roles release:

1. Bootstrap ≤ 2,500 tokens per Brain, enforced by lint; budget recorded in `docs/DECISIONS.md` as provisional. The 500–800-word loader figure is **infeasible** with JEM's nav table verbatim (~450–500 words alone); treat word budgets as lint targets, not gates.
2. Shadow-mode reachability lint produces zero false-positive orphans on both live corpora with the specced edge grammar (ERS template descriptors reachable; `governance/brain-mcp-fork-signoff.md` correctly flagged — it is a true orphan today).
3. No code path writes `00_loader.md` under `fix:true` — including `reviewed_date`.
4. Store-layer test: member write to the loader rejected; admin write accepted; unknown role string rejected (fail-closed).
5. Packet/routing evaluator runs against frozen fixtures and **production search code**, splitting policy-marker assertions (must survive anywhere in markdown — failures are real regressions) from signpost assertions (retargeted to route coverage).
6. Post-slim JEM golden set ≥ pre-slim baseline on the retargeted eval, with policy markers at 100%.
7. `brain_load_context({brain_id})` byte-identical behavior for existing callers.

Compiler-spec criteria (later, if triggered): one-call sufficiency ≥ the *measured* slim baseline + a margin; manifest lists inclusions *and* budget-exclusions/truncations; compiled p95 ≤ bootstrap+parallel-reads wall time under 20 concurrent callers.

## 9. Migration, compatibility, rollback — the sequencing chain

1. Revise spec 013 per §10; record decision + rejected alternatives in `docs/DECISIONS.md`.
2. **Instrument first:** structured search API → packet/routing evaluator + frozen fixtures → record fat-bootstrap baselines (both Brains).
3. **Server release A** (flagged, no default change): reachability lint in shadow mode; fix A removed; `reviewed_date` relocated; bootstrap-budget lint; search scoping/FTS.
4. **Authz:** P1 deny-by-default hardening → store-layer structural gate (loader + NOW decision made explicitly).
5. **JEM content migration:** rotate JOURNAL/LOG first; slim with named destinations; eval before/after; sync-aware rollback runbook (pause sync agent → tagged export of both sides → restore both sides → verify hashes → resume) replaces the spec's one-line "use revision history".
6. **ERS content migration** only after spec-011 delete/rename is verified end-to-end on hosted `ers-brain` (closing A3-7), the content-state audit lands, and onboarding has a quiet window; ERS mirror stays pinned to the pre-013 tag until done.
7. **Compiler decision point:** measure the residual gap; separate spec or explicit kill recorded in `docs/DECISIONS.md`.

## 10. Required spec revisions (the "revise" in the verdict)

1. Cut Phase 2 items 1–2 (task/max_tokens + compilation) into a successor spec with the trigger/kill criterion of §3.5.
2. Define the graph edge grammar and per-Brain edge config; add shadow-mode rollout.
3. Name destinations for every evicted loader block + same-release server-instruction update.
4. Enumerate all loader-writing fixes (`orphan_index` **and** `reviewed_date`); define member read-only lint.
5. Sequence the role gate after deny-by-default; specify store-layer, fail-closed enforcement; state the stdio/sync/SharePoint bypass honestly.
6. Resolve the NOW.md asymmetry (gate it or sanitize it — with the injection channel named).
7. Specify the flag mechanism (typed per-Brain field + env override; default legacy).
8. Replace the rollback line with the sync-aware runbook; add the two ERS preconditions (A3-7 verified, content audit).
9. Replace the 90% criterion with the instrumented criteria of §8; require the pure store-agnostic module for anything compiled.
10. Add one telemetry line: task/query text never persisted; mechanism codes only.

## 11. Verification appendix

**Deeply reviewed:** spec 013; specs 008–010; `src/` load/lint/lint-fix/lint-apply/update/request-context/registry/brain-store/active-brain-store/search-match/wikilinks paths; both loaders and NOW files (lead reads); evaluator + golden set; July review reports and retrieval research. **Sampled:** `05_projects.md`, ERS hubs/templates, sync agent, Dockerfile/fly.toml, cockpit fix surfaces, hosted-doctor telemetry. **Not reviewed:** OAuth/DCR internals, artifact store, Supabase migrations (out of scope).

**Material proof gaps** (none flip the verdict; each is bounded by a gate in §9): (a) attention/accuracy harm of the fat bootstrap — asserted by the spec, measured nowhere (static-only); (b) hosted latency figures rest on tiny samples (client e2e n=12, `load_context` n=1); (c) MCP tool-result caching behavior per client surface; (d) whether spec 011 fully closes A3-7 end-to-end on hosted `ers-brain` — inferred, and it gates ERS Phase 3; (e) client-surface heterogeneity (Codex/ChatGPT connector behavior under a changed loader) — flagged by the completeness critic, covered by no agent.

**Completion state:** Complete with material proof gaps. Read-only contract held during the review; this report is the only artifact added.

---

**Bottom line:** spec 013 diagnosed a real disease, prescribed the right content medicine, and bundled in an experimental device nobody has measured. Take the medicine, instrument the patient, and decide on the device with data. **Revise.**
