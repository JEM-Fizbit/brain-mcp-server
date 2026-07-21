# 2026-07-16 ERS Fork Execution Savepoint

**Status:** execution checkpoint — Phase 0/1 complete; dedicated ERS prototype live on guarded private `v1.4.7`; personal `jem-brain-mcp` live on public `v1.4.9` against the JEM-only clone; two-way Brain isolation and Claude Code `brain-ers` verification passed; connector cleanup, Cillian onboarding, soak/recovery evidence, and Entra production identity remain
**Repo:** `/Users/johnemilad/Projects/brain-mcp-server` (public `main` at `v1.4.9`; private mirror branch `ers/v1.4.7`, based on exact annotated upstream `v1.4.7`)
**Plan of record:** [`docs/specs/012-ers-mcp-fork.md`](../specs/012-ers-mcp-fork.md) — read it in full before acting; this savepoint is the state snapshot, the spec is the plan
**Governance record:** `governance/brain-mcp-fork-signoff.md` in the ERS Brain (hosted `brain_id: ers-brain`; SharePoint mirror `…/01_ers-brain/brain/governance/`)
**Evidence base:** `~/Projects/claude-ops/plans/brain-platform/2026-07-12-ers-fork-dependency-audit.md` (13-surface audit, file:line refs — local-only, do NOT copy into this public repo)

Read this first if you are a fresh session executing the ERS Brain MCP fork (spec 012).

## TL;DR

Planning remains complete and all 16 decisions are resolved (spec §9 table + register). Phase 0 and Phase 1 remain complete at the historical `v1.2.0` anchor. The subsequent spec 013 structural server/content work shipped through `v1.4.1`, was deployed and verified on the personal pilot, and was reconciled into the fork plan at `v1.4.2`. The first Step 3 overlay preflight then proved that `v1.4.2` could not satisfy its own zero-test-divergence or guarded-deploy acceptance criteria; `v1.4.3` fixed those generic blockers. The 2026-07-18 beta incident then exposed a Brain-vault namespace and conflict-idempotency defect, fixed in `v1.4.4`; the related stale local-state inventories were safely rebased with the `v1.4.5` maintenance command. The first guarded deployment attempt against the private `v1.4.5` overlay then refused safely because the generic overlay allow-list did not admit its public CA certificate. No tests, image build, Fly mutation, provenance write, machine, or deployment occurred. The allow-list was hardened test-first upstream in `v1.4.6` to accept public `config/*.crt` trust anchors while continuing to reject private keys and every unapproved path. The private repository imported that exact annotated tag, reapplied its five-file overlay, and pushed branch `ers/v1.4.6` at `a78f8a5` to private `origin`.

The dedicated ERS runtime is live and healthy on guarded private `v1.4.7`; its ERS-only registry, custom hostname, OAuth boundary, strict-TLS database path, least-privilege runtime login, and live foreign-Brain/unregistered-identity denial checks pass. The personal runtime is separately live on public `v1.4.9`, whose image carries Supabase's public CA for `verify-full` transaction-pooler connections and whose registry contains only `ai-brain-jem`. On 2026-07-21 the personal Fly secrets were rewired to the prepared JEM-only personal clone. Direct database, hosted MCP, and rolled-back write-permission checks passed; `ers-brain` is not accessible from the personal endpoint. The two deployments now have separate Fly, Supabase, registry, OAuth-state, and content boundaries. Never mirror `main` HEAD into the private deployment; intake reviewed annotated tags only.

The 2026-07-20 Supabase administration sequence changed the recovery order. The project containing both `ai-brain-jem` and `ers-brain` is now under ERS organisation custody and is the intended ERS destination. A database-only restore named `jem-brain-personal` was completed inside that organisation because Supabase requires restore-to-new-project to start in the source organisation. On 2026-07-20 that clone was transferred successfully to the existing personal Pro organisation and verified present there and absent from the ERS organisation. The temporary cross-organisation transfer membership was then removed, and the ERS session was verified unable to access the personal organisation while the ERS organisation and its two owners remained intact. The personal owner had been verified present immediately before the removal. The clone's temporary database password was then replaced in the personal-owner session with an owner-generated, Dashlane-custodied value and verified by a direct read-only Postgres query over certificate-verified TLS. The JEM-only Storage copy then moved exactly 70 objects / 13,756,608 bytes under `brains/ai-brain-jem/`; all destination objects were downloaded again and matched their source SHA-256, with aggregate digest `7778e3ef7bc37f8c88ec00aca7696b49869ae92efa70db3903feedf53963add7`. The temporary local probes, CA copy, and copier were removed immediately after their verification runs. The exact two-revision post-backup JEM delta was then applied in one guarded transaction. Post-write parity is clean: 362 revisions, 39 file heads, 0 open conflicts, 0 revision-content hash mismatches, 0 head/revision mismatches, 70 sources, 70 source artifacts, 49 extracted artifact texts, and 70 JEM Storage objects; both new heads match the source revision IDs, parent IDs, hashes, timestamps, and actor metadata. The ERS relational tenant was then removed from the personal clone by deleting its single Brain root inside a guarded transaction: 374 revisions, 51 file heads, 426 historical conflicts, 128 sources/artifacts, 57 extracted texts, and 53,106 events cascaded to zero. JEM revision/file fingerprints, counts and integrity remained unchanged; OAuth remained at 502 rows; RLS stayed enabled with no public/client Brain grants. The database now registers only `ai-brain-jem`. The remaining 128 `ers-brain` Storage entries were then deleted through the official Storage API after a 128-ERS/70-JEM preflight. Independent post-delete verification reports ERS Storage = 0, total/JEM Storage = 70 objects / 13,756,608 bytes, and 0 missing artifact objects; the in-memory credential helper was stopped and removed immediately. The personal runtime was subsequently rewired to this clone and verified as described above; the ERS source project has not been pruned. The restored project reference, passwords, API keys, connection strings, and Brain content are deliberately not recorded in this public repository.

The personal clone preserved 502 OAuth rows, but the active Codex refresh token had rotated after the database snapshot. The first post-cutover call therefore failed safely with `invalid_grant`; the personal `brain` MCP was deliberately logged out and re-enrolled through GitHub as `JEM-Fizbit`. A fresh hosted `brain_sync_status` then returned `ai-brain-jem`, revision provider, 39 files, and zero conflicts, while an explicit `ers-brain` request was denied. ERS OAuth remains separate under its own issuer/audience and registration state.

The isolated ERS Fly CLI profile lives at `/Users/johnemilad/.config/fly-ers` and authenticates as `john.milad@ersgenomics.com`; every ERS Fly command must set `FLY_CONFIG_DIR` to that path. The ordinary Fly CLI profile remains personal and must not be switched globally. The ERS app is `ers-brain-mcp` in organisation `ers-genomics`. Its custom hostname resolves through Cloudflare, presents a valid certificate, and serves guarded private `v1.4.7` from one healthy lhr machine.

**Clock:** ELT comments due 22 Jul feed the rollout-beyond-pilot gate, not this migration. The graph-primary inverse-comparison window runs through 24 Jul but does not block mirror population, M1 stand-up, or M2 reseeding. The reported 28 Jul MCP milestone was verified on 2026-07-16 from the official draft changelog and TypeScript SDK: it is the expected full-spec/stable-SDK-v2 release, not a same-day v1 shutdown (spec §12 risk 1).

## Locked decisions (do not re-litigate; detail in spec §9)

- Topology: deployment fork, not code fork — zero `src/` divergence ever. Private `ERS-Genomics/brain-mcp-server` mirror tracks upstream **tags** + carries a config overlay only.
- John's ERS principal: `jemilad-ers`, numeric id **259372947**, role **owner**. Never reuse 220941196 (JEM-Fizbit) on the ERS stack.
- Hostname: custom ERS domain, working name `brain.ersgenomics.online` (exact label confirmed at DNS-record creation, **before** the GitHub OAuth app exists — one-way door).
- Accounts: separate ERS Fly account + ERS Supabase org under `john.milad@ersgenomics.com`; Cillian McGorman = second admin/break-glass (provisioned at stand-up) and first pilot colleague (after the cross-tenant isolation test passes).
- PITR deferred; region lhr + eu-west-2; `BRAIN_DATE_TIME_ZONE=Europe/Dublin`; image-baked registry v1; operator-local guarded deploys; Slack alerting ON at cutover (rotated jembot token, explicit channel/DM env); personal stack goes alert-less; single-operator ingestion at launch (automated Graph-API pipeline is a captured BACKLOG fast-follower); `GITHUB_ALLOWED_*` hard-gated in code; release tags anchor mirror updates.

## Verified execution state (reconciled 2026-07-21)

| Check | Result |
|---|---|
| Spec 012 | Approved; all §9 decisions resolved; Phase 0 header and decision-record tidy complete |
| Public upstream | `v1.4.9` is live on the personal deployment at commit `853df9e`; `v1.4.8` shrank the public deployment profile to JEM-only and `v1.4.9` image-baked Supabase's public CA for certificate/hostname-verified pooler TLS |
| §1 upstream hardening | Complete at `v1.2.0`; inherited unchanged by the current release line |
| Structural integration | Spec 013 server/content work deployed through `v1.4.1`; 39 JEM + 50 ERS hosted files, zero conflicts, bootstraps within budget, routing/policy/search evaluations unchanged; all changes from `v1.4.1` to `v1.4.2` are documentation, tests, examples, or release metadata, including the fork reconciliation and migration-manifest regression test |
| Supabase manifest | The existing ERS destination has all six tenant-neutral migration effects, including durable OAuth state, tombstones, and the private revision-FTS index. Only the first two appear in the migration ledger, so the remaining four must not be replayed blindly; structural fingerprints and the security gate are authoritative pending later ledger reconciliation |
| Release gate | Public Node 22 `npm test` at `v1.4.9` = 348 total, 343 pass, 5 intentional skips, 0 fail. Private Node 22 `npm test` at `v1.4.7` = 347 total, 342 pass, 5 intentional skips, 0 fail; protected-source diff is empty |
| ERS mirror repository | Verified private and under ERS custody; exact annotated `v1.4.7` plus the reviewed overlay and current private operational records are pushed on branch `ers/v1.4.7`; no secrets committed |
| Other ERS infra | Dedicated ERS Fly, Supabase, GitHub OAuth, DNS/TLS, and private-repository surfaces are live under ERS custody. Guarded private `v1.4.7` runs on one healthy lhr machine; ERS-side foreign-Brain read/write denial and unregistered-identity rejection pass |
| Supabase production gate | Passed 2026-07-21: 15/15 Brain tables have RLS; zero `anon`/`authenticated`/`public` Brain grants; all 15 Brain policies are `brain_runtime`-only; `brain_runtime` is no-login, non-superuser, and non-bypass; the artifact bucket is private; Storage policies are zero; `public.rls_auto_enable()` is unavailable to client/public roles; security advisors return no findings |
| Dedicated runtime login | `brain_runtime_user` exists with LOGIN and a user-generated Dashlane-custodied password; it inherits `brain_runtime` and has no superuser, create-role, create-database, replication, or RLS-bypass privilege. Direct read-only authentication through the shared transaction pooler on `:6543` passed with `verify-full` against Supabase's published CA; the encoded runtime URL is user-custodied in Dashlane |
| ERS production seed | The idempotent `ers-brain` metadata upsert is complete: `environment=ers-production`, company ownership/canonical/access/fallback fields are present, `team_access=false`, and `production_cutover_requires_ers_owned_project=false`; post-write security advisors remain clean |
| Phase 2 approval | Repository/mirror intake, guarded ERS deployment, ERS-side isolation probes, personal recovery/cutover, and personal-endpoint negative isolation are complete. Organization connector cleanup and Cillian registry/onboarding remain ask-first |
| Private overlay | Private `ers/v1.4.7` contains the ERS registry, Fly configuration, deployment expectations, ERS deploy/ops runbook, Supabase public CA, and private operational records; protected source/runtime paths remain identical to annotated upstream `v1.4.7` |
| DNS / certificate | The ERS custom hostname resolves through Cloudflare to Fly, presents a valid certificate, and serves the healthy dedicated runtime |
| Personal stack | Fly machine version 60 serves public `v1.4.9` from `jem-brain-mcp`. The registry and database contain only `ai-brain-jem`: 362 revisions, 39 live heads, 0 tombstoned heads, 0 open conflicts, 70 sources, 70 source artifacts, 49 extracted texts, and 502 OAuth rows. Runtime access uses `brain_runtime_user`, inherits only `brain_runtime`, and has no superuser/create-role/create-database/RLS-bypass privileges. Hosted status passes; explicit `ers-brain` access is denied; a transaction-scoped canary write succeeded and rolled back cleanly. The JEM Storage baseline remains 70 objects / 13,756,608 bytes with the previously verified aggregate SHA-256. Temporary credential/rollback/helper files were removed after verification |
| GitHub transport | `github-work` SSH authenticates as `jemilad-ers`; the isolated mirror checkout uses private `origin`, a version-tag-only public `upstream`, disabled upstream pushes, and private-origin default pushes; the public checkout still has only its personal `origin` |
| CLI diagnostic | Live `gh auth status` recognizes both accounts; GraphQL/repository inspection and the `github-work` SSH alias independently verify the work identity and custody without relying on global active-account state |
| Gate-0 stragglers | OAuth-row purge predicate remains unwritten; the 28 Jul MCP milestone is verified and no longer an open fact-check |
| Register (2026-07-13) | Items 1–4, 8, 12, 13 resolved; 5 resolved-for-pilot; 6 + 11 GC-owned in parallel; 10 at cutover; 14 = standing rollout gate. Nothing blocks the migration |

## Structural-update gate, Phase 2 Step 2, and overlay preflight — complete

The first imported post-structural mirror target was `v1.4.2`, not the historical `v1.2.0` anchor and not `main` HEAD. The private overlay subsequently moved through annotated `v1.4.5` for the `v1.4.3` release-contract fixes, `v1.4.4` reserved-namespace/conflict-idempotency correction, and parity-gated local-state maintenance command. It is now pinned to annotated `v1.4.6`, which adds only the generic public-CA overlay allowance required by the strict-TLS ERS configuration.

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

**Phase 1 + structural integration — complete:** §1 P0/P1 upstream hardening shipped test-first at `v1.2.0`; spec 013 runtime/content changes were deployed through `v1.4.1`; `v1.4.2` was the first imported tag; private `v1.4.7` and personal `v1.4.9` are the current deployed release lines.

**Phase 2 — dedicated ERS deployment and two-way isolation complete:** guarded private `v1.4.7` is live and healthy; ERS-side foreign-Brain and unregistered-identity probes pass. Public `v1.4.9` is live against the JEM-only personal clone; the personal endpoint returns only `ai-brain-jem` and denies `ers-brain`. Organization connector cleanup and the Cillian registry/deploy/onboarding sequence remain individually ask-first.

**Phase 3 — pilot onboarding, soak, and recovery evidence:** the personal recovery/cutover is complete and its stale Codex OAuth client was deliberately re-enrolled. Add Cillian only through an approved private-registry commit, guarded ERS redeploy, and read-only onboarding smoke. Complete soak/restore evidence and the remaining approved cleanup/sign-off gates. Microsoft Entra ID remains mandatory before any rollout beyond John and Cillian.

## Exact restart gate (2026-07-21)

Stop state: no hosted action is running. Public `main`/`v1.4.9` and private `ers/v1.4.7` are the two deployed release lines. The personal runtime is healthy on the JEM-only personal clone; the ERS runtime is healthy on its ERS-only stack. Positive routing and both negative Brain-boundary checks pass. The personal Codex connector has been freshly re-enrolled. All temporary credential, rollback, and helper files used for the personal cutover were removed.

Claude Code is logged into the ERS Genomics team account and now has both user-scope hosted entries: `brain` for JEM and `brain-ers` for ERS. The dedicated ERS entry is connected and its read-only smoke returned `ers-brain`, revision provider, 50 hosted files, zero conflicts, and cursor `2026-07-20T13:20:50.054Z` without reading Brain content.

The next session must:

1. Read this savepoint first, then spec 012 in full; do not reopen §9.
2. Verify public/private cleanliness and current live health without changing either runtime.
3. Reconcile the remaining user-facing connector names/descriptions at their supported account/organization surfaces.
4. Obtain Cillian's exact numeric GitHub identity, then present the private-registry commit and guarded ERS redeploy for approval before inviting him.
5. Complete Cillian's read-only smoke, soak/restore evidence, and the remaining cleanup/sign-off gates.
6. Implement Microsoft Entra ID before onboarding anyone beyond John and Cillian.

Fresh-session kickoff prompt:

> Resume the ERS Brain MCP fork (spec 012). Read `docs/savepoints/2026-07-16-ers-fork-execution.md` first, then `docs/specs/012-ers-mcp-fork.md`, then `docs/TOOLING.md`. Treat this savepoint as current and do not re-litigate §9. The dedicated ERS `v1.4.7` runtime and personal JEM-only `v1.4.9` runtime are live, healthy, and mutually isolated. Start with read-only cleanliness/health checks, then continue connector-name cleanup and the separately approved Cillian onboarding sequence. Preserve the public/private boundary and ask first for every hosted or organization mutation.

## Hard rules

- Repo is **public**: nothing ERS-identifying (registry, staff GitHub ids, internal URLs/runbooks) is ever committed upstream — mirror-only.
- Ask-first for every ERS-infra-mutating or hosted-mutating command; classify with `docs/TOOLING.md`. Personal-stack mutations are limited to the separately approved recovery/cutover steps: personal-clone transfer and completion, credential rotation, `jem-brain-mcp` rewire, verification/soak, registry shrink, JEM-data removal from ERS, and jembot removal/rotation.
- Credential custody: announce every password creation/reset, API-key creation/rotation, and hosting-secret change before it occurs. Permanent credentials are generated and recorded in Dashlane by the user, then entered directly into the provider UI; the agent never requests or prints them. Browser-generated or automation-visible passwords are temporary and must be rotated before use. Do not save credentials in the in-app browser, chat, repo, savepoint, or command output.
- `BRAIN_REVISION_DATABASE_URL` always transaction pooler `:6543` (session pooler re-triggers the EMAXCONNSESSION outage).
- No force-push; never edit synced `docs/protocols/` copies.

## Verification commands

Node 22: `npm run build` · `npm test` · `npm run eval:brain:routing`; verify package/tag agreement and private protected-path parity against its pinned annotated tag; per-phase gates are embedded in spec §§3–7; docs checks include `git diff --check` and Markdown-link verification.
