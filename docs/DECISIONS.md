# Working Decisions Log

> Locked design decisions for this project, with rationale. Append-only — when a decision is reversed, add a new entry referencing the prior one. Do not delete history.

Each entry captures: **what was decided**, **why** (the constraint or insight), **when**, and **what alternatives were rejected**. This is the durable answer to "why did we do it this way?" months from now.

Format: newest entries at the top.

---

## 2026-08-28 — Reconcile Entra roles from the fixed managed groups

**Decision:** The ERS access-administration surface reads direct membership from
the four allowlisted Brain role groups and maps those member object IDs back to
the private grant ledger. It does not enumerate each target user's directory
memberships. One bounded reconciliation load reads each fixed group once, even
when several grants are displayed. GitHub fallback grants remain visible but
are explicitly outside Graph drift reconciliation.

**Why:** The first live Entra Owner canary proved the certificate-backed admin
login but exposed that `/users/{id}/memberOf` requires a broader delegated read
permission for other users. The already-consented `GroupMember.ReadWrite.All`
permission can read the dedicated groups it manages. Querying that fixed set is
the narrower authority boundary, avoids another tenant-consent request and
keeps reconciliation proportional to four small groups rather than to the
number of users.

**Alternatives rejected:** add `User.Read.All`, `GroupMember.Read.All` or
`Directory.Read.All`; accept `unavailable` drift for non-current users; trust
mutable token group claims; query transitive membership; or make a Graph call
for every grant/group pair.

**Related:** `src/admin/entra-graph.ts`; `src/admin/access-service.ts`;
`docs/ers-entra-access-runbook.md`;
`docs/specs/018-ers-production-identity-and-rollout.md`.

---

## 2026-08-26 — Fail visibly on heartbeat fallback and retire obsolete heartbeat events

**Decision:** A current legacy `sync_heartbeat` event proves local-sync
liveness but is not a healthy long-term observability configuration. If
`brain.sync_heartbeats` is missing, the doctor must return an actionable warning
that names `2026-08-19_001_bounded_sync_observability.sql`; it may not silently
pass through the append-only fallback. Apply and security-check that migration
on every Brain database before deleting legacy heartbeat history. Delete only
profile-matched `sync_heartbeat` rows, in bounded batches, after proving a fresh
current-state row and preserving the non-heartbeat event count.

The JEM migration and security gate passed on 2026-08-26. The active watcher
switched from its final legacy event at 16:49:51 UTC to the current-state row at
16:50:54 UTC without a restart. The guarded cleanup then removed 57,861 JEM and
475,091 ERS legacy heartbeat events; the 1,890 JEM and 1,404 ERS non-heartbeat
events were unchanged. This cleanup is distinct from the earlier removal of
481,170 misrouted JEM-labelled events from the ERS database.

Release `v1.8.2` was then deployed to JEM as Fly release 76. Its health surface
reported version 1.8.2, GitHub-only identity, Postgres/Supabase stores,
metadata-only artifact access and no access-administration route. ERS remained
untouched on version 1.7.3 / Fly release 15. Automatic vacuum completed on both
event tables with zero estimated dead rows; allocated relation space remains
available for PostgreSQL reuse, so no locking `VACUUM FULL` was justified.

**Why:** The bounded-observability code had deployed correctly, but the JEM
database had missed its per-database migration. The compatibility fallback
therefore continued one append per minute and the doctor falsely showed green.
Fallback must preserve availability during rollout without concealing schema
drift indefinitely. Once current-state liveness is proven, retaining hundreds
of thousands of routine heartbeat rows adds IO and storage cost without useful
historical value.

**Alternatives rejected:** keep a green compatibility fallback; disable the
five-second sync loop; retain all heartbeat history; delete rows before proving
the state table; combine cleanup with an automatic migration-time delete; or
upgrade database compute to mask avoidable housekeeping IO.

**Related:** `db/migrations/2026-08-19_001_bounded_sync_observability.sql`;
`scripts/lib/sync-heartbeat.mjs`; `scripts/hosted-doctor.mjs`;
`docs/hosted-cockpit.md`;
`docs/security/hosted-brain-supabase-security-gate.md`.

---

## 2026-08-26 — Bind hosted diagnostics and canaries to one Brain deployment

**Decision:** Every hosted doctor/OAuth-canary process that has a Brain database
URL must fail before network access unless it can prove one explicit deployment tuple:
`BRAIN_ID`, HTTPS `BRAIN_HOSTED_BASE_URL`, and
`BRAIN_EXPECTED_SUPABASE_PROJECT_REF`, with the project ref matching the
Supabase tenant encoded in the database URL. `hosted:doctor` and
`smoke:hosted:oauth` now enforce the same boundary already used by the sync and
source-companion paths. For the normal two-Brain local stack, manual commands
select the exact Brain from the owner-only generated Brain Monitor config with
`BRAIN_MONITOR_CONFIG_FILE`; the selected profile's allowlisted values override
ambient repo `.env.local` values. JEM and ERS still use separate databases,
hosted endpoints, Fly apps, OAuth state and credentials.

The operator template is realm-neutral and requires the expected project ref.
Changing only `BRAIN_ID`, or relying on a default Brain id beside an unrelated
database credential, is not a supported profile switch.

**Why:** The first JEM Spec 018 canary passed the MCP/OAuth behavior checks, but
the smoke and doctor processes inherited a stale repo `.env.local` containing
the ERS database URL while defaulting to the JEM Brain id and endpoint. Hosted
content and OAuth remained isolated, but historical client telemetry was
mislabelled into the ERS operational database: 481,170 JEM-labelled
`brain.sync_events` rows and one JEM heartbeat were removed on 2026-08-26.
An identity label is not a deployment boundary unless it is cryptographically
or structurally tied to the credential it selects.

**Alternatives rejected:** trust `.env.local` plus command-line `BRAIN_ID`;
infer ownership from the hosted URL or Fly app name; silently disable telemetry
on ambiguity; keep separate ad hoc shell files without a shared assertion; or
merge the two Brain databases to make misrouting impossible by convention.

**Related:** `scripts/lib/hosted-runtime-binding.mjs`;
`scripts/hosted-doctor.mjs`; `scripts/smoke-hosted-oauth.mjs`;
`.env.local.example`; `docs/hosted-cockpit.md`;
`docs/ers-entra-access-runbook.md`.

---

## 2026-08-25 — Use Entra and in-app role administration for ERS production

**Decision:** Rollout of ERS Brain beyond the existing John+Cillian pilot
requires single-tenant Microsoft Entra ID authentication. Entra proves the
tenant and person through exact `tid` plus `oid`. Dedicated Entra security
groups mapped to application roles govern workforce roles, while a private
Postgres grant ledger provides immediate Brain enforcement and audit. Email
address, UPN, display name and domain are not authorization. New colleagues
selected by an owner default to `reader`; SharePoint Brain-folder writes are
restricted to named curators so the human file plane cannot bypass MCP roles.
GitHub remains only a bounded pilot/rollback provider and is disabled for ERS
after the Entra canary.

Brain Cockpit will provide the shared control-plane shell, with capabilities
selected by the active owner-isolated profile. John, Cillian and the designated
IT/TDM identity are the initial ERS `owner`s. After TDM performs the one-time
app/group setup and tenant consent, John and Cillian can use the ERS **Access &
Roles** section to search the basic directory and add, change, suspend or revoke
users without recurring TDM intervention. The UI may mutate only fixed
allowlisted role groups through delegated Microsoft Graph permissions in the
signed-in owner's context; it is not a generic Graph client and receives no
app-only/background Graph writer.

JEM remains GitHub-authenticated and single-owner. Its Cockpit profile does not
register or display multi-user role administration. The current local Cockpit
servers remain loopback-only; the shared shell transitions ERS access work to a
hosted, Entra-authenticated ERS route. Sharing navigation and components does
not share sessions, identities, grant records, credentials or Brain data.

The timed restore rehearsal previously required by spec 012 is reclassified as
non-blocking resilience work. Supabase-hosted state plus the SharePoint/OneDrive
mirror and its version history are accepted as adequate rollout redundancy.
The rehearsal remains tracked, and this decision does not claim a tested RTO or
authorize removal of an existing redundancy layer.

**Why:** Corporate identity and permission management are the material risks in
wider access. Stable tenant/object identifiers, application-scoped role groups
and a current private grant ledger fail closed; mutable identity claims and
domain-wide grants do not. A dedicated in-app workflow avoids making every
ordinary joiner/leaver change an IT ticket while preserving Entra as the
workforce authority and an auditable local enforcement path. Aligning
SharePoint writes with the same curator population prevents a stricter agent
path from coexisting with a looser human bypass. A restore drill would improve
assurance but does not materially reduce the immediate identity/authorization
risk given the two current content copies and SharePoint history.

**Alternatives rejected:** GitHub as the workforce login; email-domain or UPN
authorization; an image-baked roster requiring deployment for every access
change; unrestricted tenant self-enrolment; raw/nested group claims; an app-only
Graph writer; per-principal RLS as a prerequisite; enabling every authenticated
colleague as a writer; leaving broad SharePoint writes outside the MCP role
model; bundling the MCP `2026-07-28` transport migration with the identity
cutover; retaining a restore rehearsal as a hard launch gate.

**Related:** `docs/specs/018-ers-production-identity-and-rollout.md`;
`docs/specs/012-ers-mcp-fork.md`; `BACKLOG.md` access-control and recovery
items; ERS Brain `governance/brain-mcp-fork-signoff.md` item 14.

---

## 2026-08-24 — Preflight ingestion and preserve operator-side source custody

**Decision:** Every ingestion begins with the read-only, idempotent
`brain_prepare_ingest` tool. It resolves the selected Brain and returns its
configured categories, file inventory, backend capabilities, and authoritative
completion/verification surface before any content write. Filesystem-backed
Brains retain the existing save/provenance/inbox workflow. Postgres-backed
Brains use the local Monitor/operator workspace for source bytes, provenance
inventory and real inbox cleanup; Fly remains the hosted Brain revision and
source-metadata reader, not a second filesystem authority. Unsupported ingest
mutation calls fail before server-side writes and state that no writes occurred.

**Why:** JEM and ERS hosted tools previously advertised a filesystem workflow
that Fly could not execute. The real backend refusal appeared only after a host
approval prompt, and `brain_ingest_complete` could fail after Brain revisions
had already landed. The hardcoded JEM category examples were also wrong for
ERS, hosted inbox output could not establish real inbox state, and the shared
filesystem guard incorrectly said hosted log append was unavailable even though
`brain_log` already writes through the revision store. A dedicated annotated
preflight gives clients a correct no-write decision surface while preserving
one source authority.

**Alternatives rejected:** create an ephemeral Fly `sources/`/`inbox/` tree
(silent divergence and data loss on replacement); make Postgres artifact text a
new unversioned Markdown authority (conflicts with local canonical content);
upload source bytes through ordinary MCP writes (widens the private artifact
surface); keep only better error text on the mutation tools (still burns an
avoidable approval prompt and permits content writes before capability is
known); copy JEM categories into the ERS runtime (tenant error).

**Related:** `docs/specs/017-hosted-ingestion-preflight.md`;
`src/tools/ingest.ts`; `src/services/ingest.ts`;
`src/services/registry.ts`; `scripts/hosted-cockpit.mjs`.

---

## 2026-08-24 — Session-start nudges are a transport-independent contract

**Decision:** `brain_load_context` must emit its health nudges on every
transport, and the capture queue is one of them. Nudge assembly lives in a pure
`buildContextNudges` fed by explicitly-typed inputs, and every input
distinguishes *measured empty* from *not answerable on this backend*: a
Postgres-backed Brain has no host inbox, so `inboxCount` is `null` and no inbox
nudge is emitted, rather than a count of zero implying an all-clear. An
unreadable `LOG.md` likewise suppresses the lint nudge instead of reporting
"never linted". `test/load-context-nudges.test.mjs` holds the contract.

**Why:** the nudges silently stopped on the hosted path when `36bdcec` rewired
the tool onto the store abstraction — the replacement was written without the
nudge block and the original was left with zero callers. Six docs still asserted
the nudges existed and `docs/conflict-resolution.md` stated it as a live
requirement, so nothing but the running code disagreed, and nothing failed.
The compounding cost was the capture queue: `summarizeCaptureQueue` was correct
but reachable only from an explicit `brain_lint` run, and the only prompt to run
`brain_lint` was the dead lint nudge. The JEM queue consequently reached 13 open
items with 12 stale — both thresholds breached every session, unreported — which
is the workload the 2026-08-24 cockpit decision below was written to clear. That
decision covers the operator-initiated path; this one covers the agent-facing
one, so the queue surfaces without John opening the cockpit first.

**Alternatives rejected:** leave the hosted bootstrap deliberately slim and
update the docs to match (the queue would keep silently refilling); keep the
capture-queue warning exclusive to lint and the cockpit (both require someone to
already suspect a problem); call `scanInbox` and render `0` when it refuses on a
non-filesystem backend (reports an all-clear the backend cannot support);
restore the nudges without tests (this exact block regressed to silence once
already, undetected).

**Related:** `src/services/context-nudges.ts`;
`src/services/active-brain-store.ts`; `src/services/task-intake.ts`;
`test/load-context-nudges.test.mjs`; `docs/conflict-resolution.md`.

---

## 2026-08-24 — Give capture-queue findings a completion workflow

**Decision:** A `TASKS.md` Capture / Triage warning must state that the open
count is the total queue and the stale count is its age-based subset. Cockpit
shows an approval-first, model-neutral LLM handoff as the recommended path and
a manual Obsidian procedure as the alternative. The copied prompt requires a
complete item-by-item disposition table, names the canonical task owners, and
stops before any write. After John approves, inaccessible destinations remain
open with an exact handoff; the workflow ends by re-reading `TASKS.md` and
rerunning lint. Cockpit never transfers, closes, or deletes semantic items
automatically.

**Why:** “13 open, 12 stale” was technically accurate but looked like two
different workloads and did not tell John what action would clear the warning.
This queue can span personal tasks, project backlogs, ERS Asana, and audit
backlogs, so judgement and destination access are required. A ready-to-use
handoff makes the bounded decision executable without asking John to inspect
technical diagnostics or manually reconstruct the routing rules.

**Alternatives rejected:** Show counts without a procedure; ask John to review
all items manually; auto-route by keyword; let an LLM write before presenting
the complete proposal; clear an item by changing its date; mark an inaccessible
transfer complete.

**Related:** `scripts/hosted-cockpit.mjs`; `src/services/task-intake.ts`;
`docs/hosted-cockpit.md`; `docs/specs/reviews/016-acceptance-review.md`;
`docs/brain-content-linking-runbook.md`.

## 2026-08-23 — Keep graph telemetry out of the operator lint queue

**Decision:** Brain lint counts only semantic/structural maintenance findings.
Real unresolved Markdown links and wikilinks remain broken-internal-link
diagnostics owned by the Brain content maintainer. Links from `brain/` to the
reviewed `sources/` archive, absolute or parent-relative machine locators, and
backtick project/file/directory references are classified separately as
external/reference telemetry and never inflate the maintenance total. Cockpit
automatically runs the strict local source-link audit when lint is refreshed,
closes source-boundary references when that audit passes, and keeps all
technical detail collapsed in a maintainer-only panel. Operator warnings are
reserved for safe mechanical fixes and explicitly labelled bounded content
decisions.

**Why:** JEM's 279 edge records mixed valid source navigation, intentional
project locators, stale links and parser false positives into one apparent
manual review task. John could not reasonably adjudicate that queue and should
not have been asked to. Classification establishes the correct ownership while
preserving diagnostic evidence; ignoring inline-code link examples removes a
known false-positive class. The 16 genuine stale links into the retired JEM ERS
mirror were repaired separately rather than hidden by classification.

**Alternatives rejected:** Ask the operator to inspect every edge; suppress all
graph telemetry; treat every backtick locator as a missing Brain node; count
valid `sources/` links as graph failures; auto-rewrite ambiguous external
locators into hyperlinks.

**Related:** `src/services/brain-graph.ts`; `src/services/lint.ts`;
`scripts/hosted-cockpit.mjs`; `scripts/hosted-doctor.mjs`;
`docs/brain-content-linking-runbook.md`.

## 2026-08-23 — Version reviewed Markdown separately from private source bytes

**Decision:** An exact reviewed `.md` source companion is readable hosted
content, not a private-binary download. `brain_read_file(scope="sources")`
returns its complete stored `brain.source_artifact_text` when the requested path
matches that artifact; binary and pointer-only paths continue to return bounded
metadata and never create a signed URL. Companion-only maintenance may create a
hashed `pointer_text` artifact through the target Brain's owner-only Monitor
database profile, retaining the prior active artifact as a snapshot. Private
Storage byte replacement remains a distinct `storage` mode requiring the
explicit admin-only service credential. Ordinary relative Markdown links expose
an adjacent ingested original to local Obsidian/viewer users without making it
public or embedding a laptop absolute path. A matching companion hash is current
only when the versioned text row also exists; pointer-only legacy or interrupted
states must be refreshed.

**Why:** The KRUK acceptance prompt found the correct source but received only a
manifest/opening search excerpt even though the complete reviewed Markdown was
already stored. Requiring a broad Storage key to update or read that text would
collapse the deliberate runtime/admin credential boundary. Treating Postgres
text as its own versioned authority fixes the tool contract honestly while
leaving original binary custody unchanged.

**Alternatives rejected:** Return original binary bytes from hosted MCP; require
the Storage service-role key in normal runtime or Brain Monitor; overwrite an
old artifact-text row in place; call a plain-text excerpt a complete source
read; use machine-specific `file://` links.

**Related:** `src/services/revision-brain-store.ts`;
`src/sources/postgres-source-store.ts`;
`scripts/refresh-source-companions-postgres.mjs`;
`docs/brain-content-linking-runbook.md`.

## 2026-08-23 — Make freshness semantic and lint diagnostics owned

**Decision:** For cadence-controlled Brain content, an explicit `Last reviewed`
date outranks filesystem modification time and a supported declared `Review
cadence` outranks filename-tier defaults. Volatile pages name their review
owner, cadence, event trigger and canonical live authority; the Brain keeps
durable orientation rather than copying live plans. Cockpit separates primary
semantic findings, grouped technical diagnostics and safe mechanical actions.
Each diagnostic class explains status, owner and completion; each mechanical
candidate has an expandable full proposal before selection.

**Why:** Mechanical sync/hyperlink edits were masking semantically stale pages,
including `05_projects.md`, while the old lint surface asked John to “review”
hundreds of mixed graph findings without defining his action. The same surface
truncated the content he was expected to approve. Dates, cadence and ownership
make staleness enforceable; progressive disclosure makes the review gate usable
without turning Cockpit into a general content editor.

**Alternatives rejected:** Use mtime as proof of review; auto-refresh semantic
claims; treat every graph diagnostic as user work; hide review-only diagnostics;
show only truncated mechanical candidates; activate Spec 014 to compensate for
stale content.

**Related:** `docs/jem-brain-freshness-register.md`;
`docs/hosted-cockpit.md`; `src/services/lint.ts`;
`scripts/hosted-cockpit.mjs`.

## 2026-08-22 — Make semantic destinations a separate reviewed content contract

**Decision:** Treat external semantic-destination completeness as independent
from graph reachability and Brain-to-source link integrity. Every declared
entity hub must contain a human-readable `## Canonical destinations` section
that records one of three reviewed states: current official website,
authoritative historical/successor evidence, or no verified public website.
Active Brain content uses ordinary Markdown hyperlinks; source-only domains are
promotion candidates, not automatic relationships. Routing evals may require an
exact Markdown destination and lifecycle marker. JEM is the development pilot;
the complete source-link plus semantic-destination sequence is recorded in a
tenant-neutral runbook for a separately approved ERS replay.

**Why:** The JEM graph and source-link audit were green while the Quanta hub had
no link to Quanta's website, even though the correct URL already existed in a
reviewed source companion. Internal reachability, direct evidence, human
clickability and authoritative external destination are different guarantees
and need different checks. Historical, private and pre-launch entities also
make a universal "official website required" rule both inaccurate and prone to
fabrication.

**Alternatives rejected:** Count any external URL anywhere in a file (allows a
counterparty link to satisfy the entity itself); promote every source-only
domain automatically (invents relevance); require a live homepage for defunct
or private entities (fabricates identity); treat HTTP status as authority
(redirects, bot blocking and outages are ambiguous); activate Spec 014 to solve
the gap (a compiler would only package incomplete content).

**Related:** `docs/brain-content-linking-runbook.md`;
`docs/specs/016-source-links-and-brain-library-pilot.md`;
`src/semantic-destinations/audit.ts`;
`evals/brain-routing/golden.json`.

## 2026-08-22 — Compile source identity and keep content reading separate from Cockpit

**Decision:** Use a versioned `brain.source-reference/v1` manifest as the
canonical compilation input for source companions. Artifact identity records a
provider id and revision, HTTPS locator, content hash, observation time, and a
registered local-root alias plus safe relative path; machine-specific absolute
paths are runtime configuration, not canonical data. The compiler emits
ordinary reciprocal Markdown links for humans and one bounded embedded JSON
manifest for LLM traceability. Brain relationships are reviewed declarations:
the compiler and persistence layer may format and replace a manifest's declared
link set, while the audit may identify thin, distant, broken, or non-clickable
connections, but neither may invent semantic backlinks.

Rendered content belongs in a separate local-only **Brain Library**, not Brain
Cockpit. Cockpit remains the maintenance and health surface. Library is
loopback-only and read-only, renders untrusted Markdown without HTML execution,
keeps local artifact opening disabled by default, and resolves any enabled
local open through registered artifact ids, allowlisted root aliases,
containment checks, and a nonce-protected POST. JEM is the only development
canary; ERS schema, content, deployment, and credentials remain untouched until
a separate rollout decision.

Multi-profile local sync is fail-closed by deployment identity. Each managed
Postgres profile must explicitly bind its database URL to an expected Supabase
project ref; managed sync children do not inherit repo `.env.local`, and the
sync CLI refuses a URL whose project ref differs. This prevents a correctly
named Brain profile from silently operating against another deployment.

This work improves the evidence and navigation plane but does **not** activate
spec 014. The task-context compiler remains deferred until its existing
post-slim measured trigger passes; richer provenance alone is not an activation
signal.

**Why:** Provider web links are portable but do not identify an exact observed
revision; absolute laptop paths are clickable but non-portable and leak machine
layout; code-span references are readable to models but poor human navigation.
The combined contract gives humans click-through navigation and models exact
trace identity without duplicating source bytes or coupling content reading to
the operator dashboard. Declared-only semantics prevent plausible-looking but
unsupported graph edges.

**Alternatives rejected:** Canonical `file://` URLs (machine-specific and
viewer-dependent); Dropbox paths without provider id/revision (weak exact-file
identity); automatic semantic backlink generation (fabricated provenance
risk); a Cockpit content tab (blurs operator and reader responsibilities); a
hosted multi-user viewer during development (premature auth and isolation
surface); activating spec 014 as part of ingestion work (no measured compiler
trigger).

**Related:** `docs/specs/015-compiled-source-ingestion.md`;
`docs/specs/016-source-links-and-brain-library-pilot.md`;
`docs/specs/014-task-context-compiler.md`; `docs/brain-library.md`;
`db/migrations/2026-08-22_001_source_reference_identity.sql`.

## 2026-08-19 — Make pending inbox warnings an explicit ingestion handoff

**Decision:** **Refresh inbox scan** is detection-only and never claims to ingest or clear a file. A pending inbox warning routes the operator to Cockpit Maintenance, where every file states that it is not stuck, explains that clearing requires reviewed ingestion, and provides a filename-specific **Claude ingestion handoff** with a copy action. The handoff directs an interactive Claude session with access to the selected Brain and ingestion-capable tools to load Brain context, follow the Brain's ingestion protocol, preserve source and provenance, update only justified durable content, complete ingestion with the exact `inbox_file`, and verify that `brain_scan_inbox` is clear. If only hosted read tools are available, the handoff directs the session to the documented local ingestion-capable workflow instead of manual deletion.

**Why:** Re-running the scan only proved that the same ERS file was still present, but the prior UI said merely “ingestion requires review.” That made a deliberate review boundary look like a stalled job and gave the operator no executable next step. The scan and the ingestion workflow are different jobs; the Cockpit must make that boundary explicit and hand off enough context to finish safely.

**Alternatives rejected:** Clear the warning when a scan succeeds (the source is still unprocessed); ingest automatically from Cockpit (classification, source authority, provenance, and durable Brain edits require judgement); add a dismiss button (hides an unprocessed source); delete the inbox file after scanning (data loss); require the operator to invent a Claude prompt from documentation (unnecessary surface switching and ambiguity).

**Related:** `scripts/hosted-doctor.mjs`; `scripts/hosted-cockpit.mjs`; `e2e/cockpit.playwright.mjs`; `docs/hosted-cockpit.md`; `docs/specs/010-cockpit-fixes-tab.md`; the 2026-08-19 operator-alarm and Maintenance decisions below.

---

## 2026-08-19 — Separate lint refresh, actionable fixes, and review-only notes

**Decision:** The Cockpit action is named **Refresh lint assessment** and is explicitly detection-only: it refreshes the structured report and clears a stale-lint nudge, but it does not claim to fix current findings. `lint_findings` is an operator warning only while the report contains safe mechanical fixes that can be applied in Maintenance. When findings remain but no automatic fixes are available, the check is `info` with state `review_only`; the findings and grouped graph diagnostics stay visible in Maintenance without changing overall readiness or entering Operator Queue. An explicit lint refresh or mechanical apply requests one fresh doctor run so the Cockpit reflects the new classification immediately instead of waiting for the Monitor-owned cache cycle.

**Why:** A successful ERS lint run left the Cockpit in warning state with five judgement-only findings, 680 grouped graph diagnostics, and zero automatic fixes. Re-running the detector could never clear that condition, so the alarm violated the project's actionability contract and taught the operator that the button was ineffective. Freshness, fixability, and advisory review are different states and must not share one warning treatment.

**Alternatives rejected:** Keep all non-zero lint results as warnings (not resolvable from Cockpit); add a dismiss button (hides regenerated findings without changing their meaning); claim a successful run means the Brain is clean (false); remove review-only findings entirely (loses useful quality evidence); rerun the full doctor on every routine Cockpit refresh (duplicates the Monitor and recreates avoidable observability load).

**Related:** `scripts/lib/doctor-actionability.mjs`; `scripts/hosted-doctor.mjs`; `scripts/hosted-cockpit.mjs`; `test/doctor-actionability.test.mjs`; `test/cockpit-fixes.test.mjs`; `docs/hosted-cockpit.md`; 2026-08-19 operator-alarm and Maintenance decisions below.

---

## 2026-08-19 — Remove Raw Output from the operator cockpit

**Decision:** Remove the **Raw Output** top-level tab from Brain Cockpit. The supported operator interface is Overview, Activity, Latency, Checks, and Maintenance. Exact doctor JSON remains available to developers through the loopback `/api/doctor` endpoint and each profile's `hosted-doctor.out.json` file, but it is not promoted as a permanent user-facing destination.

**Why:** Raw Output was a direct serialization of the same payload already rendered into the other cockpit views. It offered no distinct operator task, exposed implementation structure without interpretation, and made the navigation look less deliberate. Keeping developer diagnostics behind the existing endpoint and file preserves troubleshooting evidence without asking users to interpret internal JSON.

**Alternatives rejected:** Retain the tab as a generic troubleshooting escape hatch (duplicates Checks and shifts interpretation burden to the user); hide it behind an “advanced” toggle (adds state and complexity for a developer-only path already available elsewhere); remove raw diagnostic access entirely (unnecessarily weakens debugging).

**Related:** `scripts/hosted-cockpit.mjs`; `e2e/cockpit.playwright.mjs`; `test/deploy-config.test.mjs`; `docs/hosted-cockpit.md`; `docs/specs/007-brain-cockpit-ux-redesign.md`.

---

## 2026-08-19 — Reserve operator alarms for actionable conditions

**Decision:** Brain Monitor and Cockpit use four check states: `pass`, `info`, `warn`, and `fail`. `warn` and `fail` are reserved for current, meaningful conditions with a defined operator action; only those states can enter Operator Queue or change the overall readiness verdict. Optional or unavailable diagnostics remain visible as `info` and do not raise an alarm. In particular, missing or expired local Fly CLI authentication is `info`: hosted health and sync remain authoritative, Checks explains that the control-plane probe was skipped, and it offers the optional `fly auth login` command. An authenticated Fly result with no passing Machine, or another real control-plane error, remains an actionable warning. The doctor carries an explicit alarm-capable check registry and suppresses any future diagnostic that lacks an action contract. Cockpit no longer invents generic “needs review” or “inspect details” fallback alarms.

**Why:** An alarm without a relevant consequence and concrete next step trains the operator to ignore the monitor. Local Fly CLI login is an optional diagnostic capability, not evidence that the hosted Brain is unhealthy; the independent hosted-health and sync checks already establish service readiness. Condition-derived status also makes manual dismissal unnecessary: fixing the condition and reloading clears the warning, while informational limitations remain honestly visible.

**Alternatives rejected:** Keep missing Fly login as a warning (false alarm); add a dismiss/clear button (hides a regenerating condition without fixing it); hide Fly diagnostics entirely (loses useful Machine/release evidence when the CLI is available); expose Fly authentication inside Cockpit (unnecessary credential-bearing admin surface); retain a generic warning fallback for unknown checks (cannot promise a useful operator response).

**Related:** `scripts/lib/doctor-actionability.mjs`; `scripts/hosted-doctor.mjs`; `scripts/hosted-cockpit.mjs`; `test/doctor-actionability.test.mjs`; `e2e/cockpit.playwright.mjs`; `docs/hosted-cockpit.md`.

---

## 2026-08-19 — Make Cockpit Maintenance the executable lint and inbox surface

**Decision:** Rename the Cockpit **Fixes** tab to **Maintenance** and make it the primary operator surface for detection plus governed repair. **Run lint now** calls the canonical `runLint` implementation, records one narrow `LINT` receipt through the active Brain store, and atomically writes a per-profile `hosted-lint-report.json`. The doctor reads that cache first and reports freshness (`lint_nudge`) separately from current results (`lint_findings`). Each Monitor profile must carry the same explicit `BRAIN_LINT_MODE_OVERRIDES` promotion mode as its hosted deployment; synthesized local registries carry the standard graph roots and rotated-history exemptions so that promotion remains meaningful. Primary lint findings stay individually visible, while high-volume graph edge diagnostics are counted and grouped into one bounded review signal rather than flooding the action surface. The same tab exposes a visibility-only inbox scan and retains per-item application of the safe mechanical task fixes. Mechanical fixes start unchecked, use a standard select-all header checkbox, and remain separate from the **Apply selected** action. Semantic and structural lint findings remain review-required; Inbox files are not ingested, classified, moved, or deleted. An empty mechanical plan must not be presented as a clean Brain. Mechanical apply reruns lint to refresh the cache without duplicating its existing receipt.

**Why:** The previous operator journey detected lint and Inbox warnings in Brain Monitor but required a different client or CLI to rerun the detector, while the misleading Fixes empty state could say the Brain was clean merely because no automatic task edits existed. Keeping detection, current findings, and the narrow repair plan together preserves observability and makes warnings actionable without turning Cockpit into a general editing or admin surface. The report cache also lets routine doctor polling render current findings without rerunning lint or adding database load.

**Security posture:** `POST /api/lint/run` uses the same loopback Host allowlist, per-process nonce, JSON-only content type, and no-CORS posture as `POST /api/fixes/apply`. `GET /api/lint/report`, `GET /api/inbox/scan`, and `GET /api/fixes/plan` are loopback-only reads. Lint runs are explicit and single-flight per Cockpit process; routine refresh stays read-only. This extends, rather than removes, the narrow localhost-write decision from 2026-07-01.

**Alternatives rejected:** Keep warnings detection-only in Cockpit (surface switching remains); run lint on every refresh (unnecessary local/hosted load and write amplification if receipts are recorded); auto-apply all findings (semantic corruption risk); auto-ingest Inbox files (classification and source metadata require judgement); treat an empty mechanical plan as an all-clear result (conflates fixability with lint health).

**Related:** `scripts/hosted-cockpit.mjs`; `scripts/hosted-doctor.mjs`; `scripts/install-brain-menubar-app.mjs`; `src/services/lint.ts`; `test/cockpit-fixes.test.mjs`; `docs/hosted-cockpit.md`; `docs/specs/010-cockpit-fixes-tab.md`; 2026-07-01 localhost write and mechanical lint-fix decisions below.

---

## 2026-08-19 — Bound observability IO with current-state heartbeats and one doctor owner

**Decision:** Keep the five-second local sync loop and five-minute hosted stale-heartbeat threshold, but represent normal sync liveness as one upserted `brain.sync_heartbeats` row per Brain, written at most once per minute. Reserve append-only `brain.sync_events` for real hosted operations, auth events, transitions, and other historical events. Brain Monitor remains the sole automatic doctor owner in the consolidated local stack; Cockpit reloads Monitor's last-good report instead of launching a duplicate doctor. The doctor uses one two-connection pool with five-second connection/query/statement limits, refreshes historical operation telemetry at most every 15 minutes, and retains a manual force-deep path. Monitor terminates a doctor that exceeds 45 seconds and keeps the previous valid report.

**Why:** Pre-production monitoring had become the database's dominant workload: a successful five-second sync cycle appended a new heartbeat event, duplicate Monitor/Cockpit doctors repeatedly scanned the same append-only table, and unbounded doctor processes could overlap or remain stuck. This consumed Supabase Disk IO despite light product use. Liveness is state, not history; coalescing it preserves the one-minute/five-minute detection contract while removing write amplification. Cached deep telemetry and a single doctor owner preserve operator visibility without paying for the same historical scan every browser refresh.

**Alternatives rejected:** Move immediately to a larger Supabase compute package (masks self-inflicted IO and raises recurring cost); slow or disable the sync watcher (degrades local-first freshness); remove monitoring or extend stale thresholds (degrades observability); automatically delete historical telemetry in the migration (unnecessary data loss and a high-IO rollout); introduce a new metrics service or daemon (extra infrastructure for a load created by the existing monitor).

**Related:** `db/migrations/2026-08-19_001_bounded_sync_observability.sql`; `src/sync/postgres-revision-store.ts`; `scripts/hosted-doctor.mjs`; `scripts/hosted-cockpit.mjs`; `scripts/install-brain-menubar-app.mjs`; `docs/hosted-cockpit.md`.

---

## 2026-07-17 — Adopt shallow Brain content graph; defer task-context compiler pending evidence

**Decision:** Adopt a shallow L0/L1/L2 Brain content architecture plus ranked search: a slim `00_loader.md` contract, one-screen `NOW.md`, one directly selected substantive hub and a terminal canonical-source pointer. Replace loader-direct orphan detection with convention-aware graph reachability, remove the `orphan_index` and loader-writing `reviewed_date` auto-fixes, and enforce a provisional combined bootstrap budget of **2,500 tokens per Brain**. After role parsing is hardened deny-by-default, protect both always-loaded files (`00_loader.md` and `NOW.md`) with a fail-closed store-layer `admin`/`owner` write allowlist. Improve and instrument structured search before changing the load interface. The proposed `task`/`max_tokens` context compiler is deferred to trigger-gated spec 014 and defaults to **do not build** unless post-slim evidence demonstrates a material residual routing or follow-up-read gap; if the slim baseline meets the agreed sufficiency target, record the no-build result and archive the stub.

**Why:** Fable 5's independent review confirmed the loader/context problem and endorsed the progressive-disclosure content, lint and role layers, but found the bundled compiler premature and unmeasured. The existing shallow hub graph already resolves most content; the immediate defects are excessive bootstrap content, an edge parser that contradicts the Brains' graph convention, auto-fixes that write structural content, unranked search and fail-open roles. Splitting the compiler prevents a measured, reversible correction from being coupled to a new retrieval subsystem. Named destinations for every evicted loader block, a precise edge grammar, shadow-mode graph lint, instrumented acceptance criteria and a sync-aware rollback make the approved direction operationally testable.

**Alternatives rejected:** A flat comprehensive loader (permanent token tax and multi-user write contention); a deep manual hierarchy (unnecessary hops and extra staleness surfaces for the current corpus); pure search-first retrieval (cannot reliably push authority, policy and safety markers at cold start); and the original bundled shallow-graph-plus-compiler proposal (coupled a justified content fix to an unmeasured subsystem). The shallow core of the hierarchy option and the search improvements are retained. Search-first may be reconsidered if corpus scale measurably degrades hub routing; the compiler may be reconsidered only under spec 014's activation trigger and is killed under its no-gap criterion.

**Related:** `docs/specs/013-brain-context-architecture.md`; `docs/specs/014-task-context-compiler.md`; `docs/specs/reviews/013-review1-architecture.md`; `docs/specs/008-brain-routing-evals.md`; 2026-07-01 lint-apply decision below (fixes A and C superseded); 2026-07-06 Brain Platform Review decision below (distinct schemas preserved).

---

## 2026-07-16 — ERS Brain deployment fork executes through a mandatory private tag-tracking mirror

**Decision:** The ERS Brain migration authorized on 2026-07-13 proceeds now; ELT comments inform the rollout gate beyond the John+Cillian pilot, not whether the migration may begin. This entry amends the 2026-07-06 topology wording: the ERS deployment uses a **mandatory private ERS-org mirror** of the public upstream, tracks **annotated upstream release tags only**, and carries only the ERS config/test/docs overlay. All source development remains upstream and `src/`, `db/`, and `scripts/` never diverge in the mirror.

**Why:** ERS needs custody of its deployment configuration and release inputs without creating a second code line. The private overlay keeps staff identifiers and deployment-specific configuration out of the public upstream, while tag-only intake makes every ERS deployment reviewable and reproducible.

**Alternatives rejected:** The 2026-07-06 optional-mirror wording (insufficient ERS custody); deploying directly from public `main` (unreviewed moving target); a source-code fork (permanent divergence and doubled maintenance); committing the ERS registry or deployment overlay upstream (public disclosure of ERS-specific configuration).

**Related:** 2026-07-06 decision below (D1 migration + D2 topology, amended here); `docs/specs/012-ers-mcp-fork.md`; `docs/savepoints/2026-07-16-ers-fork-execution.md`.

---

## 2026-07-10 — Brain file delete/rename via tombstone revisions + guarded delete-aware sync

**Decision:** Deletion and rename are first-class revision-store operations, not filesystem side effects. A delete appends a **tombstone revision** (`deleted=true`, `content`/`content_sha256` null) that the head points at; a rename is an **atomic** create-new + tombstone-old in one store transaction, carrying `renamedFrom`/`renamedTo` metadata and rewriting inbound `[[wikilinks]]`. Delete ships with `brain_restore_file`. The local sync agent infers a local deletion only behind **three defence-in-depth guards** — folder health (a scan that is empty or missing a structural marker `00_loader.md`/`NOW.md` is treated as unmounted/damaged, never as deletions), a two-scan **debounce**, and a **mass-delete threshold** (`BRAIN_SYNC_MAX_DELETES`, default 5; `BRAIN_SYNC_MAX_DELETE_PCT`, default 10%) — and pull applies hosted tombstones as explicit signals (unlink only a clean local copy, conflict on unsynced edits, never touch a protected file). The old pull-side "resurrect a locally-missing tracked file" branch is removed.

**Why:** The hosted revision store had no delete/rename concept, so local deletions resurrected within ~5s and renames left duplicate stale heads — recurred ≥3× (2026-06-27; the 2026-07-07 `ip_landscape.md` move = registry action A11). Two adversarial reviews (correctness + prior-art) found that a naive "missing file = delete" would tombstone the **whole Brain** on an empty/unmounted OneDrive scan; the guard set is lifted from Syncthing `.stfolder`, Unison `confirmbigdel`, and rsync `--max-delete`. Tombstone-as-revision preserves the append-only/CAS/attribution model (textbook CouchDB `_deleted`). Absence is now owned solely by the guarded push path, which is why pull-side resurrection had to go — it re-created exactly the file push was trying to tombstone.

**Alternatives rejected:** Explicit-signal-only deletion (no inference) — rejected by review 2 because the real incidents were on-disk file removals, not MCP calls, so an explicit-only path would not have caught them. Hard-delete/purge of history — rejected; recoverability requires the tombstone chain. Two-transaction rename — rejected (R1 #4: a mid-rename conflict reproduces the duplicate-head bug).

**Related:** `docs/specs/011-brain-file-delete-rename.md` (+ `reviews/011-review1-correctness.md`, `reviews/011-review2-prior-art.md`); `db/migrations/2026-07-08_001_brain_file_tombstones.sql`; `src/sync/{types,local-sync-agent,report-summary,postgres-,memory-,file-revision-store}.ts`; `src/services/{wikilinks,link-maintenance,brain,brain-store,revision-brain-store}.ts`; `src/tools/update.ts`; `docs/conflict-resolution.md`.

---

## 2026-07-06 — Brain Platform Review: six checkpoint decisions locked (topology, migration, schemas, linking, build-vs-adopt, MD-vs-HTML)

**Decision:** The 2026-07 Brain Platform Review (evidence base: `~/Projects/claude-ops/plans/brain-platform-review-2026-07/` — 86 verified findings, 4 workstream reports, landscape whitepaper v2) closed with John approving all six recommendations on 2026-07-06:

1. **Migration:** ERS team rollout runs on a fresh ERS-owned stack — new ERS Supabase org+project (re-run migrations + security gate), new Fly app in an ERS org, new GitHub OAuth app under ERS-Genomics, ERS-only registry with `default_brain_id: ers-brain` and **no** `GITHUB_ALLOWED_*` env fallback. Data cutover by re-seed from the SharePoint Markdown mirror (archived `pg_dump` + export checkpoint first); the restore rehearsal from `docs/hosted-brain-recovery-and-git-export.md` runs against the *new* project during cutover; `ers-brain` content **and** ERS-related telemetry/OAuth rows are then verifiably deleted from the personal pilot. GitHub stays the IdP at rollout (principals pinned by numeric `provider_user_id`); Entra ID is roadmap.
2. **Topology:** Two single-tenant deployments of the same codebase; the personal `jem-brain-mcp` stack is untouched apart from shrinking its registry back to one brain. Rationale: the runtime binds exactly one revision-store database per process (registry `storage_backend` is ignored by the hosted path), and the compliance test is symmetric — JEM personal data on ERS infra is as unacceptable as ERS data on personal infra. **"Fork" in `OWNERSHIP_AND_LIFECYCLE.md` means deployment fork, not code fork**: one upstream repo, ERS pins tagged releases (optional ERS-Genomics mirror for custody).
3. **Schemas:** Both brain schemas stay; JEM keeps numeric prefixes (stable identifiers, never renumbered), ERS stays prefix-free. The server's only hard filename contracts remain `00_loader.md` + `NOW.md`.
4. **Linking:** Reference integrity becomes lint-enforced — a `dead-wikilink` rule first, then an `external_refs` family (no `/Users/<name>/` paths in knowledge files, SharePoint refs need `sharepoint.com` hrefs via a site-mapping table, bare URLs wrapped); advisory (non-blocking) warnings on the write path.
5. **Build-vs-adopt (memory layer):** Keep building brain-mcp-server; adopt components, never a platform. Standing kill criteria recorded in the review's `research/build-vs-adopt.md`.
6. **Storage/UX:** Markdown stays canonical; live links via native web URLs per reference class now, cockpit content routes + `/r` resolver later.

**Why:** ERS rollout (5–20 trusted users) pulls the Phase 0→1 trigger this doc already defines; the review's audit found the architecture sound but the shared-instance topology impossible to make compliant, and the 2026 market convergence on files-canonical memory (Letta MemFS pivot, Karpathy LLM-wiki, Google OKF) removed the case for adopting a framework.

**Alternatives rejected:** shared instance on either party's infra (fails symmetric compliance; unsupported by per-process store binding); Supabase project transfer to ERS (would hand JEM personal data to ERS); code fork (doubles single-maintainer burden, forecloses productization); adopting Letta/Zep/Mem0/Cognee (wrong shape or lock-in; three forced migrations in 24 months across the adopt path); HTML-first storage (dead on arrival vs. MD-canonical + rendered surfaces); numeric prefixes for ERS / dropping them for JEM (each argued from how tools actually navigate).

**Related:** `~/Projects/claude-ops/plans/brain-platform-review-2026-07/01_target-architecture-and-roadmap.md` (roadmap + success criteria); `reports/audit-platform.md`, `reports/audit-infra-migration.md`, `reports/audit-schemas-content.md`, `reports/gaps-and-unknowns.md` (findings incl. the P0 fixes shipped alongside this entry); `docs/OWNERSHIP_AND_LIFECYCLE.md` (wording update pending per decision 2).

---

## 2026-07-01 — Cockpit gains one localhost write endpoint for per-item fix approval

**Decision:** The Brain Cockpit — previously read-only — gains a **Fixes** tab and two routes on its per-profile loopback server: `GET /api/fixes/plan` (read-only, live per-item plan) and `POST /api/fixes/apply` (the one write endpoint). The tab lists each atomic fix (each orphan, each archived/stamped task, the date bump) with its own checkbox plus an "Approve all" control, and applies only the approved ids. Apply **re-reads current Brain state and recomputes the plan**, so approved ids that no longer match a live candidate are ignored — a stale plan cannot write against changed content. This supersedes the spec-009 menubar modal as the primary approval UX; the menubar button and CLI remain as the no-GUI paths. The fix rules reuse `lint-fix.ts` via an approved-key filter — no duplicated logic.

**Why:** The menubar dropdown + native modal was all-or-nothing and hard to read; per-item approval in the cockpit the operator already has open is materially better, and lets them accept some fixes while skipping others. The cockpit was read-only by default (a conservative posture, not a hard safety boundary), and the endpoint is loopback-only, so a single confirm-gated write route is a defensible, scoped evolution rather than opening a public write surface.

**Security posture (required, all together):** a write endpoint on a loopback server is reachable by other local processes and — via DNS rebinding / CSRF — potentially by a malicious web page. Mitigations: bind `127.0.0.1` only; **Host-header allowlist** (reject any Host that is not a loopback literal — defeats DNS rebinding); a **per-process nonce** (`crypto.randomBytes`) embedded in the served page and required in an `X-Cockpit-Nonce` header (a cross-origin page cannot read it since no CORS headers are ever sent); **JSON-only** content-type (with the custom header this forces a preflight the server never approves); **no `Access-Control-Allow-*` headers, ever**. The plan GET is read-only but gets the same Host allowlist. Covered by `test/cockpit-fixes.test.mjs` (bad nonce → 403, non-loopback Host → 403, non-JSON → 415, valid → applies only approved).

**Alternatives rejected:** keeping the cockpit strictly read-only and applying only via menubar/CLI (loses the per-item UX in the surface the operator actually uses); per-*type* approval (4 checkboxes) instead of per-item (coarser than asked for); auth heavier than the localhost posture (unjustified for a single-operator local tool); applying a client-held plan without re-reading state (would risk writing a stale plan).

**Related:** `docs/specs/010-cockpit-fixes-tab.md`; `scripts/hosted-cockpit.mjs`; `src/services/lint-fix.ts` (approved-key filter + stable ids); `src/services/lint-apply.ts` (`planLintFixes`, `applyLintFixSelection`); `test/cockpit-fixes.test.mjs`; `docs/hosted-cockpit.md`; DECISIONS 2026-07-01 (the spec-009 mechanical fix engine this builds on).

---

## 2026-07-01 — Mechanical `brain_lint` auto-fix: hosted tool + narrow operator write, stamp-forward dating

**Decision:** `brain_lint` gains a `fix` mode (`brain_lint({ fix: true })`, with `dry_run` for preview) that applies four mechanical, non-fabricating fixes through the governed store write path: (A) index orphaned files into the loader, (B) archive Done items older than 30 days into `archive/tasks-done.md`, (C) bump the loader "Last reviewed" date when a change lands, (D) relocate completed `[x]` tasks into Done. Age (for B) is handled **stamp-forward**: undated Done items are tagged with a visible `(done YYYY-MM-DD)` marker (matching the Brain's existing convention) the first time the tool sees them; no line-level history is reconstructed. Old Done items are **archived, not deleted**. The operator surface (Brain Monitor) may expose exactly one **confirm-gated "Apply lint fixes" action that delegates** to this logic (`scripts/brain-lint-fix.mjs` / the hosted tool) — a **narrow, deliberate relaxation** of the cockpit/Monitor read-only invariant. The Monitor still performs no direct Postgres/Storage/file mutation, no conflict resolution, and no admin mutation, and stays local-bound.

**Why:** Retiring the `brain-health-audit` scheduled routine (2026-07-01) removed its mechanical auto-fixes, which had no hosted equivalent — the routine was retired specifically because it re-implemented (and drifted from) `src/services/lint.ts`. Housing the fixes in the server as one canonical implementation, reusing `runLint`, means no routine or surface re-derives the rules. Stamp-forward dating is the deliberate "set the foundation going forward" call for a nascent prototype Brain: reconstructing true completion dates from the revision store would require walking per-file revision history (file-level timestamps only, no line-level blame) for marginal value; tagging items as first-seen is honest, cheap, and store-agnostic. Archiving instead of deleting preserves referable history at near-zero cost. The Monitor button relaxation is scoped tightly so the read-only contract is narrowed, not lifted.

**Alternatives rejected:** Keeping a scheduled routine that re-implements the checks (the drift problem that caused the retirement); a separate `brain_lint_fix` tool (an extra surface where a `fix` flag on the existing detector is enough, and the mutation is still explicit); revision-history/`git log` archaeology to date Done items (cost and store-coupling not justified for a prototype); deleting old Done items (loses referable history); a Monitor button that writes Postgres/files directly (would breach the read-only invariant rather than narrow it).

**Related:** `docs/specs/009-brain-lint-apply-mode.md`; `src/services/lint-fix.ts`; `src/services/lint-apply.ts`; `src/tools/lint.ts`; `scripts/brain-lint-fix.mjs`; `scripts/install-brain-menubar-app.mjs` (Brain Monitor Controls → "Apply Lint Fixes...", confirm-gated dry-run → apply); `docs/hosted-cockpit.md`; [claude-ops/LOG.md](../../claude-ops/LOG.md) 2026-07-01 CLEANUP (routine retirement).

---

## 2026-06-25 — Remove Git from routine Brain operations, retain it only as emergency export/history

**Decision:** Routine Brain operations no longer include manual Git commit/push/merge or GitHub repo backup checks. Hosted MCP, Supabase Postgres, Supabase Storage, local sync, doctor/cockpit, and conflict records are the normal operator surfaces. Git is retained only as an async export, human-readable history, and emergency recovery lane until a later restore rehearsal supports removing it entirely.

**Why:** Hosted Brain now uses the Supabase revision store for both `ai-brain-jem` and the John-only `ers-brain` pilot, with 0 open hosted conflicts in the live connector check. Supabase backup metadata is visible through the CLI, but PITR is not currently enabled and Storage objects are not included in database backups, so Git should leave the daily workflow now without being deleted as emergency fallback.

**Alternatives rejected:** Continuing to require Brain operators to commit/push/merge during normal writes or ingests (reintroduces the old hot-path drift problem); deleting Git backup/history immediately (premature until restore-to-new-project, Storage-object recovery, and local Markdown reseed are rehearsed); treating PITR as active before the project actually reports it enabled.

**Related:** `docs/hosted-brain-recovery-and-git-export.md`; `docs/specs/003-hosted-brain-sync-architecture.md`; `docs/specs/006-brain-sync-architecture-simplification.md`; `docs/ROADMAP.md`.

---

## 2026-06-24 — Use the personal hosted MCP for John-only ERS Brain pilot before ERS production fork

**Decision:** Add `ers-brain` to the existing hosted Brain MCP as a John-only multi-Brain pilot, using the same Fly app and pilot Supabase project for routing, revision sync, source metadata, and private artifact storage. Keep the local ERS Brain checkout as the canonical local-first mirror and fallback. This is not ERS team access and not ERS production; the ERS-owned Supabase/project fork remains required before team or production rollout.

**Why:** The next technical risk is Brain selection and isolation, not organizational tenancy. Proving `brain_id` routing, per-Brain sync state, source manifests, artifact paths, and client ergonomics with John as the sole user is lower risk than combining those concerns with ERS-owned infrastructure, onboarding/offboarding, and multi-user authorization. The ERS Brain remains an ERS content asset; the personal hosted MCP remains a pilot substrate until Phase 1.

**Alternatives rejected:** Forking a dedicated ERS MCP before the multi-Brain contract is proven (too much tenancy machinery before routing risk is retired); keeping ERS on local-only/GitHub-only access until the full ERS production migration (slows the exact hosted-path proof we need); treating the personal pilot Supabase as final ERS infrastructure (explicitly rejected).

**Related:** `config/brain-platform.john-ers-pilot.json`; `db/seeds/2026-06-24_001_bootstrap_ers_brain_pilot.sql`; `docs/ers-brain-hosted-pilot.md`; `docs/OWNERSHIP_AND_LIFECYCLE.md`; `docs/ROADMAP.md`; `docs/hosted-client-cutover.md`.

---

## 2026-06-24 — Record non-secret client identity on auth telemetry; classify stale-connector loops separately

**Decision:** Hosted auth-failure telemetry (`brain.sync_events`, `event_type = 'hosted_mcp_auth'`) now records two **non-secret** OAuth identifiers in `metadata` when derivable: the raw `clientId` and the `grantType`. The cockpit auth summary (`authFailureSummaryFromSyncEventRows`) exposes per-`clientId` and per-`grantType` breakdowns and derives a `connectorState`. A **conservative** `stale_connector` verdict — a single *unregistered* `clientId` looping `unknown_client_id` on a `refresh_token` grant, sustained past a grace window — is downgraded from `fail` to `warn` by both the `hosted_mcp_auth_failures` doctor check (via `effectiveStatus`) and the spec-004 Slack alerter (via `computeStaleConnector` + `decideAuthAlert`), so a benign post-migration zombie connector no longer pages at full severity. Any ambiguity (multi-client, multi-reason, unknown registered set, short burst) keeps full severity. Grace window: `BRAIN_HOSTED_MCP_AUTH_STALE_GRACE_MINUTES` (default 10), shared by doctor and alerter.

**Why:** A frozen/half-deleted ChatGPT connector kept presenting a pre-migration `client_id` on a ~11-minute timer (observed 2026-06-24). The server rejected it correctly, but the failure was unidentifiable (no client identity recorded) and tripped `fail` + Slack pages indefinitely — contradicting the 2026-06-23 decision that the post-migration `invalid_client` wave is expected and self-healing. The rejected `client_id` is the one stable, unique signature, available at `src/oauth/token.ts` and previously discarded. Recording it (and `grantType`) makes the zombie precisely identifiable and lets monitoring tell expected stale-connector noise apart from a real auth incident. The server cannot stop a remote client's retry loop (a `401` is already the spec-correct "give up"); this is an observability/classification fix, not enforcement.

**Alternatives rejected:** Recording a hash of the `client_id` (breaks the join to the `clients` registration store for surface/name resolution, with no benefit — `client_id` is non-secret); capturing `User-Agent`/IP now to identify unregistered clients (deferred to the observability BACKLOG item and gated by the Supabase security review — higher privacy cost, and `client_id` alone classifies the zombie); a broad downgrade whenever `unknown_client_id` dominates (risks masking a real incident — kept conservative); importing the `.mjs` summary classifier into the `src/` alerter (cross-layer dependency that may not ship in the Fly image — instead a small shared-rule helper is duplicated in spirit and pinned by tests on both sides).

**Related:** `docs/specs/005-auth-client-identity-and-stale-connector-classification.md`; `src/oauth/token.ts`; `src/services/auth-telemetry.ts`; `src/services/auth-alert.ts`; `scripts/lib/latency-summary.mjs`; `scripts/hosted-doctor.mjs`; `scripts/hosted-cockpit.mjs`; `docs/security/hosted-brain-supabase-security-gate.md`; `DECISIONS.md` 2026-06-23 (expected post-migration `invalid_client` wave).

---

## 2026-06-23 — Trust ChatGPT's documented MCP connector OAuth callback path by pattern

**Decision:** Accept ChatGPT MCP app OAuth redirect URIs under `https://chatgpt.com/connector/oauth/<callback-id>` by code, plus the documented legacy `https://chatgpt.com/connector_platform_oauth_redirect` callback. Keep the trust narrow: HTTPS only, exact `chatgpt.com` host, no query or fragment, and a single callback-id path segment. Continue to use `MCP_OAUTH_ALLOWED_REDIRECT_URIS` for other exact non-loopback callbacks.

**Why:** ChatGPT creates connector-specific callback IDs, and the previous exact-secret allowlist caused connector registration failures whenever the callback changed. During the 2026-06-23 ChatGPT re-enrollment failure, hosted Postgres had no ChatGPT dynamic-client record and a live DCR probe returned `invalid_redirect_uri` for the documented ChatGPT callback shape. Trusting only that documented callback class removes the per-app secret churn without broadly opening OAuth redirects.

**Alternatives rejected:** Exact per-ChatGPT-callback Fly secrets (too brittle for connector recreation); broad `https://chatgpt.com/*` trust (unnecessarily wide); moving to CIMD/private-key JWT in this hardening slice (valuable later, but larger than needed to restore DCR).

**Related:** `src/oauth/config.ts`; `test/oauth-register.test.mjs`; `docs/hosted-client-cutover.md`; `docs/deploy-fly.md`; OpenAI Apps SDK authentication docs.

---

## 2026-06-23 — Hosted Brain MCP ownership: personal-owned, ERS beta-shared; fork at cutover

**Decision:** The hosted Brain MCP (this repo + Fly app `jem-brain-mcp` + Supabase `brain-platform-pilot`) is a **personal-owned** asset, currently **shared with ERS for beta hardening** with John as the sole user. It is dual-registered in both the personal and ERS asset registers. At full multi-tenant / multi-Brain ERS cutover a **dedicated ERS MCP is forked** (separate Fly.io instance(s), Supabase migrated to ERS control, all other dependencies audited + migrated); the personal MCP/infra stays personal. The JEM Brain and the `mcp__brain__*` connector are personal; the ERS Brain content is a separate ERS asset. Canonical detail: [`docs/OWNERSHIP_AND_LIFECYCLE.md`](OWNERSHIP_AND_LIFECYCLE.md).

**Why:** The personal/ERS boundary for the shared hosted MCP kept needing re-explanation. Locking it once — with a canonical doc as the source of truth — prevents drift and re-litigation, and sets a clear trigger (multi-user and/or multi-Brain need) for the fork.

**Alternatives rejected:** Treating the hosted MCP as ERS-owned now (it is personal-owned; ERS is only beta-using it). Moving the personal asset to ERS at migration instead of forking (the personal MCP stays personal — the ERS service is a separate forked deployment).

**Related:** `docs/OWNERSHIP_AND_LIFECYCLE.md`; `jem-registry/personal-assets.md`; `ers-registry/ers-assets.md`; `BACKLOG.md` (ERS Brain MCP fork item); `docs/ROADMAP.md`.

---

## 2026-06-23 — Surface hosted auth failures and alert to Slack in real time

**Decision:** Add a `hosted_mcp_auth_failures` doctor check (so the Checks tab and overall status reflect `hosted_mcp_auth` rows) and a real-time, server-side Slack alerter that posts from the Fly app when an auth failure is recorded: `warn` (≥ 3 failures / trailing 60m) to `#claude-ops`, `fail` (≥ 10) to the operator DM with `[Action needed]`, with a per-severity cooldown. Alerting is gated on `BRAIN_SLACK_BOT_TOKEN` and posts via Slack `chat.postMessage` (bot identity), not the slack-claude-jembot MCP connector (unreachable from the Fly runtime).

**Why:** Auth telemetry was written and displayed in the cockpit Operation Log but wired into no health check and no notification path — so a persistent OAuth failure could run for hours while the Checks tab stayed green and the operator was never told (observed 2026-06-23). Real-time server-side delivery catches failures 24/7 regardless of whether the operator's Mac is awake; piggybacking on the existing best-effort/non-blocking auth-telemetry write keeps it off the latency-critical path.

**Alternatives rejected:** Scheduled local doctor poll (misses failures while the Mac sleeps); scheduled cloud routine driving the jembot MCP (most moving parts; the interactively-authed MCP may be absent in headless cron runs). A new metrics DB/daemon — rejected; cooldown/dispatch state reuses `brain.sync_events` via a new `hosted_mcp_auth_alert` event type.

**Related:** `docs/specs/004-hosted-auth-failure-alerting.md`; `src/services/auth-alert.ts`; `src/services/slack.ts`; `scripts/hosted-doctor.mjs`; `docs/hosted-cockpit.md`.

---

## 2026-06-23 — Durable OAuth state migration intentionally invalidates pre-existing connector registrations

**Decision:** Record that the 2026-06-22 `Harden hosted OAuth connector state` deploy (`brain.oauth_state` migration, releases v17/v18) intentionally starts the client-registration store empty, which is a one-time forced re-auth of every connector holding a pre-migration `client_id`. The resulting `invalid_client` spike on the `oauth_token` endpoint is an expected, self-healing consequence as connectors re-register via dynamic client registration — not an incident.

**Why:** The migration moved OAuth client/session state into Postgres so a Fly machine replacement can no longer strand cloud-synced clients. The migration file documents that rationale, but the operational side-effect (existing connectors invalidated → expected `invalid_client` wave) was not recorded anywhere, so the spike read as a fresh fire on 2026-06-23 — compounded by `hosted_mcp_auth` telemetry being introduced in the same deploy, giving the errors no pre-deploy baseline. This entry makes the next such spike immediately attributable.

**Alternatives rejected:** Leaving the consequence implicit in the migration header and commit message (what caused the 2026-06-23 confusion); attempting to migrate/preserve old in-memory registrations (unnecessary — dynamic client registration re-establishes them).

**Related:** `db/migrations/2026-06-22_001_durable_oauth_state.sql`; commit `52324c4`; `src/oauth/postgres-state.ts`; the 2026-06-23 `hosted_mcp_auth` analysis.

---

## 2026-06-17 — Verify hosted Brain on Claude personal and ERS accounts

**Decision:** Treat hosted Brain as activated and verified for both the Claude personal Max account and the Claude ERS account, strictly for John's personal use of `ai-brain-jem`.

**Why:** The personal Max and ERS verifications prove the hosted `/mcp` endpoint, GitHub OAuth flow, and revision-backed Brain tools work from Claude's cloud-synced custom connector path across John's account surfaces. The ERS connector is a user-scope path for John to reach his own JEM Brain from that account; it is not an ERS team rollout or a multi-user tenancy milestone.

**Alternatives rejected:** Keeping Claude ERS grouped with unverified Claude accounts; treating ERS account verification as an org-wide/team deployment; reopening the OpenAI/Codex/ChatGPT cutover decisions.

**Related:** `docs/hosted-client-cutover.md`; `docs/ROADMAP.md`; `https://jem-brain-mcp.fly.dev/mcp`.

---

## 2026-06-16 — Verify hosted Brain across OpenAI accounts before Claude rollout

**Decision:** Treat hosted Brain as deployed and verified for OpenAI surfaces after successful Codex verification plus ChatGPT verification in both ERS and personal OpenAI accounts. The next client rollout target is Claude surfaces for both personal and ERS accounts.

**Why:** Cross-account OpenAI verification proves the hosted `/mcp` endpoint, OAuth registration, and revision-backed `brain_sync_status` path work outside the local Codex-only configuration. Recording this as the handoff point keeps the next phase focused on Claude enrollment and verification rather than re-litigating OpenAI readiness.

**Alternatives rejected:** Waiting for Claude before recording OpenAI cutover success; treating one ChatGPT account as enough account-surface proof; moving immediately to cockpit productization without marking Claude as the next client deployment target.

**Related:** `docs/hosted-client-cutover.md`; `docs/ROADMAP.md`; `https://jem-brain-mcp.fly.dev/mcp`.

---

## 2026-06-16 — Make hosted Brain the default Codex connector

**Decision:** Codex now uses hosted Brain MCP as the default `brain` connector, and the previous local stdio connector is retained as `brain-local` for fallback and local filesystem-heavy work. ChatGPT uses the same hosted `/mcp` endpoint through its server-side connector settings.

**Why:** The hosted MCP path passed scripted and real-client rehearsal, and the user explicitly requested full cutover for OpenAI clients. Keeping the local connector under a fallback name preserves the local-first recovery path without leaving Codex's default Brain tool on filesystem mode.

**Alternatives rejected:** Leaving Codex default on local stdio after promotion; removing the local fallback entirely; trying to edit ChatGPT Electron caches instead of using ChatGPT's connector settings; using separate Brain endpoints for Codex and ChatGPT.

**Related:** `~/.codex/config.toml`; `docs/hosted-client-cutover.md`; `https://jem-brain-mcp.fly.dev/mcp`.

---

## 2026-06-16 — Promote hosted Brain MCP as the normal remote JEM path

**Decision:** Hosted `brain-hosted` is promoted as the normal remote MCP path for `ai-brain-jem`, while local stdio `brain` remains configured for fast local work, source-file handling, and recovery.

**Why:** The hosted test drive passed with hosted/local sync parity, OAuth reuse, conflict lifecycle, latency reporting, zero open conflicts, and a fresh local sync loop. A real hosted client shadow rehearsal then passed, and the post-rehearsal cockpit doctor reported hosted health green, 50 hosted files, 0 open conflicts, and fresh sync health. This satisfies the JEM remote-client promotion gate without weakening the local-first contract.

**Alternatives rejected:** Keeping hosted as a smoke-script-only pilot after a successful real-client rehearsal; removing the local stdio connector; making hosted mandatory for local filesystem-heavy work; waiting for multi-Brain or ERS tenancy before using the JEM remote path.

**Related:** `docs/hosted-client-cutover.md`; `docs/ROADMAP.md`; `npm run hosted:test-drive`; `npm run hosted:cockpit`.

---

## 2026-06-16 — Rehearse hosted MCP as a shadow client connector before promotion

**Decision:** Add hosted Brain MCP to Claude/Codex as a separate `brain-hosted` connector for real-client rehearsal before making it the normal remote JEM path, while preserving the local stdio `brain` connector as the default local fallback.

**Why:** The hosted test drive now verifies the server, OAuth smoke, sync parity, conflict lifecycle, and latency, but the final cutover risk is client enrollment and day-to-day ergonomics. A shadow connector lets a real client prove OAuth, reads, writes, cockpit visibility, and local mirror catch-up without removing the trusted local path.

**Alternatives rejected:** Replacing the local `brain` connector immediately after a passing scripted rehearsal; requiring every local Claude/Codex session to use hosted MCP before a real shadow session; leaving hosted usable only through bespoke smoke scripts; removing the local fallback during the JEM pilot.

**Related:** `docs/hosted-client-cutover.md`; `docs/ROADMAP.md`; `docs/deploy-fly.md`; `npm run hosted:test-drive`; `npm run hosted:doctor`.

---

## 2026-06-16 — Automate Brain maintenance and proactively surface required user action

**Decision:** Brain MCP maintenance must be automation-first: routine linting, sync health, hosted health, conflict detection, and stale-state checks should run through tools or scheduled/operator commands, and any issue needing human judgement must be clearly and proactively surfaced to the user with the next required action.

**Why:** The Brain is meant to reduce cognitive and operational load, not create a second system the user must manually babysit. Sync conflicts, lint drift, stale daemon health, and source-ingestion issues are real, but they should be detected automatically and presented as actionable exceptions. Manual work is acceptable only where semantic judgement is required, such as choosing the correct merged Markdown content for a conflict.

**Alternatives rejected:** Requiring users to remember maintenance commands; burying sync/lint failures in logs; silently resolving semantic conflicts; treating hosted Brain operation as an expert-only database/admin workflow; making every routine check a manual user ritual.

**Related:** `docs/ROADMAP.md`; `docs/conflict-resolution.md`; `docs/deploy-fly.md`; `brain_load_context` lint/inbox nudges; `npm run hosted:doctor`.

---

## 2026-06-16 — Stage hosted Brain cutover before ERS multi-tenant buildout

**Decision:** Treat the JEM hosted Brain as a local-first pilot that must become operationally boring before normal remote-client cutover, then build multi-Brain support, ERS-owned Supabase migration, ERS multi-user access, and true multi-tenant product shape in that order.

**Why:** The rebuild has proven the core Supabase-backed sync, conflict, and OAuth paths, but production trust depends on repeatable operator checks, daemon health, conflict resolution guidance, and recovery rehearsal. ERS multi-user and multi-tenant work should build on a proven single-user/multi-Brain contract rather than mixing product tenancy concerns into the remaining JEM pilot hardening.

**Alternatives rejected:** Cutting over hosted MCP immediately because tests pass once; treating hosted cutover as abandoning local Markdown; building ERS multi-tenant machinery before multi-Brain routing and operational recovery are proven; treating John's private Supabase pilot as final ERS production infrastructure.

**Related:** `docs/ROADMAP.md`; `docs/specs/002-local-first-hosted-sync-contract.md`; `docs/specs/003-hosted-brain-sync-architecture.md`.

---

## 2026-06-14 — Remove git hot path from Fly hosted runtime config

**Decision:** The committed Fly runtime config, Docker image, and entrypoint must represent the Supabase-backed hosted Brain runtime, not the retired git working-copy pilot. Fly must not mount a deploy key, install SSH/git only for hosted writes, or enable `BRAIN_AUTO_SYNC`/`BRAIN_AUTO_PUSH` for the Supabase-backed server.

**Why:** Documentation already retired the hosted git hot path, but executable deployment files still preserved it. That mismatch could accidentally redeploy the old architecture with sensitive Brain data and recreate local/hosted drift. Keeping deployment-specific Supabase URLs and credentials in Fly secrets also preserves the future ERS-owned Supabase cutover path.

**Alternatives rejected:** Leaving the old Fly config as a historical artifact; keeping deploy-key support in the image "just in case"; committing the pilot Supabase project URL into `fly.toml`; treating docs as sufficient protection against deploying the wrong runtime.

**Related:** `fly.toml`; `Dockerfile`; `scripts/fly-entrypoint.sh`; `docs/deploy-fly.md`; `docs/specs/003-hosted-brain-sync-architecture.md`.

---

## 2026-06-14 — Keep artifact byte access out of the normal hosted runtime

**Decision:** Normal hosted Brain runtime may use Supabase Storage as the artifact authority while running in `BRAIN_ARTIFACT_BYTE_ACCESS=metadata_only` mode, without a Supabase service-role key. Service-role-backed Storage byte access is restricted to explicit ingestion/admin operations with `BRAIN_ARTIFACT_BYTE_ACCESS=admin`.

**Why:** Hosted source tools currently expose Postgres manifests and extracted text, not original binary bytes. Requiring a broad Storage service key in the public hosted MCP runtime increases blast radius without providing runtime value. Separating metadata/search from byte upload/download lets the runtime use the narrower `brain_runtime` database login while keeping original artifact byte handling behind explicit operator/admin paths.

**Alternatives rejected:** Requiring `BRAIN_SUPABASE_SERVICE_ROLE_KEY` for every hosted runtime process; exposing signed URLs or raw artifact bytes before the download authorization model is designed; treating Supabase Storage object access as equivalent to Postgres metadata access.

**Related:** `docs/security/hosted-brain-supabase-security-gate.md`; `docs/deploy-fly.md`; `src/services/runtime-config.ts`.

---

## 2026-06-14 — Use a dedicated Brain runtime database role

**Decision:** Use a no-login `brain_runtime` Postgres role as the server-side database access boundary for hosted Brain revision/source metadata traffic. Dedicated runtime login roles may inherit `brain_runtime`; browser/client roles (`anon`, `authenticated`, `public`) must not receive Brain schema access.

**Why:** The hosted runtime needs transactional read/write access to private Brain tables while preserving the decision that Brain data is not exposed through Supabase client roles or the public Data API. A dedicated runtime role avoids routine use of the database owner/service-role connection for revision traffic and keeps the future ERS production cutover portable.

**Alternatives rejected:** Continuing to use a privileged database owner connection for all hosted runtime queries; granting `anon`/`authenticated` table access before the end-user access model is designed; using `BYPASSRLS` for the runtime role; putting Brain tables into an exposed schema.

**Related:** `db/migrations/2026-06-14_003_brain_runtime_role.sql`; `docs/security/hosted-brain-supabase-security-gate.md`; `docs/specs/003-hosted-brain-sync-architecture.md`.

---

## 2026-06-14 — Treat Supabase security as a pre-ingestion gate

**Decision:** Before continuing hosted Brain migration work with sensitive data, record and pass a Supabase security gate for the pilot project. The gate requires the `brain` schema to remain private, Brain tables to have RLS enabled with no public/client policies, the artifact bucket to remain private, security advisors to be free of active WARN/ERROR findings, and privileged credentials to stay out of chat, docs, commits, logs, and screenshots.

**Why:** Hosted Brain will contain private Markdown revisions, source provenance, extracted source text, and original artifacts. The main leak risk at this stage is not anonymous database access, but accidentally exposing privileged Supabase credentials or widening schema/API access before the hosted access model is designed.

**Alternatives rejected:** Importing sensitive data before checking grants, RLS, policies, Storage privacy, and advisor output. Treating private bucket status alone as sufficient. Adding broad `anon`/`authenticated` grants early for convenience. Treating the private-org pilot as production security approval for the future ERS-owned project.

**Related:** `docs/security/hosted-brain-supabase-security-gate.md`; `docs/specs/003-hosted-brain-sync-architecture.md`; `db/migrations/2026-06-14_002_harden_hosted_brain_advisors.sql`.

---

## 2026-06-14 — Use a dedicated Supabase project and preserve ERS account portability

**Decision:** Create a new dedicated Supabase project for hosted Brain in John's private Supabase org for the first MCP rebuild/pilot, then migrate to an ERS-owned Supabase project before ERS production cutover. Existing application projects such as Promptalis, Social Creator, Fizbit-DM, or TeachMeIn5 must not host Brain production state.

**Why:** Brain storage will contain private Markdown revisions, source provenance, original artifacts, and future ERS-owned operational data. Starting in John's private org is the fastest controlled pilot path, but ERS production data must be owned by ERS, with billing, access control, audit, and account continuity separated from John's personal/private Supabase account. A dedicated project also keeps migration, backup, RLS, Storage, and lifecycle policies clean.

**Alternatives rejected:** Reusing an existing Supabase app project; hard-coding project refs, org ids, bucket URLs, or account-specific assumptions into the server; treating the private-org pilot as final ERS production infrastructure; using a shared Supabase project for unrelated applications and Brain state.

**Related:** `docs/specs/003-hosted-brain-sync-architecture.md`; prior decision "2026-06-14 — Use Postgres plus Supabase Storage for production hosted Brain state".

---

## 2026-06-14 — Use immutable Supabase Storage object paths for source artifacts

**Decision:** Store Brain source artifacts in a private Supabase Storage bucket named `brain-artifacts` using immutable object paths that include Brain id, source id, artifact kind, content hash, and sanitized original filename. Postgres stores the manifest row and provenance; object uploads default to `upsert=false`.

**Why:** Source artifacts are evidence, not mutable working files. Immutable paths prevent silent overwrites, avoid stale CDN/cache behavior, make duplicate detection checksum-driven, and keep the Postgres revision path focused on Markdown state and metadata. This also works for large/binary inputs while allowing SharePoint/OneDrive pointers where those systems remain canonical.

**Alternatives rejected:** Mutable object names such as `latest.pdf`; using Storage as the source of truth for curated Markdown revisions; storing binary content directly in Postgres; making the artifact bucket public.

**Related:** `docs/specs/003-hosted-brain-sync-architecture.md`; `db/migrations/2026-06-14_001_hosted_brain_postgres.sql`.

---

## 2026-06-14 — Use Postgres plus Supabase Storage for production hosted Brain state

**Decision:** Use Postgres as the production `RevisionStore` and metadata database, with Supabase Storage private buckets for original binary/source artifacts. Curated Markdown revisions, sync cursors, conflicts, source provenance, extracted text, and future semantic chunks live in Postgres; PDFs, DOCX files, images, audio, and other original binaries live in object storage with Postgres manifest rows.

**Why:** Brain file revisions need transactional compare-and-swap writes, conflict tracking, audit metadata, cursors, and future RLS/pgvector support. Original source artifacts need blob/object semantics, retention metadata, checksums, and private access control without bloating database backups or mixing binary storage into the hot revision path. Supabase is a good fit because it provides managed Postgres plus integrated private Storage, while still leaving room for self-hosting or a Mac mini Postgres later.

**Alternatives rejected:** Storing original binaries as Postgres `bytea` except for tiny test fixtures. Using Supabase Storage as the authority for Markdown revisions. Treating SharePoint/OneDrive as the universal platform store; it remains an ERS collaboration/canonical-source adapter where appropriate, not the core Brain revision engine. Continuing with file-backed JSON beyond local harness tests.

**Related:** `docs/specs/003-hosted-brain-sync-architecture.md`; prior decision "2026-06-14 — Rebuild hosted Brain around replicated revisions, not git hot path".

---

## 2026-06-14 — Rebuild hosted Brain around replicated revisions, not git hot path

**Decision:** Rebuild hosted Brain sync around a hosted revision store plus local sync agent, with local Markdown preserved as a first-class editing surface and git demoted to async backup/export/history rather than live sync transport.

**Why:** The Fly/git pilot made remote MCP reachable but failed the local-first product contract: hosted writes did not automatically update the local Markdown Brain, local edits had no automatic hosted propagation path, and git push/pull semantics created drift and latency risk. A revision store with compare-and-swap writes, local sync cursors, and explicit conflicts directly addresses the required hosted-to-local, local-to-hosted, dirty-file block, and latency-instrumented acceptance tests.

**Alternatives rejected:** Continuing to patch the Fly hosted working copy as the default architecture. Treating GitHub as the live sync fabric because it already provides backup/history. Making local Markdown a stale export of a cloud-only Brain. Re-enabling `brain-hosted` as an active Codex connector before the sync contract passes.

**Related:** `docs/specs/003-hosted-brain-sync-architecture.md`; `docs/specs/002-local-first-hosted-sync-contract.md`; prior decision "2026-06-14 — Revert Codex to local Brain MCP while hosted is rebuilt".

---

## 2026-06-14 — Revert Codex to local Brain MCP while hosted is rebuilt

**Decision:** Remove the experimental `brain-hosted` MCP registration from Codex and keep the existing local stdio `brain` MCP as the active/default Brain path while the hosted architecture is rebuilt against the local-first sync contract.

**Why:** The hosted pilot introduced regressions against the actual working baseline: higher latency, hosted writes that did not automatically update the local Markdown working surface, and an unclear path for local edits to sync back to hosted clients. Remote/mobile access remains required, but it cannot come at the cost of the current local MCP behavior.

**Alternatives rejected:** Continuing to use hosted MCP as the default while fixing sync later. Treating Fly/GitHub availability as sufficient proof of Brain platform success. Removing the hosted work entirely; it remains a useful pilot and deployment reference, but not the load-bearing connector.

**Related:** `docs/specs/002-local-first-hosted-sync-contract.md`; prior decision "2026-06-14 — Put git-backed hosted Brain architecture under review".

---

## 2026-06-14 — Put git-backed hosted Brain architecture under review

**Decision:** Do not treat the Fly + git working-copy pilot as the settled architecture. Further hosted Brain work must satisfy the local-first hosted sync contract before it is considered successful, and git's role must be re-derived from requirements rather than inherited from the local-only backup workflow.

**Why:** The pilot proved hosted OAuth/MCP reachability and hosted auto-commit/push, but exposed a product regression: remote writes did not automatically update John's primary local Markdown working surface, and local edits did not have a defined path back to the hosted server. GitHub was originally a backup/versioning layer; using it as live sync requires an explicit decision and complete bidirectional verification.

**Alternatives rejected:** Continuing to patch around local drift without revisiting storage/sync architecture. Treating GitHub as the hot path simply because it was already present. Blocking all hosted progress indefinitely; the interim host remains useful if it can meet the sync contract and stay portable to the future Mac mini.

**Related:** `docs/specs/002-local-first-hosted-sync-contract.md`; prior decision "2026-06-13 — Pilot hosted Brain on Fly with filesystem git storage".

---

## 2026-06-13 — Pilot hosted Brain on Fly with filesystem git storage

**Decision:** Use Fly.io plus a persistent volume as the first hosted Brain MCP runtime, preserving the current Markdown filesystem and git working-copy model.

**Why:** The current server edits Markdown files in a real git checkout and relies on commit/push behavior, so a Node runtime with durable filesystem state is the fastest low-regression path to remote MCP access. This requires a repo-scoped deploy key on the host; revisit whether a cloud database/content-store backend would provide a better long-term security and operations model after the hosted pilot proves the product flow.

**Alternatives rejected:** Cloudflare Workers + D1/KV as the first host because the Brain needs filesystem git operations in Phase 2. Cloud database as source of truth deferred because it would change the storage model and local Markdown/git workflows.

**Related:** `docs/specs/001-brain-platform-phase-1-2.md`; `BACKLOG.md` item "Revisit Brain Platform storage architecture after hosted Fly pilot".

---

<!-- Template for a new entry. Copy-paste, fill in, leave the divider. -->

<!--
## YYYY-MM-DD — <Short title of the decision>

**Decision:** <One sentence — what was locked in.>

**Why:** <The constraint, insight, or trade-off that drove it. The reasoning that future-you needs to evaluate whether this still applies.>

**Alternatives rejected:** <What else was on the table. One line each.>

**Related:** <Spec NNN, PR link, audit reference, or the conversation that produced it.>

---
-->
