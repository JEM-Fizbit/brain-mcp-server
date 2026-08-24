# Brain Content Linking, Source Trace And Freshness Runbook

**Status:** active — JEM pilot completed; approved ERS replay in progress
**Last reviewed:** 2026-08-24
**Related:** [Spec 013](specs/013-brain-context-architecture.md); [Spec 015](specs/015-compiled-source-ingestion.md); [Spec 016](specs/016-source-links-and-brain-library-pilot.md); [Brain Library](brain-library.md); [JEM freshness register](jem-brain-freshness-register.md)

This runbook preserves the complete linking remediation so it can be replayed
for another Brain without rediscovering the distinction between graph
reachability, evidence linkage and external semantic destinations. It records
the JEM sequence; `ers-brain` remains a separately approved rollout with its own
content authority, credentials, snapshots and hosted write path.

## Outcomes

A completed rollout provides six independent guarantees:

1. **Internal reachability:** important Brain content is reachable from the
   loader or a named hub.
2. **Direct evidence linkage:** a synthesis points directly to each reviewed
   source companion it relies on, and the companion links back.
3. **Human navigation:** file references and canonical web destinations are
   ordinary Markdown hyperlinks that work in Obsidian, Brain Library and normal
   Markdown viewers.
4. **Semantic destination completeness:** an entity hub identifies its current
   official website, authoritative historical evidence, or an explicit
   no-verified-public-website state.
5. **Freshness accountability:** volatile content names its review date, owner,
   cadence, event trigger and live authority; lint uses that review date and
   cadence instead of treating a mechanical file modification as semantic review.
6. **Actionable maintenance ownership:** the operator sees only mechanical
   approvals and bounded content decisions; technical graph/source telemetry is
   classified automatically and retained for maintainers without becoming a
   manual review queue.

Passing one guarantee does not imply the others. In particular, zero broken
internal links does not prove that an entity has an official website link.

## Non-negotiable rules

- Markdown remains canonical. Use ordinary `[label](target)` links for portable
  human navigation and `[[wikilinks]]` for Brain navigation where appropriate.
- Relationships are reviewed facts. Audits may identify candidates; automation
  may format an approved declaration; neither may invent semantic links.
- A distant route through an index does not count as direct evidence linkage.
- Do not invent a homepage for a private, pre-launch, renamed or defunct entity.
  Record the lifecycle state and link authoritative evidence instead.
- An external HTTP success or failure is advisory. Redirects, bot protection and
  temporary outages do not establish identity by themselves.
- Source identity and entity identity are distinct. Spec 015 `external_url`
  identifies a source artifact's web locator; it does not satisfy an entity
  hub's official-destination obligation.
- This work does not activate the Spec 014 task-context compiler.
- A reviewed Markdown companion and its original binary are separate access
  surfaces. Hosted reads may return the complete stored Markdown text while the
  original binary remains private and metadata-only.

## Destination contract

Every file whose descriptor begins `> Entity page` contains a
`## Canonical destinations` section near the top. Use one of these reviewed
patterns.

Current public entity:

```markdown
## Canonical destinations

- **Official website:** [Entity name](https://example.com/)
- **Destination status:** Current official website; verified DD Month YYYY.
```

Historical or renamed entity:

```markdown
## Canonical destinations

- **Entity status:** Historical; no current standalone website.
- **Successor evidence:** [Authoritative filing or announcement](https://example.com/evidence)
- **Destination status:** Historical evidence verified DD Month YYYY; do not infer a current homepage.
```

Private or pre-launch entity:

```markdown
## Canonical destinations

- **Website status:** No verified public website as of DD Month YYYY.
- **Related authoritative context:** [Sponsor or primary public source](https://example.com/)
```

Record ambiguous entity/product aliases explicitly and leave the established
fact unchanged until a human resolves it.

## Phase 0 — Authority, safety and baseline

1. Load the target Brain with its explicit `brain_id`, then read its operations
   guide. Before any ingestion-related write, call `brain_prepare_ingest` and
   follow the backend/category contract it returns. A hosted Postgres result is
   not permission to invent a Fly-local source tree or treat `brain_scan_inbox`
   as evidence about the operator-side inbox.
2. Confirm hosted sync is healthy and open conflicts are zero. Do not write if
   either condition fails.
3. Confirm the target Brain's canonical content owner and source archive. Never
   mix JEM and ERS credentials, data, snapshots or write tools.
4. For a coordinated multi-file migration, avoid concurrent local editing and
   take a revision-aware hosted snapshot plus a local mirror/state snapshot.
   Pause the target sync watcher for a bulk change when practical, and leave
   every other Brain's watcher running. Consolidate all intended edits to one
   file into one reviewed hosted replacement rather than a rapid series of
   patches that the watcher can observe between revisions.
5. Preserve byte-level file identity, including the presence or absence of a
   terminal newline. Sync compares content hashes, not semantic equivalence.
6. Record the baseline counts from:

```bash
npm run sources:audit-links -- --brain-root <brain-repo-root>
npm run brain:audit:destinations -- --brain-root <brain-repo-root>
```

Retain the report, target Brain id, hosted cursor, conflict count and snapshot
location in the rollout evidence.

## Phase 1 — Source-link remediation

This is the earlier JEM remediation sequence and must not be skipped when it has
not already been completed for the target Brain.

1. Inventory all Brain Markdown files and source companions. Treat
   source-folder `README.md` and `INDEX.md` files as navigation indexes, not
   evidence companions requiring direct synthesis links and backlinks.
2. Classify each companion as directly linked, index-only or unlinked.
3. Identify missing companion backlinks, broken paths and code-formatted
   non-clickable source references.
4. Review every proposed Brain-to-source relationship against the companion and
   existing Brain claims. Reject plausible but unsupported associations.
5. Add direct portable Markdown links from substantive synthesis files and an
   explicit `## Brain links` declaration in each companion.
6. Convert prominent primary-source declarations into direct links to the
   reviewed companions. When an adjacent ingested original exists, add a plainly
   labelled `## Original artifact` relative link in the companion. Prefer an
   already-reviewed provider HTTPS locator for an external authority; never
   create sharing or embed a machine-specific `file://` URL.
7. Compile/persist the Spec 015 source-reference manifest where that Brain uses
   the compiled source registry. Backfill only reviewed relationships, then
   prove repeat application is idempotent and stored artifact hashes still
   match their content-addressed paths.
8. When companion Markdown changes without changing its original binary, use
   the project-ref-guarded companion refresh with an explicit Brain id.
   `pointer_text` versions the exact reviewed Markdown in
   `brain.source_artifact_text` through the owner-only Monitor database profile;
   `storage` additionally requires the explicit admin-only Storage credential.
   Apply mode requires an expected project reference and rejects a database URL
   for any other project. Retain prior artifacts as snapshots.
9. Run the source-link audit in strict mode and require zero index-only,
   unlinked, missing-backlink, broken and non-clickable source-reference
   findings, including primary-source declarations and original-artifact links.

## Phase 2 — Semantic-destination remediation

1. Inventory entity hubs, active organisations, current roles, projects,
   opportunities and repeated named entities.
2. Inventory external URL occurrences in Brain content and source companions.
   Treat domains present only in sources as review candidates, not automatic
   promotion instructions.
3. For each entity hub, verify the identity against a primary source and add the
   destination contract above.
4. Promote high-value canonical URLs already present in reviewed sources into
   the appropriate hub. Preserve claim-specific citations in the source layer.
5. At the point of use, either link the official destination directly or link a
   nearby entity hub that satisfies the destination contract. Do not rely on a
   distant graph path for a current role or central opportunity.
6. Convert bare URLs in active Brain content into ordinary Markdown links.
   Bare URLs inside source companions remain advisory because some companions
   preserve source text; normalize companion-owned metadata during reviewed
   ingestion, but do not rewrite quoted source bodies mechanically.
7. Record unresolved aliases, private-site absences and lifecycle transitions
   explicitly instead of guessing.

## Phase 2B — Freshness review

1. Classify the complete corpus as cadence-controlled, event-reviewed durable,
   operational/structural, queue/state, or append/rotation content.
2. Prioritize current projects, roles, priorities, opportunities, tools and
   canonical routing. Compare them with the owning repository, tracker or cloud
   workspace; do not infer live state from an old Brain page.
3. Keep durable orientation and settled facts in Brain. Route actions, volatile
   plans and current delivery state to the first-class project home.
4. Add `Last reviewed`, `Review owner`, and `Review cadence` to content that can
   become misleading. Include event triggers in the cadence sentence.
5. Treat an explicit review date as semantic authority. A sync, formatting or
   hyperlink edit must not reset it. Lint enforces a supported declared cadence
   before the filename-tier fallback.
6. Close a review only after strict link/destination audits, routing regressions,
   hosted lint and zero-conflict convergence pass.

## Phase 2C — Graph diagnostic classification and repair

Run graph-primary lint and retain the complete edge telemetry, then classify by
syntax and ownership before changing content:

1. Treat unresolved ordinary Markdown links and wikilinks as genuine internal
   repair candidates. Verify each destination and repair or remove the stale
   relationship; do not invent a node merely to clear lint.
2. Treat `brain/` links into `sources/` as a repository boundary, not a broken
   Brain node. Close that class automatically only when the strict source-link
   audit passes.
3. Treat absolute/parent-relative machine locators and backtick project, file
   and directory references as external/reference telemetry. Preserve them for
   LLM routing unless a reviewed portable hyperlink is available; do not ask
   the operator to adjudicate them item by item.
4. Ignore link syntax shown only inside inline or fenced code examples.
5. Re-run lint after content repair. Require zero genuine broken internal links;
   classified locators may remain and must be reported outside the maintenance
   finding total.

In Cockpit, keep technical groups collapsed with their status, owner,
completion criterion and representative paths. Only safe mechanical fixes and
explicitly labelled content-triage decisions may create an operator warning.

## Phase 3 — Regression gates

Add deterministic routing cases for important real incidents. A destination
case should require the expected hub, search hit, exact Markdown destination and
lifecycle marker. At minimum, cover:

- a current public entity and its official website;
- a historical entity and authoritative successor evidence;
- a private/pre-launch entity with an explicit no-verified-site state; and
- a known company/product alias ambiguity.

Run:

```bash
npm run build
node --test test/semantic-destination.test.mjs test/source-reference.test.mjs test/brain-routing-eval.test.mjs test/brain-routing-golden.test.mjs
npm run sources:audit-links -- --brain-root <brain-repo-root> --strict
npm run brain:audit:destinations -- --brain-root <brain-repo-root> --strict
npm run eval:brain:routing -- --brain-id ai-brain-jem --registry <jem-registry> --jem-dir <jem-repo-root>/brain
# For ERS, use the private ERS registry and --ers-dir instead.
npm test
git diff --check
```

Then run hosted `brain_lint`, re-read the changed hubs through the target hosted
Brain, and verify sync returns to zero conflicts. Inspect representative links
in Obsidian, a normal Markdown viewer and Brain Library. Confirm external links
open as web destinations and internal/source links stay inside the intended
Brain.

For hosted source retrieval, read an exact reviewed `.md` companion through
`brain_read_file(scope="sources")` and require its complete stored text. Read a
binary/pointer path separately and require metadata-only behavior. For a source
with an authority exception, require the routing case to retrieve both the
source path and the governing Brain context.

In Cockpit Maintenance, refresh lint and verify that graph diagnostics are
grouped by class with plain-language status, owner and completion criteria.
Only safe mechanical changes belong under **Actions You Can Approve**, and each
candidate must expose its full proposed change before selection.

If lint reports a `TASKS.md` Capture / Triage decision, verify that Cockpit
states the open count as the total queue and stale as its age-based subset. The
recommended copyable LLM handoff must be proposal-first: classify every item to
the canonical personal task list, owning project tracker, ERS Asana, audit
backlog, or an evidenced closure, then stop for approval before writing. The
manual Obsidian alternative is valid, but a Capture item is marked transferred
only after its destination is actually updated. Leave inaccessible destinations
open with an exact handoff, then re-read `TASKS.md` and rerun lint. Never copy
JEM item classifications into ERS; repeat the review against the live ERS queue
and owners during the separately approved replay.

## JEM pilot evidence — 2026-08-22

The source-link baseline began with 39 Brain Markdown files and 45 source
companions: two companions were directly linked, 43 were unlinked, 35 lacked a
backlink, three links were broken and 66 source references were non-clickable.
After human review, all 45 companions were directly linked with reciprocal
backlinks and the strict source audit reported zero remaining findings. The
personal source registry recorded 45 companion paths and 46 reviewed
source-to-Brain relationships; repeat persistence was idempotent and all 41
stored companion artifacts retained their content-addressed hash identity.

The semantic audit then found five entity hubs with no canonical-destination
section and 19 bare URLs in active Brain content. It also exposed source-to-hub
promotion gaps for Quanta, ERS and Celox, an outdated Northern Venture Trust
destination, and a possible Nextkidney/Neokidney company-product conflation.
The JEM correction added explicit current, historical or unavailable status to
all five entity hubs, promoted the high-confidence destinations, corrected the
stale links, localized current-role links and converted all active-content bare
URLs. The Nextkidney/Neokidney issue remains explicitly marked for John rather
than silently rewritten. Bare URLs inside source companions remain an advisory
ingestion-maintenance queue, not a strict Brain-content failure.

The first JEM write batch also supplied a sync lesson for the ERS replay. Five
rapid hosted patches to `04_active_roles.md` were observed by the live local
watcher between revisions, creating duplicate conflicts against the same stale
local base. Resolving those records before the local bytes matched generated a
second duplicate set; the final one-byte difference was only a terminal newline.
The repair paused only the JEM watcher, replaced the local file with the exact
reviewed hosted bytes, resolved the duplicate records, resumed the watcher and
verified a healthy cycle with zero open conflicts. No content was lost and ERS
was untouched. Future bulk passes should pause the target watcher first,
consolidate per-file edits and verify exact hashes before resolving conflicts.

## ERS replay baseline — 2026-08-24

After the ERS schema migration, clean security gate and guarded `v1.7.0`
deployment, live checks reported one accessible Brain (`ers-brain`), 51 hosted
files, zero open conflicts, foreign-JEM denial and a correct seven-category
Postgres ingestion preflight. The first local report found 51 Brain Markdown
files and 39 evidence companions after excluding ten source navigation indexes:
16 were directly linked, 23 were unlinked, 38 lacked reciprocal Brain-link
declarations, 17 same-stem binaries lacked original-artifact links, 57 source
references were non-clickable, and four active Brain URLs were bare. No links
were broken. This baseline is evidence for the approved remediation, not a
manual user-review queue; semantic relationships still require source-backed
review before application.

## JEM acceptance remediation — 2026-08-23

- The strict source audit now covers all 45 companions and reports 45 directly
  linked, zero index-only/unlinked/missing-backlink/broken/non-clickable items,
  and zero companions missing an original-artifact link. Five prominent
  primary-source declarations are direct links; 26 same-stem binary companions
  now link to their adjacent ingested originals.
- The 26 changed companions were refreshed only in personal project
  `gfipcidoyrtgngauzijy` through the owner-only Monitor profile. The first plan
  reported 26 `refresh_required`; apply created exact hashed `pointer_text`
  artifacts with prior active versions retained as snapshots; the repeat plan
  reported 26 `unchanged`. No ERS credential, schema, content or deployment was
  touched.
- The complete 39-file corpus received a freshness classification. Nine
  cadence-controlled areas record a review date, owner, cadence and trigger;
  priority projects/roles/next-chapter/Edge/NOW content was refreshed against
  its current authority. Lint gives the declared cadence precedence over file
  modification time and no longer reports the priority pages stale or bloated.
- Cockpit Maintenance uses the full content width, groups high-volume graph
  diagnostics into plain-language ownership/completion classes, labels the
  bounded mechanical queue **Actions You Can Approve**, and gives every item an
  expandable full proposed change. Desktop and 390px checks passed.
- The follow-up edge audit classified 261 source/workspace/project references
  outside the operator total, repaired 16 genuine stale links into the
  retired JEM ERS fallback mirror, and removed two inline-code false positives.
  Fresh graph lint reports zero broken internal links, four maintenance
  findings (three maintainer-owned unreachable notes and one bounded capture
  queue decision), and the strict 45-companion source audit still passes. JEM
  `v1.6.1` deployed this ownership model on 24 August 2026; hosted health, lint,
  sync and the desktop/390px Cockpit surface passed while ERS remained
  untouched.
- Capture-queue warnings now include a proposal-first LLM handoff and an exact
  Obsidian alternative. The surface explains that open is the total queue and
  stale is its seven-day subset; it never auto-routes or auto-closes items.
- The JEM workflow was successfully used on 24 August 2026: all 13 Capture /
  Triage items were routed or closed and hosted lint no longer reports an
  operator decision. The follow-up also restored session-start maintenance
  nudges on the active-store context path and placed the prompt's Copy control
  at its upper-right point of use. Replay must verify both detection and
  completion against ERS's own live queue rather than copying JEM dispositions.
- The observed KRUK prompt is a routing regression requiring both `SOURCES.md`
  and `quanta.md`; the 26-case JEM routing suite passes. The hosted release gate
  passed on JEM `v1.6.0`: the hosted tool returns the complete reviewed
  companion, exact search exposes both routes, and binary bytes remain private.

## ERS replay gate

Do not copy JEM URLs or classifications into `ers-brain`. When John separately
approves the ERS pass:

1. Use only the dedicated ERS hosted connector, local mirror, snapshot and
   credentials.
2. Run Phases 0–3 against the ERS content and source taxonomy as it exists then.
   Include Phase 2B and the hosted reviewed-Markdown read gate.
3. Produce an ERS-specific review matrix before writes: current destinations,
   historical/successor destinations, explicit unavailable states, ambiguous
   identities and source-promotion candidates.
4. Obtain human decisions for ambiguous company/product/person aliases and any
   destination whose public status affects company positioning.
5. Apply revision-tracked ERS writes in a quiet window, then prove local/hosted
   convergence, zero conflicts, strict audit results and routing regressions.
6. Keep any private deployment commands, internal URLs or ERS-only operational
   details in the private ERS mirror's runbook; this public runbook remains
   tenant-neutral.

## Rollback

On a wrong relationship, content regression or conflict:

1. Stop further writes and pause the affected sync watcher if divergence is
   present.
2. Restore only the affected hosted revisions and matching local files from the
   pre-change snapshot.
3. Verify file hashes and resolve/supersede conflicts explicitly; never overwrite
   a conflicting side blindly.
4. Re-run both strict audits, routing evals, hosted lint and sync-status checks.
5. Record what was reverted and why before resuming the watcher.
