# 016 — Source-Link Maintenance And JEM Brain Library Pilot

**Status:** implemented — JEM development pilot (2026-08-22)
**Source:** John-approved implementation plan, 2026-08-22
**Roadmap link:** `BACKLOG.md` polished human reading UX, JEM-first pilot slice
**Decisions impact:** keeps Brain Library separate from Brain Cockpit
**Related:** [`015-compiled-source-ingestion.md`](015-compiled-source-ingestion.md); [`006-brain-sync-architecture-simplification.md`](006-brain-sync-architecture-simplification.md); [`007-brain-cockpit-ux-redesign.md`](007-brain-cockpit-ux-redesign.md)

## Problem

The Brain graph is broadly reachable, but source navigation is thin. Many source
references are code spans rather than hyperlinks, some links from `brain/` to
`sources/` use the wrong relative depth, source companions often lack backlinks,
and there is no deterministic audit for claim-to-source coverage or safe local
artifact resolution.

The operator Cockpit is deliberately a health and maintenance surface. Human
content reading needs a separate read-only Brain Library that consumes the same
Markdown and source-reference contract without turning Cockpit into a wiki.

## Acceptance criteria

- Audit ordinary Markdown links across `brain/` and `sources/`, classifying
  valid internal links, broken targets, code-span source references, companions
  without reviewed Brain backlinks and Brain files with source references that
  are not clickable.
- Report direct source coverage separately from graph reachability. A distant
  route through an index must not count as direct evidence linkage.
- Provide deterministic fix suggestions for syntax/path corrections, but never
  invent a semantic backlink or relationship.
- Render a JEM-only, read-only Brain Library with a separate product shell from
  Cockpit: Brain navigation, source companion rendering, provenance details,
  human source links and an LLM trace view.
- Resolve local artifacts only by registered artifact id plus root alias and
  safe relative path. Reject traversal, unknown ids, non-allowlisted roots and
  non-loopback requests.
- Opening a local artifact is disabled by default and requires an explicit local
  runtime flag plus same-origin nonce-protected POST. Dropbox/web navigation is
  an ordinary HTTPS link and never creates or changes sharing.
- The Library works at desktop and 390px, in light and dark modes, without
  horizontal overflow. It does not expose Brain editing or hosted admin actions.
- JEM is the only live pilot. ERS remains untouched.

## Out of scope

- General Brain editing, conflict resolution, source ingestion or admin actions
  in the Library.
- Adding content-reading tabs to Brain Cockpit.
- Automatic semantic cross-link creation.
- A hosted multi-user Library, authentication or ERS colleague rollout.
- Spec 014 activation.

## Technical constraints

- Use standard Markdown links for portable human navigation. Obsidian wikilinks
  remain readable, but generated source links must not require Obsidian.
- Raw HTML and scripts inside Brain Markdown are untrusted and must not execute.
- The Library may reuse local process/config plumbing, but it has a separate URL,
  navigation and product identity from Cockpit.
- The audit is read-only by default. Any apply mode must be explicit, atomic and
  limited to deterministic syntax/path fixes.
- Source companions and original artifacts may sit outside `brain/`; the audit
  therefore operates on the repository root, not only hosted Brain files.

## Test plan

- Unit tests for Markdown/source reference extraction, direct-link coverage,
  broken-link classification, backlink checks and deterministic suggestions.
- Resolver tests for valid registered paths, unknown ids, absolute paths,
  traversal, symlink/root escape and unsafe web URLs.
- HTTP tests for loopback Host validation, nonce requirement, read-only routes
  and default-disabled local opening.
- Playwright verification of JEM fixture navigation, source details, LLM trace,
  external link attributes, light/dark rendering and 390px layout.
- Run the read-only audit against the local JEM mirror and retain the before/after
  counts in the closeout evidence.

## Data files touched

- No ERS data.
- JEM Markdown only for reviewed deterministic hyperlink/path fixes and the
  approved non-sensitive pilot companion.

## Verification commands

- `npm run build`
- focused `node --test` link-audit, resolver and Library HTTP tests
- `npm run test:brain-library:e2e`
- `npm test`
- `git diff --check`

## Assumptions

- The initial Library is a development/pilot surface and may be started manually
  rather than installed as another login item.
- Obsidian remains the advanced graph/editing surface during the pilot.

## JEM pilot evidence

- Initial local audit: 39 Brain Markdown files, 45 source companions, two
  directly linked companions, 43 unlinked companions, 35 companions without a
  backlink, three broken links, and 66 non-clickable source references.
- After the reviewed deterministic fixes and canary backlink: six directly
  linked companions, 39 unlinked companions, 35 without a backlink, zero
  broken links, and 63 non-clickable references. The remaining findings are a
  measured maintenance queue; no semantic relationship was invented.
- The approved content/semantic pass reviewed that queue against the companions
  and existing Brain claims. The final repository-wide audit reports all 45
  companions directly linked, zero index-only or unlinked companions, zero
  companions without backlinks, zero broken links, and zero non-clickable
  source references. Each companion now has an explicit `## Brain links`
  declaration, and every relationship remains human-reviewed rather than
  inferred by the compiler.
- The same declarations were transactionally backfilled into the personal JEM
  Postgres source registry: 74 sources, 74 artifacts, 45 companion paths, and 46
  reviewed source-to-Brain relationships (45 backfill-owned plus the original
  compiler-owned canary). A repeat dry run found all 45 source ids and an
  idempotent repeat apply created none. Immutable Storage identity was verified
  after the backfill for every stored companion artifact: 41 of 41 hashes match
  their content-addressed Storage paths, with zero mismatches. No source bytes
  were uploaded by the backfill.
- Live JEM search spot checks now resolve document-led queries to source
  companions and concept-led queries to the relevant Brain synthesis; exact
  source-title queries expose both sides of the relationship. This is useful
  pilot evidence but is not a representative session-frequency baseline for
  spec 014.
- The real JEM companion was exercised in the local Library with reciprocal
  Brain navigation, HTTPS Dropbox navigation, exact provider/revision/hash and
  local-locator trace data, and local opening disabled.
- Playwright passed desktop light/dark navigation and 390px layout without
  horizontal overflow. Unit/HTTP tests cover untrusted Markdown, loopback Host
  checks, artifact containment, unknown ids, traversal/symlink escape, nonce
  enforcement, and default-disabled local opening.
- The Brain Library remains a manually started, local-only development pilot;
  it was not added to Cockpit, installed as another login item, hosted, or
  exposed to ERS. The supporting source-manifest/runtime implementation shipped
  to personal JEM in `v1.5.0` (`379b965`).
- Hosted lint remains deliberately confined to the `brain/` namespace, so it
  reports repository-parent source hyperlinks as `parent_link_disabled` edge
  diagnostics. Those diagnostics are not broken-link findings; the strict
  repository-wide source-link audit validates the `brain/` to `sources/`
  boundary. ERS content, schema, credentials, and deployment remain unchanged.
