# Hosted Brain Roadmap

**Status:** active reference
**Last updated:** 2026-08-22

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
- the hosted runtime remains single-user: John is still the only user, with `ai-brain-jem` as the normal remote JEM Brain and `ers-brain` added as a John-only ERS Brain pilot;
- specs 015–016 are implemented and validated on JEM: release `v1.5.0`
  (`379b965`) is deployed only to the personal `jem-brain-mcp` app; the
  personal schema now has
  additive portable source/artifact identity and reviewed source-to-Brain links;
  the local read-only Brain Library pilot renders canonical Markdown and exact
  source trace data separately from Cockpit; and the source-link audit has made
  direct evidence coverage, missing backlinks, broken links, and non-clickable
  references measurable. The live hosted MCP returned the JEM canary's exact
  provider id/revision, HTTPS locator, registered local-root alias, relative
  path, content hash, provenance, and reviewed Brain link without returning
  source bytes. ERS schema, content, credentials, and deployment remain
  unchanged and separately gated;
- multi-profile Monitor sync now requires an explicit revision store and binds
  each Postgres URL to an expected Supabase project ref, with ambient repo env
  loading disabled for managed profiles. This closes a discovered path by which
  a JEM-named local watcher could silently target the ERS database;
- spec 013 server Phases 1–3 and both Brain-content migrations are deployed; the
  corrective graph/sync baseline landed in `v1.4.5`, and the personal JEM
  runtime is now current at `v1.5.0`: ranked structured search/evals, the
  private Postgres FTS index, graph lint, bootstrap-budget/read-only lint,
  fail-closed structural-file roles, reserved external-namespace guards,
  idempotent conflict recording, and a parity-gated local state-rebase
  procedure. Both Brains use graph reachability as the primary beta path while
  legacy deltas remain the inverse comparator through 2026-07-24. JEM currently
  has 39 hosted files; ERS currently has 51 hosted files, and its migration
  baseline recorded 50/50 graph-reachable files with three deliberate history
  exemptions. Both consolidated local Monitor profiles are healthy and
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

## Milestone 4: ERS Multi-User Access

Goal: allow controlled ERS user access to shared Brains.

Planned work:

- model ERS principals and roles;
- add audit logging for hosted writes, conflict resolutions, source access, and admin actions;
- formalize onboarding/offboarding;
- define source artifact download/signed-URL policy;
- define role-based access for source metadata, extracted text, and original bytes;
- verify RLS policies and private schema boundaries for shared usage.

Exit criteria:

- multiple ERS users can access only the Brains and operations they are authorized for;
- write and resolution actions are attributable;
- original artifact byte access has an explicit policy and audit trail.

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

1. Complete the graph-primary inverse-comparison window through 2026-07-24. Revert either Brain to `graph_shadow` on a new adjudicated graph false positive, routing/policy regression, mode-related operational failure or unresolved conflict; if clean, retire routine legacy comparison and retain `legacy` only as rollback.
2. Harden Brain Cockpit into a user-launchable operator surface without Codex/terminal CLI. First slice: local LaunchAgent + stable loopback URL; hosted persistent admin website deferred until multi-user auth and local-first sync visibility are redesigned.
3. Define the proactive nudge path for lint, sync health, open conflicts, stale daemon health, and source-ingestion issues.
4. Rehearse hosted recovery/reseed from local Markdown and a restored Supabase project; decide whether PITR is worth enabling for the pilot before removing Git as emergency history.
5. Run at least one daily doctor pass after promotion and keep local stdio `brain` as fallback.
6. After the JEM/ERS content contract stabilises, complete the remaining downstream review: revise the public primer and review the ERS onboarding prototype without applying server-only controls to non-Brain surfaces. Edge pointer/source-of-truth reconciliation completed on 2026-07-17.

## Non-Goals For Now

- Do not abandon local Markdown as the working surface.
- Do not make Supabase Storage the authority for curated Markdown revisions.
- Do not expose Brain tables through Supabase browser/client roles.
- Do not move ERS production data into John's private Supabase org as a final state.
- Do not build full multi-tenant product machinery before the single-user and multi-Brain contracts are proven.
