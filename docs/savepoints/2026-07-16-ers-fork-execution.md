# 2026-07-16 ERS Fork Execution Savepoint

**Status:** paused checkpoint — Phase 0/1 complete; Phase 2 Step 1 complete; Step 2 not approved
**Repo:** `/Users/johnemilad/Projects/brain-mcp-server` (public; branch `main`; released code baseline `v1.2.0` at `cd3ac8d`)
**Plan of record:** [`docs/specs/012-ers-mcp-fork.md`](../specs/012-ers-mcp-fork.md) — read it in full before acting; this savepoint is the state snapshot, the spec is the plan
**Governance record:** `governance/brain-mcp-fork-signoff.md` in the ERS Brain (hosted `brain_id: ers-brain`; SharePoint mirror `…/01_ers-brain/brain/governance/`)
**Evidence base:** `~/Projects/claude-ops/plans/brain-platform/2026-07-12-ers-fork-dependency-audit.md` (13-surface audit, file:line refs — local-only, do NOT copy into this public repo)

Read this first if you are a fresh session executing the ERS Brain MCP fork (spec 012).

## TL;DR

Planning remains complete and all 16 decisions are resolved (spec §9 table + register). Phase 0 and Phase 1 are complete: the upstream hardening landed in five logical commits, the full test gate passed (305 pass, 4 intentional skips, 0 fail), and annotated tag `v1.2.0` was pushed at `cd3ac8d`. Phase 2 Step 1 is also complete: the private ERS mirror repository exists but is empty and has no default branch. Nothing has been pushed to it.

Execution is now **paused before Phase 2 Step 2** while a separate workstream implements structural/semantic-layer changes expected to affect MCP internals. Do not populate the mirror from `v1.2.0`, create further ERS infrastructure, deploy, migrate, seed, or change either hosted stack during this pause. Resume only through the gate below.

**Clock:** ELT comments due 22 Jul feed the rollout gate; pausing for the structural integration gate may move the original migration timing. The reported 28 Jul MCP milestone was verified on 2026-07-16 from the official draft changelog and TypeScript SDK: it is the expected full-spec/stable-SDK-v2 release, not a same-day v1 shutdown (spec §12 risk 1).

## Locked decisions (do not re-litigate; detail in spec §9)

- Topology: deployment fork, not code fork — zero `src/` divergence ever. Private `ERS-Genomics/brain-mcp-server` mirror tracks upstream **tags** + carries a config overlay only.
- John's ERS principal: `jemilad-ers`, numeric id **259372947**, role **owner**. Never reuse 220941196 (JEM-Fizbit) on the ERS stack.
- Hostname: custom ERS domain, working name `brain.ersgenomics.online` (exact label confirmed at DNS-record creation, **before** the GitHub OAuth app exists — one-way door).
- Accounts: separate ERS Fly account + ERS Supabase org under `john.milad@ersgenomics.com`; Cillian McGorman = second admin/break-glass (provisioned at stand-up) and first pilot colleague (after the cross-tenant isolation test passes).
- PITR deferred; region lhr + eu-west-2; `BRAIN_DATE_TIME_ZONE=Europe/Dublin`; image-baked registry v1; operator-local guarded deploys; Slack alerting ON at cutover (rotated jembot token, explicit channel/DM env); personal stack goes alert-less; single-operator ingestion at launch (automated Graph-API pipeline is a captured BACKLOG fast-follower); `GITHUB_ALLOWED_*` hard-gated in code; release tags anchor mirror updates.

## Verified state at pause (2026-07-17)

| Check | Result |
|---|---|
| Spec 012 | Approved; all §9 decisions resolved; Phase 0 header and decision-record tidy complete |
| Public upstream | Clean and synchronized before this savepoint update; `main`, `origin/main`, and annotated `v1.2.0` all at `cd3ac8d` |
| §1 upstream hardening | Complete in five logical commits; `npm test` passed 305/305 runnable tests with 4 intentional skips; `npm run build` passed |
| ERS mirror repository | Created under ERS custody; verified `PRIVATE`, empty, no default branch, and `jemilad-ers` has admin access; no code, tags, overlay, or secrets pushed |
| Other ERS infra | No Fly, Supabase, OAuth, DNS, database, deployment, migration, seed, or asset-register action performed |
| Phase 2 approval | Step 1 exhausted; Step 2 (populate/tag-track the mirror) is not approved and must not run during the structural-work pause |
| Personal stack | Untouched by Phase 2 work |
| GitHub transport | `github-work` SSH authenticates as `jemilad-ers`; public `origin` remains `git@github-personal:JEM-Fizbit/brain-mcp-server.git` |
| CLI diagnostic | Authenticated GraphQL verified the work identity and created/inspected the repository; `gh auth status` still misreports the keyring entries because its REST identity check receives a non-JSON response |
| Gate-0 stragglers | OAuth-row purge predicate remains unwritten; the 28 Jul MCP milestone is verified and no longer an open fact-check |
| Register (2026-07-13) | Items 1–4, 8, 12, 13 resolved; 5 resolved-for-pilot; 6 + 11 GC-owned in parallel; 10 at cutover; 14 = standing rollout gate. Nothing blocks the migration |

## Structural-update pause gate

The next mirror target must be the first tested upstream release that includes the in-flight structural/semantic-layer changes, not automatically `v1.2.0`.

Before asking for Phase 2 Step 2 approval:

1. Land the generic structural changes in the public upstream with no ERS-only identity or configuration.
2. Review the resulting `src/`, `db/`, `scripts/`, indexing, retrieval, seeding, and migration changes against spec 012.
3. Run `npm test`, `npm run build`, and the relevant semantic/retrieval evaluations.
4. If hosted behaviour or data structures materially changed, deploy and verify the personal stack before treating the release as the ERS base.
5. Cut and push a new annotated upstream release tag (likely `v1.3.0` for a material semantic architecture change; determine from the landed diff).
6. Present Phase 2 Step 2 again for explicit approval, naming that exact tag. Only then populate the private mirror and establish its tag-tracking relationship.

## Execution order

**Phase 0 — complete:** spec 012 header/decision wording and DECISIONS.md were reconciled.

**Phase 1 — complete:** §1 P0/P1 upstream hardening shipped test-first; `v1.2.0` was annotated and pushed at `cd3ac8d`.

**Phase 2 — paused after Step 1:** the private repository exists and remains empty. Step 2 (populate from the post-structural release tag and establish the mirror relationship) and every M1 step remain individually ask-first.

**Phase 3 — M2/M3 (spec §§4–6, checklist §10):** pre-flight `pg_dump` checkpoint (needs a PG17-compatible dump path or Docker — currently uninstalled), re-seed (md = live count on the day; sources `BRAIN_EXPECTED_SOURCE_COUNT=125`, never 128), parity + restore rehearsal on the ERS project, sync re-point (atomic with connector flip), enrollment (ChatGPT Business delete/recreate first, Codex last), 2–3-day soak, then the purge — **CEO sign-off on the verification evidence first** (register item 10); write the OAuth-row purge predicate before cutover day.

## Hard rules

- Repo is **public**: nothing ERS-identifying (registry, staff GitHub ids, internal URLs/runbooks) is ever committed upstream — mirror-only.
- Ask-first for every ERS-infra-mutating or hosted-mutating command; classify with `docs/TOOLING.md`. The personal stack (`jem-brain-mcp`, pilot Supabase) stays untouched except the explicitly listed steps (Slack env explicit-set, registry shrink, purge, jembot unset).
- `BRAIN_REVISION_DATABASE_URL` always transaction pooler `:6543` (session pooler re-triggers the EMAXCONNSESSION outage).
- No force-push; never edit synced `docs/protocols/` copies.

## Verification commands

`npm run build` · `npm test` (Phase 0–1); per-phase gates embedded in spec §§3–7; docs-only changes `git diff --check`.
