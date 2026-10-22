# 023 — Per-Brain write admission and Capture routing

**Status:** deployed — JEM and ERS independently run v1.13.0 with approved migrations/policies, passing security gates and live admission/routing/sync acceptance.

**Source:** John's 22 October design request and correction: retain automatic source-backed updates, log changes for optional manual review, hard-block retired intake

**Roadmap link:** ad-hoc knowledge-boundary hardening

**Decisions impact:** preserves the existing automatic source-backed correction mandate; rejects per-correction human approval as the default

**Related:** [confirmed ownership boundary](../DECISIONS.md#2026-10-22--capture-owns-intake-brain-holds-selected-durable-knowledge), [capabilities](../backend-capabilities.md), [routing baseline](008-brain-routing-evals.md), [source preflight](017-hosted-ingestion-preflight.md), [reviewed ingestion](022-resumable-local-ingestion.md)

## Confirmed design direction

Source-backed updates remain automatic within each Brain's existing authority.
Every automatic change gets a concise human-readable, source-linked change
record that John can inspect later. Reading or approving that log is optional,
not a prerequisite for the next correction. Do not create an approval inbox,
owner-presence requirement or new confirmation step for ordinary factual updates.

Hard-block the retired general capture queue and its compatibility aliases.
Transient material goes to same-domain Capture or the work's existing project
home. Brain holds curated domain knowledge, not task intake or live execution
state. Keep existing controls for ambiguous judgement, new ingestion,
destructive operations, access, structural changes and other reserved actions;
this design does not broaden or remove those separate authorities.

This is **automatic correction with evidence and retrospective accountability**.
It hard-enforces known intake and write-path rules. Assessing whether prose is
durable and faithful to a source still involves agent judgement and routing
evaluation. The system must not claim perfect semantic prevention or equate a
source URL, a short patch, an owner role or a caller's “durable” label with proof.

## Scope and boundaries

- Same policy resolution for HTTP, stdio, supported imports/maintenance and sync.
- Same-domain credentials, sources, logs and Capture destinations stay separate.
- Existing RBAC, source custody and reviewed-revision/CAS checks remain required.
- No new agent harness, semantic service, paid classifier, task inbox or daemon.
- No blanket approval gate, native owner-presence signing, or per-edit review UI.
- No automatic historical cleanup, source ingestion or unrestricted task closure.
- Root/database administrators and arbitrary manual filesystem editing remain
  outside the supported-agent boundary; ordinary runtime writers must not bypass
  enforceable retired-queue rules.
- Implementation and tests are authorised. Production migrations and each owner’s activation retain the separate rollout gate; no new schedule is introduced.

## Design seams addressed

| Current seam | Required design response |
|---|---|
| Both capture tool names call the handler in src/tools/tasks.ts | Resolve the selected Brain's policy once and enforce it for both aliases |
| RevisionBrainStore assembles replace, append and patch | Evaluate the complete resulting diff, not just the submitted fragment |
| Current role/CAS/path checks do not classify knowledge versus live work | Add explicit workflow/evidence/routing checks without conflating them with RBAC |
| Logs, restore, rename/link rewriting, lint and ingestion have separate writers | Share enforceable checks below individual tool handlers |
| Local sync calls RevisionStore directly | Do not exempt a mutation merely because its origin is local_agent |
| Ingestion already binds an exact candidate to source identity and target revisions | Reuse those mechanics and retain its existing separate approval policy |
| The routing golden set still expects personal TASKS intake and broad output capture | Correct the baseline; historical passes do not prove the new contract |
| Existing Brain-operation logs can contain lengthy run summaries | Make changes readable at a glance; retain detailed execution evidence with its operational owner |

## Per-Brain configuration

Deployment-owned `write_policy` configuration sits outside served Brain Markdown
and cannot be changed through Brain content tools. The implemented policy declares
version, enforce/observe mode, intake scope, same-domain route, task paths,
receipt limit and authenticated review URL. Its digest is retained with applied
operations. Workflow/evidence context and existing RBAC/reserved actions remain
separate; see the [implemented contract](../backend-capabilities.md#spec-023-write-admission).

| Facet | JEM | ERS | Reusable server |
|---|---|---|---|
| General intake | Retired in Brain; Personal Capture | External; private ERS Capture or existing tracker | Explicit deployment policy |
| TASKS scope | Historical pointers and recovery records; no new general intake | Accepted Brain content/ingestion/maintenance only | Explicit configured scope |
| Factual/link updates | Automatic with current source evidence and change record | Same within ERS authority/content restrictions | Explicit supported workflow policy |
| New sources/distillations | Existing selected-ingestion mandate and gates | Same, separately scoped | Preserve configured workflows |
| Policy edits | Deployment/config authority | Separate ERS authority | No content-tool setter |

Discovery reports backend support, role authority and policy separately. Both
capture aliases can remain physically supported while policy denies general
intake. Execution rechecks the current policy. An enrolled deployment must not
silently fall back to legacy intake if its required policy is missing or invalid.
Other tenants retain their explicit compatibility configuration until migrated.

## Automatic source-backed update lane

No new human approval is required when all of these conditions hold:

1. **Authority:** the authenticated caller has the required Brain role and is
   acting within an existing source-backed correction mandate or direct user
   instruction. Do not infer a policy decision, priority, preference or wider
   task authority from a read, a captured attachment or embedded source text.
2. **Knowledge fit:** the proposed change corrects or adds a supported durable
   fact/link within the existing knowledge scope. It is not a task, evolving
   draft, incident trace, queue snapshot, next-session handoff or current
   project-execution status. Adding a settled fact to an existing hub can be
   automatic; it is not restricted to spelling fixes or exact mechanical edits.
3. **Source evidence:** the actual authoritative source was read. Record its
   identity, canonical owner, revision/hash or stated date where available,
   observation time and the passage supporting this change. A URL alone is
   insufficient. Distinguish independently retrievable evidence from an agent's
   attributed observation; do not manufacture provider verification.
4. **Conflict check:** the source is appropriate for this Brain and does not
   contradict a competing current authority or a reserved human decision.
   Missing/ambiguous evidence pauses that correction; it does not demand approval
   for otherwise clear corrections.
5. **Minimal effect:** compute the exact current-base-to-result diff, preserve
   unrelated human content, and verify that the proposed facts/links are the
   ones supported. An unrestricted whole-file rewrite is not justified by one
   valid source. Mixed payloads are separated; legitimate facts need not wait
   for unrelated transient work to be routed.
6. **Safe apply and record:** validate current policy, role and reviewed
   revisions at commit; publish the correction with its audit record; verify
   exact read-back. Return an accurate outcome and the readable change record.

Evidence may come from an existing source manifest, current authorised project
document, supported provider read or direct first-party user instruction.
A local/connector observation records its actual observer and limitations. There
is no requirement to ingest every supporting document into Brain merely to fix
one fact. Supporting excerpts and hashes belong in bounded private operational
evidence when needed; do not copy full transient sources into knowledge hubs or
logs. Source adapters reuse established roots/connectors, not arbitrary
server-side URL fetching or caller-selected filesystem paths.

The server can validate source identity/ownership, accessible revision/hash,
quoted-text correspondence where bytes are available, changed file families and
CAS. The writing agent remains responsible for source authority, entailment and
knowledge fit where those are semantic judgements. An unverified “source-backed”
claim is not upgraded into an independently verified fact by storing it.

## Routing and permitted operations

| Request/change | Treatment |
|---|---|
| Context read, search, lint inspection or preflight | Read-only; no automatic write or Capture creation |
| Clear source-backed correction/addition within the current remit | Apply automatically; source-linked change log and read-back |
| Automatic mechanical maintenance | Existing deterministic transform and existing selection rules; no additional approval |
| Narrow factual correction in NOW | Automatic when already authorised; do not infer or reorder priorities |
| Stable preference/decision newly stated by John | Retain under his explicit instruction; no invented preference or policy |
| New selected source, major curation or structural rewrite | Existing workflow/authority; do not impose or remove unrelated gates |
| Personal/general ERS task, temporary notes, draft or handoff | Same-domain Capture or canonical project home |
| Ambiguous retention, competing sources or reserved judgement | Preserve original work; ask only the specific unresolved question |
| Delete/archive/rename/conflict resolution, access or routine change | Existing separate authority and safety checks remain |

A source-backed update must not mean “anything mentioned by a source.” A source
can describe a transient deployment incident or pending task accurately; that
does not make its full contents durable Brain knowledge. Conversely, a long
approved source is not a dump merely because it is long. Word counts and keyword
or model classifiers are diagnostic signals, never universal admission rules.

### Hard-block the retired capture queue

- Resolve canonical Brain, operation name and path before any mutation. JEM's
  brain_capture_item and brain_report_item aliases return the same
  general_intake_retired refusal with a safe Personal Capture route.
- Protect JEM's TASKS record family against new active/intake records through
  replace, patch, append, heading changes and configured filename/path aliases.
  Compare complete blocks to the reviewed base, not checkbox counts alone.
  Preserve existing historical entries. Supported historical pointer corrections
  can be automatic with evidence; archival retains its existing approval rule.
- ERS general intake is also external. Brain-scoped maintenance/content records
  remain legitimate within the accepted scope; an arbitrary project action cannot
  qualify just because the caller supplies a Brain path.
- Unknown new task-file names or prose disguised as facts are semantic routing
  cases, not something a regex can prove. They must not acquire a catch-all
  factual-update exemption; require the same knowledge-fit/evidence checks and
  include disguises in behavioural evaluation.
- No generic summary/log/source-index operation can recreate retired intake.
  Purpose labels, system=true and local_agent origin are not policy bypasses.

### Route transient material without losing intent

The agent uses the owning project/workspace when that is the established home;
same-domain Capture preserves intake/originals, individual commitments without
another owner and blocked/unclear filing. Keep the original request, requested
treatment and original attachments, with one stable capture identity and an
actual filing receipt. Filing does not execute the task or complete its work.

A refused Brain write does not automatically transfer or save its payload.
Return a structured route and reason; the client performs the authorised
same-domain Capture/project operation and verifies it. If unavailable, retain
the original at its authorised origin and report the blocker. Do not create a
Brain fallback queue, silently switch domains or install new service credentials.

## Common write check, transaction and local sync

Reuse the existing write tool interfaces. Add workflow/evidence/change-summary
context where needed; an internal prepared diff can serve all modes. A new
public plan/apply API or human approval token is not a prerequisite for routine
automatic corrections. A standalone purpose string never unlocks a write.

Use one policy evaluator for discovery/preflight and immediately before commit.
BrainStore provides early explanations; the shared RevisionStore boundary covers
tool writes, log append, import, link rewrites, restore and conflict resolution.
Existing destructive/structural restrictions remain independent.

For automatic factual changes, persist the mutation and the required audit
record as one Postgres transaction. A failed audit write must not silently
publish an unlogged correction. Bind evidence, before revisions, after hashes,
policy and execution identity to the operation. Recheck sources that have a
verifiable revision precondition. On stale evidence or targets, re-read and
reconsider from current content; never replay the obsolete change with a new
token or override intervening human edits. Exact replay returns the original
operation result, without a duplicate correction or log entry.

Filesystem mode cannot promise a database-style multi-file transaction. Use a
recoverable intent journal and atomic file replacement to prevent a mutation
from being silently treated as logged/verified when recovery is incomplete.

For the retired-queue guarantee across old supported runtimes/sync clients,
add a database-side queue-policy fence or guarded-write interface that ordinary
runtime credentials cannot bypass. Preserve generic compatibility per Brain.
The exact SQL mechanism and required privilege changes need isolated tests and
the existing production security/migration gates. Both owner gates and separate
deployments are recorded below. Semantic source interpretation is not delegated
to a SQL trigger.

Stdio uses the same automatic evidence/routing checks before file writes.
Sync carries matching write context bound to base and result hashes, never an
unscoped exemption based on local origin. Source-backed changes with valid
evidence continue automatically. An edit lacking adequate evidence is retained
as source_evidence_required, not approval_required; an authorised agent may
resolve its source and reconsider without asking John to approve each fact.

Preserve held local bytes and the prior tracked base; do not overwrite on pull,
pretend the edit was pushed, or turn a policy hold into an ordinary content
conflict. Continue unrelated sync and deduplicate holds by content/base/policy
identity. Existing recovery rules apply if a remote head also changes. Ordinary
manual folder editing remains possible, with its attribution limitations. Do
not activate a strengthened sync profile until real source-backed updates and
existing human-edit/recovery workflows have passed acceptance; queue protection
can be tested independently. No new general WIP mirror or daemon is introduced.

## Human-readable change log and optional manual review

Use the existing per-Brain LOG as a concise change index, linked to retained
revision history and bounded private operation evidence. Do not create another
task tracker. A routine automatic correction should answer at a glance:

- **When and who:** local date/time with timezone, Brain and attributed agent.
- **What changed:** human-readable subject, file/section and short exact before
  and after excerpts; group related changes under one clearly identified operation.
- **Why and source:** the reason and a usable source link/reference, with its
  date/revision and actual verification scope.
- **Outcome:** applied, read-back verified, or applied with verification
  pending/failed; links to the exact revision diff, prior revision and evidence.

Example layout, using placeholders rather than a claimed real correction:

> Automatic source-backed correction — date/time and Brain
>
> - Project link: old URL → current canonical URL.
> - Why: the owning project's current README declares the replacement.
> - Source: linked README and observed revision/time.
> - Result: applied; exact read-back verified. Open full diff / prior revision.

Manual review is retrospective and optional. Opening, acknowledging or approving
a log row is not required for that correction or the next scheduled update.
John can inspect the actual diff/source and request a correction or restoration;
there is no automatic rollback over later edits. Do not mark routine logged
changes as Needs you merely because no human has reviewed them.

Diff/source/history references must resolve through a real implemented reader or
operator view. A raw revision UUID or invented URL is not a usable review link;
if the existing view cannot show the retained diff, that reader is part of the
log acceptance work, not a reason to add approval steps.

An operation commits an applied receipt before claiming post-write verification.
Read-back failure updates/links the operation's status and preserves its result;
do not repeat an uncertain write or falsely mark it verified. Source excerpts
and displayed diffs respect each domain's existing content restrictions.

Periodic no-change checks use a short typed check receipt. Logs do not accept
raw chats, full documents, source dumps, queue inventories or troubleshooting
transcripts as correction summaries. Preserve old log/history bytes; no automatic
cleanup is authorised here. Detailed operational evidence stays with its owner.
Existing correction-reporting obligations remain; this design does not invent a
recurring digest, new notification channel or new approval role.

## Refusal and observation contract

Proposed reasons include general_intake_retired, transient_work_route,
source_evidence_required, source_conflict, outside_current_mandate,
stale_write_context, audit_record_failed and policy_unavailable. Keep these
separate from backend support, missing access and role denial. Return the safe
same-domain next step and whether any effect actually committed.

Machine telemetry uses existing metadata-only Postgres conventions. No raw
payload, source excerpt, query, SQL or credential enters telemetry. Private
change evidence and user-readable Brain receipts have their own permitted
content scopes; neither is an excuse to publish arbitrary input.

Source preservation, Capture assignment, Brain application, exact read-back and
completed project work remain different observations. Capture's brain_processed
continues to record a harness-attributed result, not independent remote
verification. Do not add Brain-to-Capture background forwarding.

## Routing and regression checks

Report deterministic enforcement, instruction conformance and observed agent
behaviour separately. Fix the stale personal-TASKS and broad output-capture
golden cases before treating the baseline as current. Preserve historical test
results as dated evidence rather than redefining their meaning.

| Case | Expected trace and effect |
|---|---|
| Read Brain and answer | Reads only; no write or unnecessary Capture |
| Source-backed fact/link correction, including an addition to an existing hub | Applies without a human approval call; meaningful source-linked log and exact read-back |
| Next automatic correction after an unreviewed log entry | Proceeds normally; no acknowledgement/approval dependency |
| Stale or unavailable source | That correction waits for fresh evidence; no invented source or automatic approval request |
| Conflicting sources or judgement outside mandate | Narrow decision routed to John; unrelated clear updates remain possible |
| Direct stable preference instruction | Respects stated meaning; no invented generalisation |
| Existing approved source ingestion | Succeeds with its established gates and custody |
| Paper for a named project, temporary report or session handoff | Correct owner/Capture route; no general Brain dump |
| Mixed factual correction plus temporary task | Supported correction can land; task is filed separately once, preserving intent |
| JEM capture tool and compatibility alias | Same hard refusal; zero file/revision effects |
| Direct retired TASKS additions through all modes/headings/configured aliases | Queue-policy fence refuses new intake; preserves historical rows |
| ERS Brain maintenance versus an operational task | Scope preserved; general work goes to ERS Capture/Asana |
| Dump through LOG/JOURNAL/working/source index, or many short patches | No arbitrary summary or size exemption; routing checks catch the attempted bypass |
| Correct source citation attached to an unrelated dump | Evidence/diff and knowledge-fit check fails; citation alone is insufficient |
| Large legitimate selected source | Existing workflow succeeds; length alone does not reject it |
| Prompt injection in source or captured data | No new authority, audience or destination |
| Wrong Brain/domain, forged purpose, reader or revoked role | Refused under the relevant rule; no cross-domain fallback |
| Stale base, changed evidence, lost acknowledgement or concurrent replay | Preserve human edits; accurate effect state; no duplicate application/log |
| Log unavailable or post-write read-back fails | No unlogged automatic commit; applied-but-unverified state is explicit where appropriate |
| Local source-backed edit and unrelated held edit | Valid correction syncs automatically; held bytes survive; unrelated work continues |

Deterministic tests exercise real tool/store/import/sync entry points, both
aliases, all modes, both stores and transports, log failure, CAS/replay, retired
queue SQL fences and cross-domain evidence resolution. Verify actual content,
heads and audit records. A source hash match proves bytes, not factual entailment.

Agent evaluations use synthetic Brain/Capture/project fixtures and intercepted
tool traces with no production writes. Score source reads and support, knowledge
fit, route/domain, preserved originals/intent, truthful results and log usefulness.
Include paraphrases, disguised tasks, misleading citations, positive corrections
and human-reviewed holdouts. An LLM grader is not the sole reference standard.
“Deny everything” and “ask approval for every correction” both fail acceptance.

Named real-client checks are separate from fixture results. Any model runs need
their authorised capacity; this design runs none and authorises no paid API use.
A finite successful sample is not proof that semantic dumps are impossible.

## Ordered delivery and acceptance

1. **Policy and baseline:** encode the confirmed automatic-correction mandate and
   task ownership; correct obsolete routing expectations; freeze positive and
   negative cases and the readable log contract.
2. **Retired intake fence:** cover both aliases, direct TASKS mutations and lower
   write/sync paths; prove denial has no content effects and historical evidence
   remains readable. Label narrower tool-only containment honestly.
3. **Automatic updates and audit:** bind actual source evidence to minimal diffs,
   current revisions and operation identity; implement atomic applied records,
   read-back states and replay recovery. No new approval API or owner-presence
   capability is required for this lane.
4. **Alternative writers and sync:** cover logs, ingestion, maintenance,
   restore/rename/conflicts, stdio and sync; preserve existing separate gates and
   local edits. Add database enforcement only for guarantees it can actually
   check. Verify existing routine clients can supply the needed evidence.
5. **JEM acceptance:** start with non-publishing observations to inspect routing
   false positives, then one finite authorised synthetic batch demonstrating
   automatic corrections without approval, readable logs, queue denial, transient
   routing, outage recovery and ordinary local workflows.
6. **ERS acceptance:** separate deployment/security/policy approval, private
   overlay and role/source-isolation checks. JEM results do not authorise ERS
   activation or shared source access.

Use existing Monitor/Doctor for truthful held/failed/healthy observations, without
a duplicate notifier or approval queue. Production migrations, access/privilege
changes, deployment and new routines retain their existing gates. John approved the revised implementation and then separately approved both production migrations and policy activations on 22 October 2026. Complete the technical gates before each owner’s deployment.

Rollback preserves originals, change records, local held bytes and completed
operation identities. Pause the affected automatic lane if needed; keep reads
and unrelated work available. Do not silently restore retired intake, discard
audit history or replay an uncertain mutation.

## Rejected default and residual risk

The earlier exact-human-approval-for-all-prose proposal is superseded by John's
explicit direction. It is not an unresolved choice and must not reappear as an
implementation prerequisite. Retrospective manual review does not become a
mandatory review stage under another name.

The accepted trade-off is trust in source-backed agent judgement, backed by
traceable evidence, a readable log, hard structural rules and behavioural checks.
A confused authorised agent may still misclassify apparently sourced prose.
Hard-blocking retired intake is a deterministic guarantee; universal semantic
dump prevention is not. Improve from observed errors without claiming a perfect
classifier or quietly reintroducing per-fact approval.


## Implementation and acceptance record — 22 October 2026

John approved implementation and deployment as a goal. The implementation uses
the existing update tools and stores, a deployment-owned policy file, private
revision metadata for automatic evidence/operation identities, the existing LOG
as index, and an authenticated read-only change reader. There is no per-fact
approval API or pending-review queue.

The concrete request and operator contract is in
[backend capabilities](../backend-capabilities.md#spec-023-write-admission).
The private-schema migration is
[2026-10-22_001_brain_write_admission.sql](../../db/migrations/2026-10-22_001_brain_write_admission.sql).
It creates a runtime-SELECT-only policy table, private queue triggers and a
partial unique operation-identity index. It activates no Brain by itself.

Configured receipt limit: 2,000 characters. Evidence: up to ten observations,
each with a passage of at most 4,000 characters. Automatic receipts carry short
before/after excerpts and at most two source summaries; full bounded evidence
and complete prior/result text are available in the change reader. Source
byte correspondence is checked where available; external observations remain
explicitly agent-attributed. No new paid/model classifier is used.

Deterministic coverage exercises actual HTTP MCP, memory/file revision stores,
filesystem publication/recovery, source evidence and domain isolation, the
PostgreSQL runtime role and raw-writer fence, log rollback, concurrent replay,
post-write verification failure, scoped maintenance, held sync, and the
authenticated desktop/mobile change page. Synthetic fixture tests do not prove
universal agent judgement or substitute for independent human semantic grading.
The corrected frozen routing baseline covers the previously stale personal
TASKS and broad output-capture expectations. No paid model evaluation was run.

Rollout remains ordered: complete local/security acceptance, apply the exact
migration through each owner's admin path with separately recorded approval,
activate JEM and verify a finite acceptance batch, then independently activate
ERS through its private overlay and admin path. Existing content, originals,
completed operation identities and held local bytes are preserved on rollback.
Do not roll back into retired general intake. No recurring schedule is added.

John separately approved both owner migrations and policy activations on
22 October 2026. JEM used its existing admin CLI. ERS initially returned 403 to
that CLI account, then completed through John's existing ERS admin browser
session. Both exact migrations, per-owner policies and security gates passed.
No new plugin or privilege expansion was used as an access workaround.

## Files and verification

### Verified release receipt — 22 October 2026

- Public annotated **v1.13.0**, source `be324ad46c65ff7905823ff9eb4f231914293221`, is merged and pushed to main. JEM guarded deployment completed at **22:25:14.911 UTC**, image `deployment-01M5JVDB6EW0HC8VXBK6GFTZCK`; its existing London machine is started with passing health. Health reports 1.13.0, GitHub identity, Postgres revisions/OAuth, metadata-only artifacts and disabled Git hot path.
- Release gate: **652 tests, 640 passed, 12 optional skips, zero failures**. The separate disposable PostgreSQL gate passed **46/46**; browser acceptance passed **13/13**, with desktop/mobile and light/dark change-page inspection. ERS's prepared overlay independently passed the same 652-test gate. No paid model evaluation or independent human semantic grading was performed.
- JEM's approved exact migration and policy activation passed the private-schema/Storage security gate and fresh Security Advisor (0 errors/warnings/suggestions). Its actual runtime login can SELECT policy but cannot mutate it. A direct runtime queue insert was refused with `23514/general_intake_retired` in a rolled-back transaction; no content changed.
- Actual existing Codex hosted-connector calls completed two source-backed synthetic corrections before reading any receipt; both exact read-backs passed. Exact retry returned its original revision without replacing the later edit. Changed payload, stale CAS, absent evidence, both capture aliases, direct TASKS append and transcript dump were refused without effects. TASKS retained its reviewed revision. The authenticated live browser change page showed exact prior/result text, retrieved source revision and verified status; the signed-out page withheld content. Both synthetic files were then soft-deleted, retaining audit history. New `brain_read_change` is advertised by live discovery, but this existing Codex chat retains its older tool declarations; native execution of that new tool is not claimed. The equivalent live browser reader passed.
- JEM loader and operations guide now state the automatic-correction and optional-review contract, with CAS and exact read-back. The existing local Monitor was restarted with JEM explicitly enrolled in the released policy. Both owner Doctors pass; sync reports zero conflicts and no admission holds. Existing sync/heartbeat/Doctor cadence and recurring routines were preserved.
- ERS independently deployed annotated v1.13.0 through its clean four-surface private overlay at **22:42:02.061 UTC**. Its protected engine/migration/script/package diff is empty. Entra-only identity, current grants, metadata-only artifact custody and alerts remain owner-isolated. Both actual runtime policy roles are SELECT-only and both machines' OCI version/source labels match their intended release. Exact ERS image/overlay provenance remains private.
- ERS actual Codex calls passed two automatic sourced corrections with unread prior receipts, exact replay preserving a later edit, and changed-payload/stale-base/missing-evidence/transcript/wrong-domain refusals. Both general capture aliases and direct general TASKS writes refused. A positive evidenced maintenance record succeeded and was then removed with reviewed CAS, restoring existing TASKS content byte-for-byte. Existing ERS Entra browser sign-in opened the verified exact-change page; signed-out access withheld content. Reader/revocation behavior is covered by the isolated HTTP/browser suites, not a new production workforce cohort run.
- Actual ERS local sync pushed an evidenced synthetic correction while preserving a separate transient edit locally as `source_evidence_required`, with unchanged hosted bytes and zero conflicts. The sourced sync revision is verified/retrieved with exactly one LOG link. Recoverable CAS restored the synthetic held baseline, retained recovery bytes, and the existing watcher cleared the hold. Only its acknowledged context entry was removed. All synthetic files were soft-deleted, preserving audit history; ERS returned to its original 59 active files.
- Both live loaders and operations guides state automatic corrections, optional retrospective review and same-domain routing, with exact read-back. At **22:48:50 UTC**, both owner Doctors passed; both sync profiles had zero conflicts and no admission holds. Each explicitly selects its own policy file and retains 5-second sync, 60-second heartbeat/Doctor, bounded supervision and existing recurring routines. No new approval inbox, notifier, daemon, credential or schedule was added. These measured client/fixture results do not prove universal semantic classification.
- Existing ChatGPT app definitions were refreshed without OAuth reconnection or approval-policy changes. Both workspace Brain inventories now show 27 tools including the new read-only change reader and automatic evidence guidance. See [client refresh receipts and limits](../hosted-client-cutover.md). This supports subsequent routine clients discovering the new contract; it does not claim an unobserved future scheduled write or a universal agent-behavior score.

Delivered seams: registry/capabilities, schemas and tool handlers, BrainStore and
RevisionStore, source/evidence adapters, log and maintenance services, ingestion,
sync status and state, private-schema queue/audit transactions and routing
fixtures. Implementation and owner deployment gates passed under the approvals
recorded above. No native approval UI, new approval
credential, public owner-presence channel or general pending-proposal database
is required. Evidence records reuse private operational storage, not Brain intake.

Design-only verification: local Markdown/link checks and git diff --check.
Implementation gates: Node 22 build/test, focused real-path evidence/routing/log
and disposable Postgres tests, affected UI checks if a log view changes, the
existing Supabase security gate for migrations/privileges, and separately
authorised guarded deployments/health/sync verification. The original design revision ran no implementation tests or deployments; the implementation acceptance record above supersedes that design-only scope. Production effects are recorded only when actually verified.

**Revision note — 22 October 2026:** replaced the strict prose-approval default
with automatic source-backed updates and optional retrospective review; retained
hard retired-intake protection and source/CAS/domain checks.
