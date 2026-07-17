# 2026-07-16 ERS Fork Execution Savepoint

**Status:** post-structural checkpoint — Phase 0/1 and the structural integration gate are complete; Phase 2 Steps 1–2 complete; paused before Step 3 (private overlay)
**Repo:** `/Users/johnemilad/Projects/brain-mcp-server` (public; branch `main`; exact private-mirror baseline `v1.4.2`)
**Plan of record:** [`docs/specs/012-ers-mcp-fork.md`](../specs/012-ers-mcp-fork.md) — read it in full before acting; this savepoint is the state snapshot, the spec is the plan
**Governance record:** `governance/brain-mcp-fork-signoff.md` in the ERS Brain (hosted `brain_id: ers-brain`; SharePoint mirror `…/01_ers-brain/brain/governance/`)
**Evidence base:** `~/Projects/claude-ops/plans/brain-platform/2026-07-12-ers-fork-dependency-audit.md` (13-surface audit, file:line refs — local-only, do NOT copy into this public repo)

Read this first if you are a fresh session executing the ERS Brain MCP fork (spec 012).

## TL;DR

Planning remains complete and all 16 decisions are resolved (spec §9 table + register). Phase 0 and Phase 1 remain complete at the historical `v1.2.0` anchor. The subsequent spec 013 structural server/content work shipped through `v1.4.1`, was deployed and verified on the personal pilot, and is now reconciled into the fork plan at `v1.4.2`. Phase 2 Steps 1–2 are complete: the private ERS mirror repository exists and contains only annotated upstream tag `v1.4.2` plus its reachable history. It still has no branch, default branch, overlay, or secret.

Execution is **paused before Phase 2 Step 3 (the private ERS overlay) for explicit approval**, not for further structural work. Do not add the private overlay, create further ERS infrastructure, deploy, migrate, seed, or change either hosted stack without the individual approval required below. The mirror intake is pinned to annotated upstream tag `v1.4.2`; never mirror `main` HEAD.

**Clock:** ELT comments due 22 Jul feed the rollout-beyond-pilot gate, not this migration. The graph-primary inverse-comparison window runs through 24 Jul but does not block mirror population, M1 stand-up, or M2 reseeding. The reported 28 Jul MCP milestone was verified on 2026-07-16 from the official draft changelog and TypeScript SDK: it is the expected full-spec/stable-SDK-v2 release, not a same-day v1 shutdown (spec §12 risk 1).

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
| Public upstream | `v1.4.2` is the exact annotated mirror candidate; closeout requires clean `main`, `origin/main`, and tag convergence |
| §1 upstream hardening | Complete at `v1.2.0`; inherited unchanged by the current release line |
| Structural integration | Spec 013 server/content work deployed through `v1.4.1`; 39 JEM + 50 ERS hosted files, zero conflicts, bootstraps within budget, routing/policy/search evaluations unchanged; all changes from `v1.4.1` to `v1.4.2` are documentation, tests, examples, or release metadata, including the fork reconciliation and migration-manifest regression test |
| Supabase manifest | Six tenant-neutral migrations, in filename order; fresh-stack docs now include durable OAuth state, tombstones, and the private revision-FTS index; advisors after each and full security gate after the sequence |
| Release gate | Supported Node 22 build passed; `npm test` = 329 pass, 4 intentional skips, 0 fail; routing 27/27, policy 17/17, signposts 92/92, search 10/10 |
| ERS mirror repository | Created under ERS custody; verified `PRIVATE`, `jemilad-ers` admin, no branch/default branch, and exactly one imported ref: annotated tag `v1.4.2` (`5e726fa` → `c67387e`); no overlay or secrets pushed |
| Other ERS infra | No Fly, Supabase, OAuth, DNS, database, deployment, migration, seed, or asset-register action performed |
| Phase 2 approval | Steps 1–2 exhausted; Step 3 (private config/test/docs overlay on `v1.4.2`) is the next individually ask-first action |
| Personal stack | Structural runtime/content work was already deployed and verified by its owning workstream through `v1.4.1`; this `v1.4.2` reconciliation changes no runtime and performs no personal hosted mutation |
| GitHub transport | `github-work` SSH authenticates as `jemilad-ers`; the isolated mirror checkout uses private `origin`, a version-tag-only public `upstream`, disabled upstream pushes, and private-origin default pushes; the public checkout still has only its personal `origin` |
| CLI diagnostic | Live `gh auth status` recognizes both accounts with `jemilad-ers` active; GraphQL/repository inspection and `github-work` SSH independently verify the work identity and custody |
| Gate-0 stragglers | OAuth-row purge predicate remains unwritten; the 28 Jul MCP milestone is verified and no longer an open fact-check |
| Register (2026-07-13) | Items 1–4, 8, 12, 13 resolved; 5 resolved-for-pilot; 6 + 11 GC-owned in parallel; 10 at cutover; 14 = standing rollout gate. Nothing blocks the migration |

## Structural-update gate and Phase 2 Step 2 — complete

The imported post-structural mirror target is `v1.4.2`, not the historical `v1.2.0` anchor and not `main` HEAD.

Evidence used to approve and execute Phase 2 Step 2:

1. Generic structural changes landed upstream without a private ERS registry or overlay.
2. `src/`, `db/`, `scripts/`, indexing, retrieval, seeding, migration, and configuration deltas were reviewed against spec 012.
3. Node 22 `npm test`, `npm run build`, and `npm run eval:brain:routing` pass at the release candidate.
4. The material runtime/data changes were deployed and verified on the personal pilot at `v1.4.1`; `v1.4.2` has no runtime delta from that deployed tag.
5. The complete six-migration fresh-stack sequence, 50-file ERS structural baseline, graph lint overlay requirements, and ranked-search/role smoke expectations are recorded and regression-tested.
6. Annotated upstream tag `v1.4.2` was pushed before Step 2 approval; the approved Step 2 then imported that exact tag into the private mirror and established the one-way version-tag-only upstream relationship without creating a branch.

## Execution order

**Phase 0 — complete:** spec 012 header/decision wording and DECISIONS.md were reconciled.

**Phase 1 + structural integration — complete:** §1 P0/P1 upstream hardening shipped test-first at `v1.2.0`; spec 013 runtime/content changes were deployed through `v1.4.1`; `v1.4.2` is the reconciled tag-only mirror candidate.

**Phase 2 — paused after Step 2:** the private repository contains only annotated tag `v1.4.2` and its reachable history. Step 3 (private overlay: ERS registry, `fly.toml`, deployment expectations, and ERS runbook) and every M1 step remain individually ask-first.

**Phase 3 — M2/M3 (spec §§4–6, checklist §10):** pre-flight `pg_dump` checkpoint (needs a PG17-compatible dump path or Docker — currently uninstalled), re-seed (current md baseline = 50 but the live SharePoint count on the day is authoritative; sources `BRAIN_EXPECTED_SOURCE_COUNT=125`, never 128), parity + restore rehearsal on the ERS project, sync re-point (atomic with connector flip), enrollment (ChatGPT Business delete/recreate first, Codex last), 2–3-day soak, then the purge — **CEO sign-off on the verification evidence first** (register item 10); write the OAuth-row purge predicate before cutover day.

## Hard rules

- Repo is **public**: nothing ERS-identifying (registry, staff GitHub ids, internal URLs/runbooks) is ever committed upstream — mirror-only.
- Ask-first for every ERS-infra-mutating or hosted-mutating command; classify with `docs/TOOLING.md`. The personal stack (`jem-brain-mcp`, pilot Supabase) stays untouched except the explicitly listed steps (Slack env explicit-set, registry shrink, purge, jembot unset).
- `BRAIN_REVISION_DATABASE_URL` always transaction pooler `:6543` (session pooler re-triggers the EMAXCONNSESSION outage).
- No force-push; never edit synced `docs/protocols/` copies.

## Verification commands

Node 22: `npm run build` · `npm test` · `npm run eval:brain:routing`; verify package/tag agreement and `git diff v1.4.1..v1.4.2 -- src db scripts Dockerfile fly.toml` is empty; per-phase gates are embedded in spec §§3–7; docs checks include `git diff --check` and Markdown-link verification.
