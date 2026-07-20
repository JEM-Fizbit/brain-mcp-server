# 2026-07-16 ERS Fork Execution Savepoint

**Status:** execution checkpoint — Phase 0/1 complete; Phase 2 private `v1.4.3` overlay committed and pushed; corrective `v1.4.5` intake/rebase is the next repository gate; M1 Fly app reserved but not deployed; Supabase custody recovery in progress
**Repo:** `/Users/johnemilad/Projects/brain-mcp-server` (public; branch `main`; private overlay baseline `v1.4.3` at `adf6b3f`; next exact mirror candidate `v1.4.5`)
**Plan of record:** [`docs/specs/012-ers-mcp-fork.md`](../specs/012-ers-mcp-fork.md) — read it in full before acting; this savepoint is the state snapshot, the spec is the plan
**Governance record:** `governance/brain-mcp-fork-signoff.md` in the ERS Brain (hosted `brain_id: ers-brain`; SharePoint mirror `…/01_ers-brain/brain/governance/`)
**Evidence base:** `~/Projects/claude-ops/plans/brain-platform/2026-07-12-ers-fork-dependency-audit.md` (13-surface audit, file:line refs — local-only, do NOT copy into this public repo)

Read this first if you are a fresh session executing the ERS Brain MCP fork (spec 012).

## TL;DR

Planning remains complete and all 16 decisions are resolved (spec §9 table + register). Phase 0 and Phase 1 remain complete at the historical `v1.2.0` anchor. The subsequent spec 013 structural server/content work shipped through `v1.4.1`, was deployed and verified on the personal pilot, and was reconciled into the fork plan at `v1.4.2`. The first Step 3 overlay preflight then proved that `v1.4.2` could not satisfy its own zero-test-divergence or guarded-deploy acceptance criteria; `v1.4.3` fixed those generic blockers. The private repository imported annotated `v1.4.3`, committed the exact four-surface ERS overlay at `adf6b3f`, established `ers/v1.4.3` as its default branch, and pushed both the branch and tag to private `origin`. The 2026-07-18 beta incident then exposed a Brain-vault namespace and conflict-idempotency defect, fixed in `v1.4.4`; the related stale local-state inventories were safely rebased with the `v1.4.5` maintenance command.

Execution is continuing from a stable private `v1.4.3` overlay baseline. The next release-intake mutation is to import annotated tag `v1.4.5`, reapply the unchanged four-surface overlay, run the private gates, and push a release-specific branch after its individual approval. The ERS Fly app name has been reserved in the ERS organisation but has no image or deployment. Supabase custody recovery is the active external-administration lane described below. No deployment, migration, seed, secret, DNS, OAuth, or Brain-data mutation is authorized by this savepoint update. Never mirror `main` HEAD.

The 2026-07-20 Supabase administration sequence changed the recovery order. The project containing both `ai-brain-jem` and `ers-brain` is now under ERS organisation custody and is the intended ERS destination. A database-only restore named `jem-brain-personal` was completed inside that organisation because Supabase requires restore-to-new-project to start in the source organisation. On 2026-07-20 that clone was transferred successfully to the existing personal Pro organisation and verified present there and absent from the ERS organisation. It must next receive the JEM-only Storage and post-backup delta and pass parity before either runtime is rewired or either tenant is pruned. The restored project reference, passwords, API keys, and connection strings are deliberately not recorded in this public repository.

**Clock:** ELT comments due 22 Jul feed the rollout-beyond-pilot gate, not this migration. The graph-primary inverse-comparison window runs through 24 Jul but does not block mirror population, M1 stand-up, or M2 reseeding. The reported 28 Jul MCP milestone was verified on 2026-07-16 from the official draft changelog and TypeScript SDK: it is the expected full-spec/stable-SDK-v2 release, not a same-day v1 shutdown (spec §12 risk 1).

## Locked decisions (do not re-litigate; detail in spec §9)

- Topology: deployment fork, not code fork — zero `src/` divergence ever. Private `ERS-Genomics/brain-mcp-server` mirror tracks upstream **tags** + carries a config overlay only.
- John's ERS principal: `jemilad-ers`, numeric id **259372947**, role **owner**. Never reuse 220941196 (JEM-Fizbit) on the ERS stack.
- Hostname: custom ERS domain, working name `brain.ersgenomics.online` (exact label confirmed at DNS-record creation, **before** the GitHub OAuth app exists — one-way door).
- Accounts: separate ERS Fly account + ERS Supabase org under `john.milad@ersgenomics.com`; Cillian McGorman = second admin/break-glass (provisioned at stand-up) and first pilot colleague (after the cross-tenant isolation test passes).
- PITR deferred; region lhr + eu-west-2; `BRAIN_DATE_TIME_ZONE=Europe/Dublin`; image-baked registry v1; operator-local guarded deploys; Slack alerting ON at cutover (rotated jembot token, explicit channel/DM env); personal stack goes alert-less; single-operator ingestion at launch (automated Graph-API pipeline is a captured BACKLOG fast-follower); `GITHUB_ALLOWED_*` hard-gated in code; release tags anchor mirror updates.

## Verified execution state (reconciled 2026-07-20)

| Check | Result |
|---|---|
| Spec 012 | Approved; all §9 decisions resolved; Phase 0 header and decision-record tidy complete |
| Public upstream | `v1.4.5` (`806117b`) is the exact annotated overlay-capable corrective mirror candidate; `main` and `origin/main` include only its documentation closeout beyond the tag |
| §1 upstream hardening | Complete at `v1.2.0`; inherited unchanged by the current release line |
| Structural integration | Spec 013 server/content work deployed through `v1.4.1`; 39 JEM + 50 ERS hosted files, zero conflicts, bootstraps within budget, routing/policy/search evaluations unchanged; all changes from `v1.4.1` to `v1.4.2` are documentation, tests, examples, or release metadata, including the fork reconciliation and migration-manifest regression test |
| Supabase manifest | Six tenant-neutral migrations, in filename order; fresh-stack docs now include durable OAuth state, tombstones, and the private revision-FTS index; advisors after each and full security gate after the sequence |
| Release gate | Supported Node 22 build passed; `npm test` = 341 pass, 4 intentional skips, 0 fail; live Postgres compare-and-swap/tombstone/rename integration = 3/3; routing = 27/27 with 17/17 policy, 92/92 signposts and 10/10 search |
| ERS mirror repository | Verified private and under ERS custody; annotated `v1.4.3` imported; default branch `ers/v1.4.3`; exact four-surface overlay committed at `adf6b3f` and pushed to private `origin`; no secrets committed |
| Other ERS infra | ERS Fly organisation/admin/billing path exists and empty app `ers-brain-mcp` is reserved with no image, release, machine, or secrets. The mixed Supabase project remains under ERS custody; the completed personal recovery clone was transferred out to the personal Pro organisation on 2026-07-20. No OAuth, DNS, migration, seed, runtime-secret, or data-pruning action is recorded here |
| Phase 2 approval | The `v1.4.3` four-surface overlay step is complete. The next ask-first repository action is exact `v1.4.5` intake, overlay rebase, full private gates, and release-branch push |
| Private overlay | Pushed at `adf6b3f`: ERS registry, `fly.toml`, deployment expectations, and ERS deploy/ops runbook only; verified zero `src/`, `db/`, or `scripts/` divergence from `v1.4.3` |
| Personal stack | Fly runtime `jem-brain-mcp` release `v52` serves server `v1.4.5` and still points to the original mixed Supabase project through the transaction pooler. The live connector still exposes both `ai-brain-jem` and `ers-brain`. The personal clone is now under personal organisation custody, but no Fly secret, OAuth, API-key, endpoint rewire, Storage copy, delta application, tenant prune, or runtime cutover has occurred. The existing runtime remains live while the clone is completed, verified, rewired, and soaked |
| GitHub transport | `github-work` SSH authenticates as `jemilad-ers`; the isolated mirror checkout uses private `origin`, a version-tag-only public `upstream`, disabled upstream pushes, and private-origin default pushes; the public checkout still has only its personal `origin` |
| CLI diagnostic | Live `gh auth status` recognizes both accounts; GraphQL/repository inspection and the `github-work` SSH alias independently verify the work identity and custody without relying on global active-account state |
| Gate-0 stragglers | OAuth-row purge predicate remains unwritten; the 28 Jul MCP milestone is verified and no longer an open fact-check |
| Register (2026-07-13) | Items 1–4, 8, 12, 13 resolved; 5 resolved-for-pilot; 6 + 11 GC-owned in parallel; 10 at cutover; 14 = standing rollout gate. Nothing blocks the migration |

## Structural-update gate, Phase 2 Step 2, and overlay preflight — complete

The first imported post-structural mirror target was `v1.4.2`, not the historical `v1.2.0` anchor and not `main` HEAD. The private overlay must now move to annotated `v1.4.5` because it includes the `v1.4.3` release-contract fixes, the `v1.4.4` reserved-namespace/conflict-idempotency correction, and the parity-gated local-state maintenance command.

Evidence used to approve and execute Phase 2 Step 2:

1. Generic structural changes landed upstream without a private ERS registry or overlay.
2. `src/`, `db/`, `scripts/`, indexing, retrieval, seeding, migration, and configuration deltas were reviewed against spec 012.
3. Node 22 `npm test`, `npm run build`, and `npm run eval:brain:routing` pass at the release candidate.
4. The material runtime/data changes were deployed and verified on the personal pilot at `v1.4.1`; `v1.4.2` has no runtime delta from that deployed tag.
5. The complete six-migration fresh-stack sequence, 50-file ERS structural baseline, graph lint overlay requirements, and ranked-search/role smoke expectations are recorded and regression-tested.
6. Annotated upstream tag `v1.4.2` was pushed before Step 2 approval; the approved Step 2 then imported that exact tag into the private mirror and established the one-way version-tag-only upstream relationship without creating a branch.
7. The approved Step 3 preflight created the four overlay surfaces locally but did not commit or push them: the profile-neutral test failed on its hard-coded JEM assertion, and code inspection proved the exact-tag guard could not attest an overlay commit. Both failures were reproduced test-first and fixed generically upstream at `v1.4.3`; no ERS identity/config was added upstream.

8. Annotated `v1.4.3` was then imported into the private mirror. The reviewed four-surface overlay passed its repository gates, was committed at `adf6b3f`, and was pushed as the private default branch `ers/v1.4.3`. No source, database, script, package, lockfile, or runtime-image divergence was introduced.

## Execution order

**Phase 0 — complete:** spec 012 header/decision wording and DECISIONS.md were reconciled.

**Phase 1 + structural integration — complete:** §1 P0/P1 upstream hardening shipped test-first at `v1.2.0`; spec 013 runtime/content changes were deployed through `v1.4.1`; `v1.4.2` was the first imported tag; `v1.4.5` is the overlay-capable corrective release candidate.

**Phase 2 — `v1.4.3` overlay landed; corrective intake pending:** the private remote contains annotated tags `v1.4.2` and `v1.4.3` plus default branch `ers/v1.4.3` at overlay commit `adf6b3f`. Importing exact tag `v1.4.5`, rebasing the same four-surface overlay onto it, running the full private gates, and pushing the new release branch is the next individually ask-first repository action. Every remaining M1 step remains separately ask-first.

**Phase 3 — recovery plus M2/M3 (spec §§4–6, checklist §10):** the completed database clone has been transferred to the personal Supabase organisation. Next copy only JEM Storage, apply the post-backup JEM delta, remove ERS data from the personal clone, and verify/soak the rewired `jem-brain-mcp`. In parallel-safe ERS work, finish the private `v1.4.5` intake and stand up `ers-brain-mcp` against the current ERS Supabase project. Then re-seed/verify ERS (current md baseline = 50 but the live SharePoint count on the day is authoritative; sources `BRAIN_EXPECTED_SOURCE_COUNT=125`, never 128), run parity + restore rehearsal, re-point ERS sync and clients, soak 2–3 days, and only then prune JEM data from ERS — **CEO sign-off on the verification evidence first**; write the OAuth-row purge predicate before cutover day.

## Hard rules

- Repo is **public**: nothing ERS-identifying (registry, staff GitHub ids, internal URLs/runbooks) is ever committed upstream — mirror-only.
- Ask-first for every ERS-infra-mutating or hosted-mutating command; classify with `docs/TOOLING.md`. Personal-stack mutations are limited to the separately approved recovery/cutover steps: personal-clone transfer and completion, credential rotation, `jem-brain-mcp` rewire, verification/soak, registry shrink, JEM-data removal from ERS, and jembot removal/rotation.
- Credential custody: announce every password creation/reset, API-key creation/rotation, and hosting-secret change before it occurs. Permanent credentials are generated and recorded in Dashlane by the user, then entered directly into the provider UI; the agent never requests or prints them. Browser-generated or automation-visible passwords are temporary and must be rotated before use. Do not save credentials in the in-app browser, chat, repo, savepoint, or command output.
- `BRAIN_REVISION_DATABASE_URL` always transaction pooler `:6543` (session pooler re-triggers the EMAXCONNSESSION outage).
- No force-push; never edit synced `docs/protocols/` copies.

## Verification commands

Node 22: `npm run build` · `npm test` · `npm run eval:brain:routing`; verify package/tag agreement and, after the private overlay exists, `git diff v1.4.5..<overlay> -- src db scripts package.json package-lock.json Dockerfile` is empty; per-phase gates are embedded in spec §§3–7; docs checks include `git diff --check` and Markdown-link verification.
