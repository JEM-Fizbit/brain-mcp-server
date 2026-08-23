# Spec 016 — JEM Acceptance Review

**Status:** complete — remediated and live-verified on JEM `v1.6.0`
**Started:** 2026-08-23
**Scope:** JEM Brain development pilot; ERS remains untouched
**Related:** [`../016-source-links-and-brain-library-pilot.md`](../016-source-links-and-brain-library-pilot.md)

Comments were recorded sequentially before John approved remediation. The
original observations remain below as evidence; the closure matrix records the
implemented outcome. ERS remains separately approval-gated.

## Remediation closure matrix

| Finding | Implemented JEM outcome | Verification |
|---|---|---|
| 1 | Full-width Maintenance layout; every compact fix row has an expandable complete proposal. | Unit/HTTP tests plus desktop and 390px browser checks pass. |
| 2 | Graph diagnostics grouped by meaning with status, owner, completion and representative paths; expected source-boundary findings are owned by the strict source audit. | Fresh JEM lint renders four primary findings separately from 278 grouped diagnostics. |
| 3 | Five primary-source declarations link directly to companions; 26 binary-paired companions link to the adjacent original. | Strict source audit: zero non-clickable declarations and zero missing original-artifact links. |
| 4 | Edge refreshed as durable orientation and linked to its live Dropbox workspace; public-site absence is explicit. | Strict semantic-destination audit passes. |
| 5 | NanoRenal/iHemo demoted from active prominence to dormant/cold with historical context preserved. | Hosted/local `04_active_roles.md` convergence verified. |
| 6 | Exact reviewed Markdown source reads return complete stored text; KRUK routing requires both source and `quanta.md` exception context. | Store regressions and 26/26 JEM routing eval pass; the deployed hosted read returns the complete companion and preserves binary privacy. |
| 7 | Complete corpus classified by freshness behavior; nine cadence-controlled areas reviewed and given owner/cadence/trigger controls; lint enforces semantic review date and declared cadence. | Priority pages no longer appear stale/bloated in fresh hosted lint. |

## Acceptance results

### Test 3 — Obsidian-to-hosted synchronization: PASS

John reports that Test 3 passed in full on 2026-08-23. The local Obsidian edit,
hosted visibility check, local removal, and hosted removal check all behaved as
specified in the acceptance plan. No remediation is indicated by this test.

### Test suite 4 — LLM retrieval: PASS after remediation

John reported that the original suite passed except for the KRUK
trustee-biography source retrieval described in Finding 6. Release `v1.6.0`
closed that exception: hosted retrieval now returns the complete reviewed
companion, search returns both the source and `quanta.md`, and the original
binary remains private.

## Finding 1 — Lint warning and unreadable mechanical-fix candidates

**Surface:** JEM Brain Monitor → maintenance/lint → safe mechanical fixes
**Evidence:** `Screenshot 2026-08-23 at 21.28.56.png`, supplied by John
**Status:** remediated and live-verified in JEM `v1.6.0`

### Observation

- JEM Brain Monitor warned that the Brain needs linting.
- Under `Archive Done items older than 30 days (5)`, each proposed item is
  truncated with an ellipsis.
- The available horizontal page width is not being used to expose the full
  candidate content.

### User impact

The user is expected to approve individual “safe mechanical fixes” but cannot
see enough of each item to make an informed approval decision. This weakens the
review gate even if the proposed transformation itself is mechanically safe.

### Direction suggested by John — not yet approved for implementation

- Make each candidate expandable, for example with an accordion/details
  structure; and/or
- use the available full-screen width more effectively.

### Acceptance expectation to assess during triage

Every proposed mechanical fix should be inspectable in full before selection
or approval, while retaining a compact overview of the candidate list. The
specific interaction and layout remain to be decided.

## Finding 2 — Review-only graph diagnostics do not explain the user's action

**Surface:** JEM Brain Monitor → maintenance/lint → graph diagnostics
**Evidence:** `Screenshot 2026-08-23 at 21.31.54.png`, supplied by John
**Status:** remediated and live-verified in JEM `v1.6.0`

### Observation

- The surface reports `270 graph edge diagnostic(s) require review` with the
  breakdown `parent_link_disabled: 116`, `unresolved_target: 93`,
  `missing_directory_index: 43`, and `path_escape: 18`.
- It says the diagnostics are grouped and never auto-fixed, but does not tell
  the user what review is expected, which items are likely intentional, who
  owns the review, or what completion looks like.
- The top-level JEM lint warning therefore presents a large review-only queue
  as an action for the user without giving the user an executable next step.

### User impact

The operator cannot tell whether the Brain is unhealthy, whether 270 links need
manual repair, or whether the message is informational. This makes the warning
both alarming and non-actionable.

### Acceptance expectation to assess during triage

- Separate safe user-actionable fixes from review-only diagnostics and genuine
  broken-link failures.
- Explain in plain language what each diagnostic class means, whether it is
  expected under the current Brain/source boundary, and what—if anything—the
  operator should do.
- Do not make the overall Brain appear to require user maintenance solely
  because a bounded diagnostic set is awaiting expert triage.
- Provide an explicit owner and completion path for any review that really is
  required.

## Finding 3 — Primary-source labels are not direct links to evidence

**Surface:** JEM Brain content in Obsidian; extracted-fact reference files
**Example:** `> **Sources:** CV (FINAL), Resume (FINAL)`
**Status:** remediated and live-verified in JEM `v1.6.0`

### Observation

- General Brain navigation in Obsidian passes.
- The five extracted/reference files with a top-level `> **Sources:**` block
  list their primary evidence as plain-text labels rather than hyperlinks.
- Some of the corresponding source-companion and original-binary links exist
  elsewhere, especially in `SOURCES.md` and lower source lists, but the user
  cannot navigate directly from the prominent provenance declaration.
- The CV companion itself identifies its original as plain text even though the
  ingested PDF exists beside it under `sources/cv/`.

### Design assessment

This is not the intended full-traceability end state. Spec 015 established a
two-layer source contract—Brain synthesis to reviewed Markdown companion, then
companion to the original artifact or provider locator—but the legacy backfill
completed the reviewed Brain/companion relationships without rewriting these
legacy source headers or adding original-artifact links to every companion.

### User impact

The user sees a provenance claim but must search an index or infer filenames to
open the evidence. That fails the intended click-to-navigate human surface even
where the source is correctly ingested and machine traceability exists.

### Acceptance expectation to assess during triage

- Each named primary source in a synthesis-level provenance block should link
  directly to its reviewed Markdown companion.
- Each companion should offer a plainly labelled link to the ingested original
  binary when one exists.
- When the authoritative original remains in Dropbox or another provider, use
  its reviewed HTTPS web locator when available; do not create sharing or make
  a private file public.
- Retain provider id/revision and registered local-root identity for LLM and
  Brain Library resolution without embedding machine-specific absolute paths
  or `file://` URLs in canonical Markdown.
- Avoid forcing the user through `SOURCES.md` merely to reach evidence already
  named on the page being read.

## Finding 4 — Edge Brain context is stale against its live Dropbox project

**Surface:** JEM Brain → `edge_biotech.md`
**Status:** remediated and live-verified in JEM `v1.6.0`

### Observation from John

- The Edge Brain page needs a refresh against the live Edge project folder in
  Dropbox.
- The Brain page should include a direct human-usable link to that canonical
  project folder.

### Acceptance expectation to assess during triage

- Identify and review the authoritative live Edge Dropbox folder before making
  content changes.
- Keep the Brain page as durable orientation rather than duplicating volatile
  project work, while refreshing stable facts that have drifted.
- Add a reviewed, clickable destination to the live project folder without
  changing Dropbox sharing or exposing a private location publicly.
- Make the canonical/live-project boundary obvious to both humans and LLMs.

## Finding 5 — NanoRenal/iHemo is stale and over-prominent as an active role

**Surface:** JEM Brain → `04_active_roles.md`
**User wording:** “neorenal/ihemo has gone cold”
**Likely existing entity label:** NanoRenal, formerly iHemo
**Status:** remediated and live-verified in JEM `v1.6.0`

### Observation from John

The relationship/opportunity has gone cold and should not retain its current
prominent placement among active roles.

### Acceptance expectation to assess during triage

- Confirm the intended current lifecycle label with John before editing.
- Remove or demote the item from active-role prominence without erasing useful
  historical context or provenance.
- Represent its current status explicitly—for example dormant, historical, or
  no longer active—using the Brain's established lifecycle conventions rather
  than leaving the reader to infer status from placement.

## Finding 6 — Hosted source retrieval stopped at metadata/opening text and missed an authority conflict

**Surface:** JEM Brain integration; source retrieval and synthesis
**Prompt:** `Find my Kidney Research UK trustee biography. Show me the source and the relevant Brain context.`
**Status:** remediated and live-verified in JEM `v1.6.0`

### Observed response

- The integration identified
  `sources/bios/2026-04-15_kruk_trustee_bio.md` and its relationship to
  `01_identity.md`.
- It said the full text was not retrievable through the hosted read path and
  returned only metadata plus the opening paragraph.
- It attributed the limitation to original bytes being withheld pending a
  download/signed-URL policy, conflating access to the reviewed Markdown
  companion with access to the private original binary.
- The returned paragraph described John as a Quanta “co-founder” but did not
  surface the relevant `quanta.md` guardrail: that wording is a documented
  one-artifact exception for the already-published KRUK bio and must not be
  generalized into new writing.

### User impact

The integration found the right source but failed the requested evidence read,
then omitted the Brain context that constrains reuse of a potentially
contentious phrase. This weakens both source traceability and the Brain's
authority hierarchy.

### Acceptance expectation to assess during triage

- A hosted read of a reviewed Markdown source companion should return its full
  permitted text independently of whether original binary bytes are withheld.
- The response should distinguish companion text, original-artifact metadata,
  and original binary access rather than describing them as one limitation.
- When source wording is governed by a documented, artifact-specific exception,
  the response should explain the exception and must not generalize that wording
  into new content.
- The answer should provide the source link and relevant Brain context, not
  stop after source-list metadata or a search excerpt.
- Triage should determine whether the failure came from tool selection, tool
  output, connector behavior, or model interpretation before any fix is chosen.

### Read-only verification — 2026-08-23

- A direct hosted `brain_read_file` call with `scope="sources"` returned only a
  generated source manifest and the explicit note that hosted source reads are
  metadata-only.
- The complete 1,968-byte reviewed Markdown companion exists locally and its
  extracted text is searchable through the hosted source-text index.
- The public tool schema tells clients that `scope="sources"` reads original
  ingested material and specifically gives the full KRUK bio as an example.
- The failure is therefore a confirmed hosted backend/tool-contract mismatch,
  not merely a model choosing the wrong tool. The search excerpt and metadata
  read are two incomplete surfaces over content that is already stored.

### Post-release verification — JEM `v1.6.0`

- The public health endpoint reports `brain-mcp-server` `1.6.0`, Postgres
  revisions, Supabase artifacts in metadata-only byte mode, and Postgres OAuth
  state.
- The exact hosted KRUK source read returns the complete 1,963-character tool
  text corresponding to the 1,968-byte reviewed Markdown companion, rather
  than a generated manifest.
- An exact binary-source read still returns the metadata manifest and states
  that original bytes remain private.
- Search for `KRUK Trustee Bio` returns both
  `sources/bios/2026-04-15_kruk_trustee_bio.md` and `quanta.md`; the latter
  preserves the artifact-specific founder-wording exception.
- Hosted sync reports 39 files and zero open conflicts. Hosted lint reports no
  priority-page stale or bloat findings; its remaining 282 items are three
  graph-unreachable notes, 278 grouped edge diagnostics, and one bounded
  capture-queue finding.

## Finding 7 — Brain content needs a systematic freshness review and maintenance model

**Surface:** JEM Brain corpus; example `05_projects.md`
**Status:** remediated and live-verified in JEM `v1.6.0`

### Observation from John

- Brain content staleness needs a systematic, corpus-wide review rather than
  correction only when an outdated claim is noticed during use.
- `05_projects.md` is a clear example and is woefully out of date.
- The review must also decide how time-sensitive Brain content will be kept
  current in future.

### User impact

An apparently authoritative Brain page can route an LLM or human toward stale
projects, statuses, priorities, or work surfaces. Opportunistic corrections do
not provide confidence that the rest of the corpus is current or that drift
will be detected before it affects an answer.

### Acceptance expectation to assess during triage

- Inventory the corpus by freshness class: stable knowledge, periodically
  reviewed context, and time-sensitive routing/status content.
- Review each time-sensitive file against its current canonical source, with
  `05_projects.md` as an explicit priority.
- Ensure project pages point to the owning repository, tracker, or workspace
  for live state; the Brain should retain durable orientation and settled
  context rather than duplicate volatile plans.
- Record a meaningful last-reviewed state, review owner, expected cadence, and
  refresh trigger for content that can become stale.
- Design proactive maintenance that surfaces a bounded, actionable review queue
  without automatically making semantic edits or presenting advisory findings
  as user-actionable failures.
- Define how project lifecycle changes, substantive ingestion, and scheduled
  maintenance cause freshness review, and what evidence closes each review.

### Review collection close

John stated that this was the final observation in the JEM acceptance pass and
subsequently approved the complete remediation. The closure matrix above is the
current status; ERS replay remains out of scope until separately approved.
