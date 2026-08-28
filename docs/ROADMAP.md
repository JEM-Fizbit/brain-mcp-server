# Hosted Brain Roadmap

**Status:** active reference
**Last updated:** 2026-08-25

> **Active handoff:** before starting the next hosted Brain hardening slice, read [`docs/savepoints/2026-06-25-hosted-brain-hardening-baseline.md`](savepoints/2026-06-25-hosted-brain-hardening-baseline.md). It captures the clean baseline, two-Brain hosted status, recent cross-repo housekeeping, and recommended next work.

This roadmap records the intended path from the current JEM hosted Brain pilot to ERS-owned, multi-brain, multi-tenant Brain infrastructure.

> **Ownership & lifecycle:** see [`OWNERSHIP_AND_LIFECYCLE.md`](OWNERSHIP_AND_LIFECYCLE.md) — who owns what (JEM Brain + connector = personal; hosted MCP = personal-owned, ERS beta-shared) and the Phase 0 (personal beta) → Phase 1 (fork a dedicated ERS MCP) plan that this roadmap's cutover work realizes.

The core product direction is local-first hosted Brain:

- local Markdown remains a first-class, inspectable, portable working surface;
- hosted MCP provides remote access, OAuth identity, revision history, source metadata, and automation;
- Supabase Postgres stores Markdown revisions, sync cursors, conflicts, metadata, extracted source text, and future semantic chunks;
- Supabase Storage stores original binary/source artifacts in private immutable paths;
- git remains emergency backup/export/history only, not the live hosted sync hot path; routine Brain operations do not require manual Git commit/push/merge.
- maintenance is automation-first: routine linting, sync health, hosted health, inbox/source-ingestion state, and conflict detection should be checked by tools and surfaced proactively, leaving users to make judgement calls rather than babysit infrastructure.

## Current Position

The hosted Brain rebuild has passed the first critical sync gates:

- hosted runtime uses Supabase Postgres for revisions;
- original/source artifacts are retained through private Supabase Storage metadata and objects;
- Fly runtime no longer uses the retired git hot path;
- hosted-to-local and local-to-hosted sync are verified;
- dirty local Markdown blocks hosted overwrite and creates visible conflicts;
- stale local edits block hosted overwrite and create visible conflicts;
- conflicts can be explicitly resolved through `brain_resolve_conflict`;
- live OAuth smoke verifies hosted conflict listing, resolution, and final hosted content;
- `hosted:cockpit` provides a local read-only operator dashboard over the hosted doctor checks, with a reviewable macOS LaunchAgent generator for a stable user-launchable local surface;
- `hosted:test-drive` provides a single readable operator rehearsal for hosted health, MCP read/write parity, conflict lifecycle, and latency;
- cached hosted OAuth smoke avoids repeated GitHub approval during routine checks;
- `docs/hosted-client-cutover.md` defines the real-client connector rehearsal, promotion gate, and account-specific verification status;
- the real hosted client shadow rehearsal passed for `ai-brain-jem`, so hosted MCP is now the normal remote JEM path;
- OpenAI cutover is verified for Codex plus ERS and personal ChatGPT accounts;
- Claude personal Max and Claude ERS account have both been activated and verified against hosted Brain for John's personal use;
- the owner-isolated runtimes are live: JEM remains John's personal Brain;
  ERS has a completed John+Cillian GitHub pilot on its dedicated stack, while
  wider production access is governed by spec 018 and remains inactive;
- specs 015–016 are implemented and validated on JEM: release `v1.5.0`
  (`379b965`) established the source/Library pilot, the `v1.6.0` acceptance
  remediation (`e1e29b8`) closed the content/source gaps, and the `v1.6.1`
  operator-diagnostic remediation (`2ed0393`) and the `v1.6.2` capture-queue
  completion guidance, followed by the `v1.6.4` point-of-use Copy control and
  restored hosted session-start maintenance nudges, were first deployed to the
  personal `jem-brain-mcp` app on 2026-08-24; the
  personal schema now has
  additive portable source/artifact identity and reviewed source-to-Brain links;
  the local read-only Brain Library pilot renders canonical Markdown and exact
  source trace data separately from Cockpit; and the source-link audit has made
  direct evidence coverage, missing backlinks, broken links, and non-clickable
  references measurable. The approved JEM content pass has since reviewed the
  full current corpus: all 45 source companions are directly linked with
  reciprocal backlinks, and the strict audit reports zero index-only,
  unlinked, broken, or non-clickable findings. Five prominent primary-source
  declarations now link directly to their companions and all 26 companions
  with a same-stem ingested binary link directly to that original. The personal source registry now
  records 45 companion paths and 46 reviewed source-to-Brain relationships;
  repeat persistence is idempotent and all 41 stored companion artifacts retain
  content-addressed hash identity. The live hosted MCP returned the JEM canary's exact
  provider id/revision, HTTPS locator, registered local-root alias, relative
  path, content hash, provenance, and reviewed Brain link without returning
  source bytes. Exact reviewed Markdown reads now return complete stored text
  independently of private original-binary access. A separate semantic-destination pass now requires every JEM
  entity hub to declare a current official, historical-evidence, or explicit
  unavailable destination state; all five hubs satisfy the contract, active
  Brain content has no bare URLs, and exact Quanta/Nitec destination regressions
  are in the routing golden set. The combined source-link and destination
  sequence is preserved in `docs/brain-content-linking-runbook.md`. The approved
  ERS replay is also complete on its dedicated development stack: all 39
  evidence companions are directly linked with reciprocal declarations, 43
  reviewed source-to-Brain relationships are persisted, all 17 adjacent
  same-stem originals are linked, active content has zero bare URLs, and the
  three current entity hubs satisfy the destination contract. The complete
  39-file JEM corpus also has a
  freshness classification; nine cadence-controlled areas record review date,
  owner, cadence and trigger, and lint enforces declared cadence over mtime.
  Cockpit Maintenance now excludes graph/source locator telemetry from the
  maintenance count, automatically verifies the source boundary, leaves zero
  genuine broken internal links, and now shows no bounded capture-queue
  decision after the successful 13-item triage; 262 classified references
  remain available in a collapsed maintainer-only panel. Each safe mechanical
  proposal remains inspectable in full.
  Spec 014 remains deferred because no representative post-content
  follow-up-read gap or weaker-harness gap has been measured. Shared releases
  `v1.7.0`–`v1.7.3` added hosted ingestion preflight, tenant-specific source
  categories, explicit project-bound source maintenance, complete reviewed-text
  recovery and corrected graph/source classification. JEM and ERS retain
  isolated credentials, databases, deployments and content authority;
- multi-profile Monitor sync now requires an explicit revision store and binds
  each Postgres URL to an expected Supabase project ref, with ambient repo env
  loading disabled for managed profiles. This closes a discovered path by which
  a JEM-named local watcher could silently target the ERS database;
- spec 013 server Phases 1–3 and both Brain-content migrations are deployed; the
  corrective graph/sync baseline landed in `v1.4.5`, and both dedicated
  development runtimes are current at `v1.7.3`: ranked structured search/evals, the
  private Postgres FTS index, graph lint, bootstrap-budget/read-only lint,
  fail-closed structural-file roles, reserved external-namespace guards,
  idempotent conflict recording, and a parity-gated local state-rebase
  procedure. Both Brains use graph reachability as the primary beta path. JEM
  currently has 39 hosted files; ERS has 52 hosted files after adding its
  freshness register. Both consolidated local Monitor profiles are healthy and
  conflict-free. The task-context compiler remains unbuilt and spec 014 stays
  trigger-gated;
- normal Brain operations no longer depend on GitHub repo backup, manual commit/push/merge, or Git conflict handling;
- the recovery/export runbook records the current backup baseline: Supabase physical backups visible, PITR not enabled, Storage objects outside database backups, and restore/export rehearsal still required before deleting Git as emergency history;
- local Brain MCP remains the trusted fallback while hosted becomes operationally boring.

## Cutover Principle

Do not treat cutover as replacing the local Markdown Brain.

Cutover means a client such as Claude or Codex can safely use hosted Brain MCP for JEM Brain when remote access is needed, while local Markdown remains the durable source-of-truth surface and fallback.

Local-first remains the contract:

```text
Local Markdown Brain
        |
        | local sync agent
        v
Supabase Postgres revision store
Supabase Storage artifact archive
        |
        v
Hosted MCP / OAuth / clients
        |
        v
Codex, Claude, future ERS tools
```

If hosted breaks, local Brain still works and can reseed hosted state.

## JEM Brain Cutover Criteria

Hosted MCP has moved from pilot/shadow path to normal remote path for JEM Brain. Keep the promotion valid only while the following stay true:

- daily hosted doctor/status checks pass without manual fiddling;
- local sync daemon exposes a clear last-success signal and does not wedge on stale locks;
- open conflicts are visible, understandable, and resolvable without database spelunking;
- sync, lint, and hosted-health issues are proactively flagged with the next required action;
- there is a short recovery playbook for reseeding hosted from local Markdown and separating Supabase backup/restore from async Git export;
- source artifact metadata and private retention behavior are verified;
- OAuth client setup works smoothly enough for Codex, ChatGPT, and Claude;
- local Brain MCP remains available as fallback.

## Milestone 1: JEM Hosted Brain Pilot Ready

Goal: make the single-user hosted path operationally boring.

Planned work:

- add `hosted:doctor` or equivalent operator command for health, sync summary, open conflicts, and daemon status;
- add a local read-only cockpit/dashboard over the doctor output so the operator can see hosted readiness without reading raw JSON;
- harden local sync daemon observability, including last successful sync time and clearer launchd logs;
- write a conflict resolution operator guide that distinguishes automated checks from human judgement points;
- define the proactive nudge path for lint, sync health, open conflicts, and source-ingestion issues;
- run a real-world rehearsal on `ai-brain-jem`, including conflict inspection/resolution and local mirror catch-up;
- verify source artifact privacy and metadata access from the hosted runtime;
- keep local stdio Brain MCP as the default fallback.

Exit criteria:

- hosted doctor passes repeatedly;
- no unresolved smoke/test conflicts remain in the real Brain;
- hosted MCP can be used by a real client without manual database intervention;
- users are alerted when action is required rather than expected to poll raw logs;
- recovery path is documented and rehearsed.

## Milestone 2: Multi-Brain For One Owner

Goal: support more than one Brain cleanly before adding organizational tenancy.

This is not full multi-tenant ERS production. It proves Brain routing, registry behavior, roles, and selection with one owner/operator.

Candidate Brains:

- `ai-brain-jem`;
- ERS strategy Brain;
- ERS operations Brain;
- project-specific Brains.

Planned work:

- expand registry and tool behavior around multiple accessible Brains;
- make `brain_id` selection ergonomic in hosted clients;
- verify per-Brain sync cursors, conflicts, source manifests, and artifact paths;
- add tests for ambiguous Brain access and role boundaries;
- decide which Brain metadata belongs in registry JSON versus Postgres.

Current pilot status (2026-06-24):

- `ers-brain` is registered in the John-only hosted registry;
- ERS Markdown seed passed with 40 files, byte-for-byte mirror verification, and 0 conflicts;
- ERS sources are inventoried/uploaded into the private artifact store: 128 artifacts, 57 extracted text records, 0 missing/failed extraction;
- local sync/cockpit LaunchAgent generators now pin `BRAIN_ID` so an ERS daemon cannot silently default to `ai-brain-jem`;
- local ERS connector remains available as fallback until hosted ERS client smoke passes and the ERS sync agent is running.

Exit criteria:

- one user can safely operate multiple Brains through hosted MCP;
- tools never silently write to the wrong Brain;
- sync state and artifacts remain Brain-scoped.

## Milestone 3: ERS-Owned Supabase Migration

Goal: move from John's private prototype Supabase org to ERS-owned infrastructure before ERS production use.

Planned work:

- create an ERS-owned Supabase project with the same schema, migrations, roles, private Storage buckets, and runtime secret layout;
- rehearse migration from pilot Supabase project to ERS project;
- document backup/restore, migration, and rollback steps;
- update Fly/runtime secrets to point at the ERS-owned project;
- confirm billing, ownership, admin access, and offboarding are controlled by ERS.

Exit criteria:

- ERS owns the production Supabase account/project;
- pilot-to-production migration is documented and tested;
- no account-specific assumptions are hard-coded in code or docs;
- private-org pilot can be retired or kept only as a non-production sandbox.

**Status (2026-08-24): complete for the dedicated development baseline.** ERS
owns the Fly app, Supabase project, private release mirror, custom hostname,
runtime credentials and Brain data. Personal and ERS deployments now expose
only their own Brain. Production team access remains Milestone 4, not evidence
that Milestone 3 is incomplete.

## Milestone 4: ERS Multi-User Access

Goal: allow controlled ERS user access to shared Brains.

**Plan of record:**
[`spec 018 — ERS Production Identity And Controlled Team Rollout`](specs/018-ers-production-identity-and-rollout.md).
The GitHub-authenticated John+Cillian pilot is complete. The tenant-neutral
Entra provider, private grant/audit projection, exhaustive tool-role policy and
ERS-only hosted Access & Roles surface are implemented and verified in upstream
release `v1.8.0`. Its first JEM canary passed the functional GitHub/OAuth/tool
matrix but exposed an ambient operator-credential routing defect outside the
server runtime. Corrective release `v1.8.1` binds doctor/smoke database access
to an exact Brain/endpoint/Supabase profile. It is deployed to JEM and passed
the profile-bound OAuth/read/write/sync re-canary with zero JEM events or
heartbeats in the ERS database. Release `v1.8.2` makes a legacy heartbeat
fallback an actionable migration warning; the missing JEM schema passed its
security gate, both Brains now use fresh current-state heartbeats, and 532,952
obsolete heartbeat events were removed without changing non-heartbeat
telemetry. The private ERS overlay passed intake; TDM completed the Entra app,
fixed-role groups, consent and certificate upload; and the ERS access-ledger
migration plus live Supabase security gate passed on 2026-08-28. John, Cillian
and Rick are now the three exact Entra-backed Owners in the private ERS grant
ledger. Fly secret loading, the dual-provider canary and wider access are not
yet activated.

Planned work:

- add single-tenant Entra OIDC behind the existing MCP authorization server and
  move ERS from bounded GitHub/Entra canary to Entra-only workforce login;
- bind authorization to exact Entra tenant/object IDs, dedicated Entra
  app-role groups and a current private Postgres grant ledger; default new
  colleagues selected by an owner to `reader`;
- extend the shared Brain Cockpit shell with a profile-scoped ERS **Access &
  Roles** section so John, Cillian and IT/TDM can manage fixed role groups and
  immediate Brain grants without a deployment or a TDM ticket for each ordinary
  change; keep JEM GitHub-authenticated and without multi-user role controls;
- enforce an exhaustive reader/member/admin/owner tool matrix and revalidate
  roles on tool calls and refreshes;
- align SharePoint Brain-folder write permissions with the named curator set;
- formalize onboarding, role change, offboarding and second-admin recovery;
- complete real-client, wrong-tenant, unregistered-user and cross-Brain denial
  tests, plus external health/alerting and the standing ELT rollout gate;
- retain original-byte access as `metadata_only`; a signed-URL policy is not a
  prerequisite while bytes remain unexposed.

Exit criteria:

- multiple ERS users can access only the Brains and operations they are authorized for;
- every hosted write and resolution action is attributable to an exact Entra
  principal;
- broad SharePoint access cannot bypass hosted writer restrictions;
- the intended Claude, ChatGPT and Codex surfaces pass under Entra;
- GitHub is disabled for ERS production enrollment;
- original artifact bytes remain unexposed unless a later policy and audit
  trail are approved.

## Milestone 5: True Multi-Tenant Product Shape

Goal: evolve from ERS internal/shared usage toward a productizable platform.

This comes after the local-first/sync/auth model has survived real use.

Planned work:

- organization/tenant model;
- tenant-scoped Storage and database access patterns;
- admin UI or operator surface;
- quotas, billing boundaries, backup policies, and lifecycle controls;
- tenant onboarding/offboarding workflows;
- formal support and incident runbooks.

Exit criteria:

- multiple organizations can be isolated by design, not convention;
- operational responsibilities are clear;
- hosted Brain can be provisioned, monitored, recovered, and retired repeatably.

## Longer-Term Hosting Direction (recorded 2026-07-13)

ERS's ultimate ambition (John, ELT memo `ERSG_Memo_ERS_Brain_Ownership.docx` §4, 2026-07)
is to host the ERS deployment on ERS-owned **on-premises hardware** (Mac mini/Studio-class)
once — and if — that infrastructure exists and a migration is proven not to compromise
performance or reliability. Launch posture stays Fly.io + Supabase. The ERS custom-domain
decision (spec 012 §9 #5) makes a later hosting move invisible to users (no connector
re-enrollment), and the same portability holds in principle for the personal stack —
echoing the self-hosting/Mac-mini room noted in DECISIONS 2026-06-14. Revisit when the
hardware exists; requires a self-host substrate story for Postgres + object storage.

## Near-Term Next Steps

Recommended order:

1. Release `v1.8.5` is live on JEM Fly release 79 and the reviewed ERS overlay
   at Fly release 19. The live ERS access surface now labels the bounded GitHub
   fallback grants by human name and login. Complete Cillian's Owner sign-in
   plus Jeronimo's Reader sign-in/read acceptance in dual-provider mode; do not
   activate Entra-only before both pass.
2. Align SharePoint writer permissions, activate an ERS-owned external
   health/alert path and close the item-14 governance gate.
3. Move ERS to Entra-only and stage a bounded reader cohort before granting any
   additional curator role.
4. Keep the restore rehearsal, automated ingestion, protocol migration and
   deeper attribution work as separately sequenced follow-ons. Do not remove an
   existing redundancy layer merely because the restore rehearsal is
   non-blocking for Spec 018.

## Non-Goals For Now

- Do not abandon local Markdown as the working surface.
- Do not make Supabase Storage the authority for curated Markdown revisions.
- Do not expose Brain tables through Supabase browser/client roles.
- Do not move ERS production data into John's private Supabase org as a final state.
- Do not build full multi-tenant product machinery before the single-user and multi-Brain contracts are proven.
