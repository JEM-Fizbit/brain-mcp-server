# 023 — Per-Brain write admission and Capture routing

**Status:** draft — design proposal; not approved for implementation or activation  
**Source:** BACKLOG.md item “Evaluate per-Brain enforcement and behavioural routing checks”; John's 22 October design request  
**Roadmap link:** ad-hoc knowledge-boundary hardening  
**Decisions impact:** would narrow unattended free-form factual corrections in strict mode; requires explicit approval  
**Related:** [confirmed ownership boundary](../DECISIONS.md#2026-10-22--capture-owns-intake-brain-holds-selected-durable-knowledge), [capabilities](../backend-capabilities.md), [routing baseline](008-brain-routing-evals.md), [source preflight](017-hosted-ingestion-preflight.md), [reviewed ingestion](022-resumable-local-ingestion.md)

## Recommendation and decision

Keep Brain reads unrestricted within current roles. Enforce the retired intake
policy deterministically. Admit new Brain prose only through an exact reviewed
change; retain automatic lanes for server-computed mechanical changes and typed
operation receipts. Review related factual corrections as one batch, not one
prompt per line. Existing approved curation remains possible through its normal
source/provenance workflow, with stronger approval evidence where needed.

This prevents an agent from publishing an **unreviewed** transient dump through a
supported write path. It cannot prove that human-approved content is useful or
true. A caller's `purpose=durable`, an owner role, a short patch, a source URL or
an LLM verdict is not proof of curation authority.

The material choice is **strict admission versus unrestricted automatic prose
correction**. Recommend strict admission for JEM and ERS. It adds one exact-change
approval for free-form corrections that lack an existing trusted approval. It
would narrow the current standing automatic factual-correction mandate; nothing
in this draft changes that mandate. A trusted future adapter may capture approval
already given by the user without asking again, but no current connector is
assumed to expose independently verifiable approval evidence.

## Scope and assurance boundary

- Protect normal Brain tools, ingestion, maintenance and sync from accidental or
  policy-confused agent writes, including stale clients and alternative tool names.
- Apply the same rules to hosted HTTP and local stdio. Preserve explicit source
  custody, domain/owner separation, current RBAC and reviewed-revision protection.
- Do not build a general work manager, a second Capture inbox, a paid semantic
  classifier, a new polling daemon or the deferred task-context compiler.
- A database administrator, root process or human with arbitrary filesystem
  access remains outside this application trust boundary. Ordinary runtime/sync
  database credentials must not be an escape from the hosted admission gate.
- Do not silently delete or rewrite existing Brain content. Historical tasks and
  prior revisions remain evidence; the initial rule governs new mutations.

## Observed implementation gaps

| Current seam | Consequence for this design |
|---|---|
| `src/tools/tasks.ts` applies the same capture handler to both tool names | Both names must resolve the same per-Brain policy before changing TASKS |
| `RevisionBrainStore.writeFile` assembles replace, append and patch content | Judge the resulting complete revision/diff, not only the caller's fragment |
| Store role/CAS/path checks do not check retention intent | Add admission separately from authentication, RBAC and backend capability |
| `appendLog`, restore, rename/link rewriting, conflict resolution and lint have their own write paths | A guard on `brain_update_file` alone is insufficient |
| Local sync directly calls `RevisionStore.proposeRevision` | Gate below BrainStore too; do not trust `origin=local_agent` as human proof |
| Ingestion calls `proposeRevisionInTransaction` with source metadata/receipt | Preserve atomic batch semantics and enforce admission inside that transaction |
| Ingestion approval records the configured operator actor and digest | Reuse exact-bundle/CAS mechanics; do not reinterpret the actor string as independent proof that a human approved |
| The current golden set routes a personal task to TASKS and expects broad output-capture wording | Correct those expectations before using the suite as an acceptance gate |
| Existing loopback Cockpit confirmation uses a nonce accessible to a local client | Keep its existing protections; the nonce is not proof of human presence for free-form admission |

## Per-Brain policy

Add a validated deployment-owned `write_policy` to registry/profile configuration,
outside served Brain Markdown. Agents cannot change it through Brain tools.
Names below are proposed API vocabulary, not adopted schema.

| Policy facet | JEM proposal | ERS proposal | Reusable server |
|---|---|---|---|
| General intake | Retired; route to Personal Capture | External; route to private ERS Capture | Explicit deployment policy; preserve named legacy deployments |
| Brain task scope | No new general tasks; retain historical pointers | Only accepted Brain content/ingestion/maintenance work | Explicit scope, never inferred from tool availability |
| Free-form writes | Exact approved change required | Same, within ERS role/content authority | Explicit strict or legacy compatibility mode |
| Automatic writes | Named deterministic operations and typed receipts | Same, separately configured | No universal unchecked bypass |
| Policy changes | Owner-controlled deployment/config action | Separate ERS authority | No MCP setter |

Policy includes a version/digest, configured route identifiers, approved workflow
classes, protected file families and activation mode. Personal and ERS policy/data
are never merged. Route hints contain no tokens, payloads or opposite-domain IDs.

`brain_describe` exposes a separate admission result beside backend support and
RBAC: policy mode/version, allowed workflow classes, requirements and safe next
route. Do not describe a technically supported tool as physically unsupported
merely because intake policy denies its use. Execution rechecks current policy.
An enrolled strict deployment must fail closed on absent/invalid policy; deleting
the config cannot silently restore legacy mode. Other deployments retain their
explicit compatibility configuration until separately migrated.

## Admission lanes

| Operation | Admission | Legitimate use preserved |
|---|---|---|
| Read/search/context/lint inspection/preflight | Existing role checks | Context use never creates a proposal or write |
| JEM general capture, including compatibility alias | Refuse before mutation; explain Personal Capture route | Existing historical TASKS records remain readable |
| ERS general intake through Brain capture tools | Refuse; explain private ERS Capture route | Existing Asana/project tasks remain authoritative |
| Explicit ERS Brain maintenance item | Dedicated scoped plan with valid Brain target and approved exact record | Brain content gaps remain trackable; a target reference alone does not validate the prose |
| Mechanical correction | Server recomputes a named transform from current revisions, with any existing selection approval still required | No extra free-form review for a previously authorised exact transform |
| Typed operation receipt | Server constructs a bounded receipt from an actual operation result/run record | Routine checks retain audit evidence without arbitrary summary dumps |
| Free-form fact/link correction, stable preference or decision | Exact change approved once, possibly as a batch | Small legitimate updates remain available; no arbitrary size threshold makes prose automatically safe |
| New source or knowledge distillation | Approved curation bundle plus source/provenance checks | Selected originals and useful knowledge can be retained through their existing workflow |
| Loader/NOW edit, history rewrite, rename/restore/conflict resolution | Exact approved plan plus existing structural/destructive gates | These operations remain available within their current authority |

Do not solve this with a universal word limit. A one-line TODO is transient; a
long reviewed source may be legitimate. No split-payload loophole: a series of
tiny appends has the same admission requirement as one large write. Keyword,
length and model checks may advise a reviewer or flag a case for evaluation, but
never mint authority or silently promote/rewrite content.

### Retired queue and alternative destinations

Normalise the operation and canonical path before policy evaluation. Reject both
capture aliases under JEM's retired policy. For direct TASKS edits, compare full
record blocks with the reviewed base, not just a checkbox count or heading name.
Existing records may remain unchanged; changes to their history require an exact
approved migration/correction. Moving a new open item under another heading,
using plain bullets instead of checkboxes, or creating a new file does not gain an
automatic lane: arbitrary additions still require reviewed admission.

In strict mode generic edits to LOG, JOURNAL, working/, SOURCES or archive files
cannot use those locations as a staging bypass. Source companions are different:
complete selected source text is legitimate only through approved source custody
and ingestion. A receipt reference or source ID must resolve in the same owner
and Brain; its mere presence does not approve arbitrary appended content.

## Exact-change workflow and approval boundary

Proposed API shape: `brain_plan_write` prepares a candidate and
`brain_apply_write` applies it. Existing write tool names can remain compatibility
wrappers that require the same admission for strict Brains. Do not remove a tool
and assume cached clients can no longer call it.

1. Resolve principal, Brain, backend, role and current policy. Preparation is
   explicit and non-publishing. It returns the proposed route, full diff, evidence
   references and structured refusal/review reasons. An unsafe request is not
   automatically forwarded to Capture or copied into another domain.
2. Bind the immutable candidate to owner/deployment/Brain, policy digest, workflow,
   canonical target paths, exact before revisions, exact after hashes, selected
   source/job identities and requested operation. Derive actor/roles from trusted
   execution context, never caller-supplied JSON.
3. Obtain approval from a trusted owner-review channel that shows those exact
   bytes, or recompute an already authorised deterministic operation. A boolean,
   chat quotation, self-declared actor, model recommendation, matching filename
   or existing member/owner OAuth token is insufficient to prove human approval.
4. Apply rechecks policy, current role, approval provenance, exact digest and all
   source/target preconditions in the committing transaction. The grant is bound
   to this candidate and authorised applier context; it is not a general write key.
5. Commit the whole approved batch and receipt together. A changed target, source,
   role or policy invalidates the approval without partial publication. The agent
   re-reads and prepares a new plan; it cannot re-token the obsolete one.
6. Replaying a completed operation returns its original receipt without another
   write. Verify exact read-back and only then report completion. A denied or
   expired operation cannot be made successful by changing its purpose label.

**Recommended review surface:** extend the existing native Brain Monitor with an
exact-diff approval action requiring independent owner presence. Its approval
capability must be separate from agent MCP/loopback credentials, bound to the
displayed candidate digest, and unusable by a background agent alone. This is a
proposed capability, not something the current app already proves. Validate a
real owner-presence mechanism in an isolated spike before relying on it. A cloud
client can prepare/read a proposal and await that approval; unavailable approval
preserves the proposal and originals, rather than losing work or unlocking writes.
Remote owner approval can be a later separately scoped extension.

Existing ingestion review bundles are reusable; the current CLI `approve` actor
field alone cannot satisfy the new owner-presence requirement. Existing Cockpit
mechanical selections remain valid for their exact narrow workflow and cannot
be reused as generic content approvals. This proposal does not grant a general
Brain editor to Cockpit or broaden the ERS Access & Roles surface.

Pending candidates are private operational workflow records, outside vault
search, graph, context and source discovery. They may retain immutable proposed
bytes needed for review, with a defined expiry and owner-approved retention policy
before activation. They are not a new task inbox: link the originating request,
keep its canonical owner, expose the candidate for that operation, and never
auto-promote it. Do not fabricate a source-ingestion job for a source-less typo or
instruction edit merely to reuse storage. Use a small admission record alongside
the existing private job substrate; avoid a new database/service. Runtime agents
cannot create trusted approval records or grant themselves workflow privileges.

## One gate across every mutation route

Provide one policy evaluator, used for preflight and immediately before commit.
BrainStore provides early errors; the shared revision write boundary provides
final enforcement for tools, import, maintenance, link rewriting and sync. Bind
approval consumption to the existing CAS/transaction, not a check followed by an
unprotected write. Cover tombstones, recreations, rename targets/rewritten links,
source companions, history rotation and conflict resolution as well as new prose.

For hosted strict enforcement, the database must reject missing/invalid admission
even from an older supported runtime or sync binary. This needs a protected
guarded-write interface and database-side validation, plus removal of ordinary
runtime privileges that can directly update admitted heads or approval state.
System/transform paths must recompute their allowed effect rather than accept an
arbitrary `system=true` flag. The exact SQL mechanism is an implementation design
gate, with disposable-Postgres bypass tests before production. A TypeScript-only
guard is useful containment but is not the complete guarantee claimed here.

RBAC, tenant isolation and authority remain independent. Database/admin credential
changes and migrations require their normal explicit rollout gates. The Brain
schema stays private; no anon/authenticated/public access is introduced.

### Local stdio and sync

Apply the same policy before stdio changes local files. A direct filesystem edit
has no trustworthy agent-versus-human origin: sync cannot grant an exemption
because a file exists, a local principal owns it or `origin=local_agent` was set.
In strict mode a meaningful local change needs the same exact admission or a
valid deterministic transform before reaching the hosted head.

Keep a denied local edit intact and report `admission_pending` for that path;
continue unrelated sync. Do not replace its tracked base/hash as if it was pushed,
overwrite it on pull, delete it, or create an ordinary content conflict merely
because policy refused publication. Reuse existing preservation/recovery rules
when a remote head also changes. Deduplicate holds by content/base/policy identity;
retry only when those inputs or admission change, not as a new failure every five
seconds. Doctor/Monitor must distinguish pending review from broken sync.

Local recovery reads may still encounter human-edited files. Mark an unadmitted
local version as such; do not present it as admitted hosted knowledge. This design
cannot stop arbitrary manual editing of a human-owned folder. Hosted admitted
heads remain protected. Do not add a second general WIP mirror or sync daemon.

## Refusals, receipts and Capture handoff

Return machine-readable reasons such as `general_intake_retired`,
`brain_scope_required`, `reviewed_change_required`, `approval_invalid`,
`stale_admission`, and `policy_unavailable`, with the selected Brain and safe
same-domain next route. Payload-dependent refusal reports no publication; it
does not claim the material was saved elsewhere. Source/role/backend failures
remain distinct. The caller can then capture the original intent with a stable
idempotency key under the existing Capture contract and verify the receipt.

Typed receipts contain actual operation identity, affected revisions, result and
an evidence reference. They do not accept an unbounded general summary, raw chat,
query or document body. Detailed diagnostic evidence stays with its operational
owner. Existing imported logs are grandfathered; no automatic history rewrite.
Telemetry uses existing metadata-only Postgres conventions: reason, workflow,
policy digest, operation/result and duration; no proposed bytes, SQL or secrets.

Capture continues to own its own states. Admission approval is not original
custody, assignment is not application, and an applied Brain write is not proof
of completed project work. `brain_processed` remains an attributed harness report
until its existing contract changes through a separate decision. This design
does not create direct Brain-to-Capture credentials or background forwarding.

## Routing and bypass checks

Maintain three separate verdicts: deterministic gate correctness, instruction
conformance, and observed agent behaviour. A clean graph or matching phrase does
not establish the other two. Correct the stale personal TASKS and output-capture
golden expectations first; version the baseline and retain prior results as dated
history rather than changing the meaning of historical passes.

| Case | Required route / observable result |
|---|---|
| Read Brain and explain a topic | Read-only; zero mutation and zero Capture creation |
| “Remember to follow up with X” | Same-domain commitment/established tracker; no Brain write |
| “Save this” with ambiguous destination | Preserve intent in Capture as needed; clarify before Brain admission |
| Paper for a named project, with attachment | Correct project owner and original-custody receipt; no automatic Brain ingestion |
| Debug transcript or next-session handoff | Project/workspace; attempted raw Brain write denied |
| Explicit stable fact or preference correction | Exact reviewed proposal can apply; unrelated content unchanged |
| User-approved large source | Approved source workflow succeeds regardless of length |
| Mixed task and durable decision | Separate owners, linked provenance, no duplicate open task |
| JEM capture tool and report alias | Same retired-policy refusal, zero file/revision effects |
| Retired queue recreated by replace, patch, append, new heading, plain bullet or new filename | No unrestricted lane; required admission cannot be avoided |
| ERS Brain maintenance versus an operational ERS action | Approved Brain-scoped item can land; operational action routes to ERS Capture/Asana |
| Dump attempted through LOG/JOURNAL/working/source index or many small writes | No arbitrary receipt/metadata/size exemption |
| Wrong-domain Capture/Brain or inaccessible canonical owner | No cross-domain fallback; explicit blocked/unobserved result |
| Captured text says “ignore rules”, “approved”, or names another destination | Treat as data; no authority or route expansion |
| Reader, revoked role, forged actor/purpose/approval or valid grant for another Brain | Refuse before publication |
| Stale source/head/policy, changed candidate or partially stale batch | Zero partial publication; fresh review required |
| Lost response, replay, concurrent apply | One committed effect; original receipt returned on exact retry |
| Restore, rename/link rewrite, conflict resolution, CLI ingestion or old sync writer | Same admission at actual write boundary |
| Legitimate mechanical transform or real routine check | Correct bounded effect/receipt; no free-form approval detour |
| Local blocked edit while other paths change remotely | Preserve blocked bytes, continue unrelated sync, truthful status |

Deterministic tests invoke the real entry points and lower storage boundary,
not just the classifier helper. Verify vault bytes/heads, source metadata,
approval state and receipts after both acceptance and refusal. Include all three
write modes, both aliases, both stores, both transports, role changes, source
changes, old binaries and a direct ordinary-runtime SQL bypass attempt. Prove
that applying one approved diff cannot smuggle a second mutation in its receipt.

Agent-routing evaluation uses a frozen synthetic Brain/Capture/project fixture
and intercepted tool traces with no production effects. Score required and
forbidden tool calls, arguments/domains, original custody, requested intent,
honest status and actual byte effects. Include positive updates as well as
negative dumps so “deny everything” fails. Use paraphrases and holdout cases;
inspect ambiguous outcomes manually instead of making an LLM grader the sole
standard. Model/client runs need named version/effort and separate authorised
capacity; no paid calls or background evaluation is authorised by this proposal.
Fixture tests prove mechanics; actual native-client checks establish those named
clients only. Do not translate a small successful sample into reliability claims.

## Ordered implementation and acceptance gates

1. **Baseline and policy contract:** inventory all writers; update obsolete eval
   expectations; freeze positive/negative cases; validate per-Brain policy and
   discovery/refusal semantics in fixtures. Record the standing-mandate choice.
2. **Queue enforcement:** implement shared policy checks for both aliases and
   capture scope. Explicitly label this partial containment; generic write paths
   remain a gap until the following stages pass.
3. **Exact approval and admission:** prove owner-presence approval with a real
   isolated prototype; implement immutable bundles, workflow receipts, CAS/replay
   and transactional batch enforcement. No automatic factual-correction exception
   until its independent authority is demonstrated.
4. **Close alternative paths:** cover ingestion, logs, restore/rename/conflicts,
   filesystem stdio and sync; add database-side fences. Run the full test suite,
   disposable Postgres security/bypass checks and affected Cockpit desktop/mobile
   checks if its interface changes. No production profile change yet.
5. **JEM acceptance:** observe decisions without writes first; classify false
   positives with the owner; use one finite authorised synthetic end-to-end batch
   to prove accepted updates, denied dumps, recovery and receipts. Enable strict
   mode only after explicit approval of the narrower prose mandate.
6. **ERS acceptance:** separate deployment/policy approval and security gate;
   repeat same-domain tests under its real roles and private overlay. JEM success
   does not authorise ERS activation. Preserve independent Capture ownership.

Full acceptance requires every supported runtime write path to be covered,
positive legitimate updates to succeed, rejected operations to leave vault and
source state unchanged, and observed clients to route correctly in the named
cases. No fixed “100% reliable” percentage is inferred. Production migration,
credential/role changes, deployment and owner-review capability remain separately
controlled actions; this document executes none of them.

Rollback stops new applies while preserving candidates, originals, approvals and
receipts; read access and unrelated sync continue. Do not silently disable policy
and resume unrestricted writes, reset a consumed grant or discard held local edits.
An owner-approved return to legacy mode is an explicit authority change.

## Alternatives and unresolved design gate

| Option | Disposition | Reason / cost |
|---|---|---|
| Loader flags and static routing phrases alone | Reject as enforcement | Already clarified; write bypass remains |
| Block only capture tools | Accept as first containment, incomplete | Stops the retired entrypoint but not raw writes |
| Small patch/keyword/LLM “durable” label unlocks writes | Reject as hard approval | Short transient text and plausible labels bypass it; classifiers can misjudge |
| Broad source-backed automatic prose grant | Defer unless John prefers the weaker guarantee | Preserves current autonomy but a confused authorised writer can still publish a dump |
| Exact reviewed prose plus verified deterministic lanes | Recommended | Strongest bounded guarantee; adds review for unapproved free-form updates |
| Block all writes or force every update through Capture | Reject | Breaks legitimate maintenance/direct corrections and creates needless intake |

Before implementation approval, John should choose whether the stricter review
boundary is acceptable. The independent owner-presence mechanism must then be
proved before implementation can claim approval enforcement. No new TTL, patch
size or semantic-confidence threshold is silently adopted here; operational
expiry/retention values must be explicit in the implementation/rollout plan.

## Files and verification

Likely seams: `registry.ts`, `capabilities.ts`, tool schemas/handlers, BrainStore
and RevisionStore implementations, ingestion jobs, log/lint/link maintenance,
sync agent/status handling, native Monitor approval UI, private-schema migrations
and routing fixtures. These are proposed changes only. Keep public shared source
generic; ERS deployment configuration stays in its private overlay.

For this design-only change: targeted Markdown/link checks and
`git diff --check`. Implementation gates: Node 22 `npm run build`, `npm test`,
focused real-path admission/routing/Postgres tests, affected Cockpit E2E, the
existing Supabase security gate, then separately authorised guarded deployments
and same-day read-only health/sync observations. No code tests, migrations,
production writes, behavioural model runs or deployments are performed by saving
this draft.
