# Hosted Brain Roadmap

**Status:** active reference
**Last updated:** 2026-06-16

This roadmap records the intended path from the current JEM hosted Brain pilot to ERS-owned, multi-brain, multi-tenant Brain infrastructure.

The core product direction is local-first hosted Brain:

- local Markdown remains a first-class, inspectable, portable working surface;
- hosted MCP provides remote access, OAuth identity, revision history, source metadata, and automation;
- Supabase Postgres stores Markdown revisions, sync cursors, conflicts, metadata, extracted source text, and future semantic chunks;
- Supabase Storage stores original binary/source artifacts in private immutable paths;
- git remains backup/export/history, not the live hosted sync hot path.
- maintenance is automation-first: routine linting, sync health, hosted health, and conflict detection should be checked by tools and surfaced proactively, leaving users to make judgement calls rather than babysit infrastructure.

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
- `hosted:cockpit` provides a local read-only operator dashboard over the hosted doctor checks;
- `hosted:test-drive` provides a single readable operator rehearsal for hosted health, MCP read/write parity, conflict lifecycle, and latency;
- cached hosted OAuth smoke avoids repeated GitHub approval during routine checks;
- local Brain MCP remains the trusted default while hosted becomes operationally boring.

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

Move hosted MCP from pilot/shadow path to normal remote path for JEM Brain only after the following are true:

- daily hosted doctor/status checks pass without manual fiddling;
- local sync daemon exposes a clear last-success signal and does not wedge on stale locks;
- open conflicts are visible, understandable, and resolvable without database spelunking;
- sync, lint, and hosted-health issues are proactively flagged with the next required action;
- there is a short recovery playbook for reseeding hosted from local Markdown;
- source artifact metadata and private retention behavior are verified;
- OAuth client setup works smoothly enough for Claude and Codex;
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

## Near-Term Next Steps

Recommended order:

1. Run the JEM Brain real-world hosted-client rehearsal using `npm run hosted:test-drive` as the readiness gate.
2. Decide when Claude/Codex should use hosted MCP as the normal remote JEM path.
3. Harden Brain Cockpit into a user-launchable operator surface without Codex/terminal CLI.
4. Define the proactive nudge path for lint, sync health, open conflicts, stale daemon health, and source-ingestion issues.
5. Document and rehearse hosted recovery/reseed from local Markdown.
6. Start the multi-Brain design after the JEM pilot path is boring.

## Non-Goals For Now

- Do not abandon local Markdown as the working surface.
- Do not make Supabase Storage the authority for curated Markdown revisions.
- Do not expose Brain tables through Supabase browser/client roles.
- Do not move ERS production data into John's private Supabase org as a final state.
- Do not build full multi-tenant product machinery before the single-user and multi-Brain contracts are proven.
