# 012 — ERS Brain MCP fork: ERS-owned stack stand-up, data cutover, and personal-stack separation

**Status:** approved — execution authorized 2026-07-13
**Source:** BACKLOG.md line "ERS Brain MCP fork / cutover (future, large — but **prefer sooner**) …" (+ related lines: adversarial cross-tenant isolation test; IP/licensing hygiene)
**Roadmap link:** [ROADMAP.md](../ROADMAP.md) Milestone 3 (ERS-Owned Supabase Migration) + Milestone 4 (ERS Multi-User Access); platform-review roadmap M1–M4 (`claude-ops/plans/brain-platform-review-2026-07/01_target-architecture-and-roadmap.md`)
**Decisions impact:** implements [DECISIONS 2026-07-06](../DECISIONS.md) D1 (migration) + D2 (topology), as amended by the 2026-07-16 entry: the migration is ungated and the deployment-fork topology is a **mandatory private ERS-org mirror tracking upstream annotated tags plus a config/test/docs overlay**. All decisions in §9 are resolved and locked.
**Related:** [OWNERSHIP_AND_LIFECYCLE.md](../OWNERSHIP_AND_LIFECYCLE.md) (destination state, exit portability); [spec 003](003-hosted-brain-sync-architecture.md) (tenant-agnostic constraints); [hosted-client-cutover.md](../hosted-client-cutover.md) (enrollment runbook template); [security gate](../security/hosted-brain-supabase-security-gate.md); **evidence base:** `claude-ops/plans/brain-platform/2026-07-12-ers-fork-dependency-audit.md` — 13-surface read-only dependency audit (2026-07-12) with file:line refs for every claim below. The evidence file stays in claude-ops (local-only) because this repo is public and the aggregate is recon-grade.

## Problem

The hosted Brain MCP is personal-owned and ERS beta-shared (John sole user). The destination state — locked in OWNERSHIP_AND_LIFECYCLE.md and the 2026-07-06 review — is **owner-scoped stacks off one codebase John owns**: ERS runs its own deployment on fully ERS-owned infra (ERS GitHub org repo, ERS Fly org, ERS Supabase org, ERS-governed IdP); the personal stack stays pristine and travels with John at ERS exit. Today every piece of ERS Brain hosted state sits on personal infra, an ERS-scoped Slack bot token sits in personal Fly secrets (a reverse dependency), and several personal defaults are baked into code such that a naive ERS deploy would silently ship John's registry, alert into the wrong channels, and health-check the wrong stack. This spec is the complete fork/migration plan: what to build, in what order, how to cut data over, how to verify, how to roll back, and what must be true afterwards for both stacks.

**Topology (locked, D2):** two single-tenant deployments of the same codebase. The runtime binds exactly one revision-store database per process, and compliance is symmetric — JEM data on ERS infra is as unacceptable as ERS data on personal infra. This is a **deployment fork, not a code fork**: zero `src/` divergence, ever.

## Acceptance criteria

- ERS stack live: `https://<ers-host>/health` green (`revisionStore=postgres`, `artifactStore=supabase`, `oauthStateStore=postgres`, `gitHotPath=disabled`); OAuth enrollment + one read and one narrow write verified from each active ERS client surface.
- Data parity at cutover: hosted `ers-brain` file count == SharePoint mirror count (50 after the 2026-07-17 structural migration — **re-measure on cutover day**), sources == 125 (the 3 `working/*` path-drift rows excluded), extracted texts ≈ 57; bidirectional sync parity passes (`--write --verify-local` and `--local-write --verify-hosted`).
- Restore rehearsal (recovery doc §8 steps) executed against the **ERS** project and timed, before cutover is declared done.
- Security gate re-run passes on the ERS project; new dated gate doc committed; Supabase advisors clean after every migration.
- Personal stack pristine: purge verification queries (§6) all return 0; `brain_list_brains` on the personal connector returns only `ai-brain-jem`; jembot token rotated and absent from `jem-brain-mcp` secrets; personal `hosted:doctor` green throughout.
- ERS mirror repo passes `npm test` with **zero test-code edits** (deployment-profile expectations file only).
- `GITHUB_ALLOWED_LOGINS`/`GITHUB_ALLOWED_EMAILS` absent from the ERS app — asserted by a test, not just convention.
- Cross-tenant isolation test (BACKLOG item) passes on the ERS stack **before any second principal is added**: an `ers-brain`-scoped principal is denied on any other brain, and an unregistered GitHub identity 403s at the OAuth callback.
- Both asset registers updated (§8); OWNERSHIP_AND_LIFECYCLE.md wording updated; new DECISIONS entry appended.

## Out of scope

- **Entra ID IdP module** — locked as roadmap-not-rollout (D1). GitHub stays IdP; the Entra path is sized in §2.4 for planning only. Precedent exists (ERS ms-graph-mcp Entra app, tenant `a0b54b24-…`).
- **Semantic/vector search build** — `brain_semantic_index`/`brain_semantic_search` hard-error on any postgres-backed brain (S1-guard; the index is filesystem-only, `brain.source_chunks` is dormant schema with zero runtime readers). ERS launches with ranked Postgres full-text `brain_search`, not vector search; a vector build is a separate promotion. Any doc implying a semantic/vector index can be "rebuilt on ERS infra post-cutover" is wrong.
- **Multi-user RLS redesign** — RLS stays `using(true)` role-boundary-only; isolation remains app-layer (registry + `brain_id`), verified by the cross-tenant test. Per-principal RLS is an M4+ question.
- **M4 team-onboarding hardening** (registry validation, hot-file concurrency, load test at 20 concurrent, colleague quickstart, adoption owner) — gates adding colleagues, not this fork; promote separately from the platform-review P1 list.
- **IP/licensing legal execution** — MIT LICENSE + `"license": "MIT"` already exist in-repo (verified; the prior "license unaudited" gap is closed). What remains is the written "ERS deploys under licence" acknowledgment — logistics flagged in §9, wording is counsel's job, separate BACKLOG item.
- **brain-local decommission** and cockpit-as-wiki — separate BACKLOG items.

## Dependency inventory (condensed)

Full current-state/target-state detail with file:line refs is in the evidence file. Summary of what must be created or re-homed:

| Surface | Current (personal stack) | ERS target | LOE |
|---|---|---|---|
| Fly | App `jem-brain-mcp`, org `personal`, lhr, 1× shared-cpu-1x/1GB, always-on, **no volume**, no custom domain, 9 secrets, no CI (operator-local `fly deploy`) | New ERS Fly org (none exists) + app (suggest `ers-brain-mcp`), same shape, all secrets minted fresh | ~1 d |
| Supabase | `brain-platform-pilot` ref `omnwbcdtmtvxasgdmvwr`, "ERSG Prototypes" org (**personal-owned despite the name**), eu-west-2, Pro; PITR off | New ERS org + project; 6 migrations in order (including durable OAuth state, tombstones, and the private revision-FTS index); `brain_runtime` login on transaction pooler `:6543`; bucket `brain-artifacts`; security re-gate | ~1–2 d |
| OAuth / IdP | GitHub OAuth app (presumed JEM-Fizbit-owned — unrecorded), HS256 JWT, DCR, postgres oauth_state; `GITHUB_ALLOWED_*` fallback **actively set** | New GitHub OAuth app under ERS-Genomics; fresh signing secret; empty oauth_state; **no** `GITHUB_ALLOWED_*`; full connector re-enrollment (hostname ⇒ new `iss`/`aud`, nothing carries over) | ~1 d |
| Slack alerting | claude-jembot (**ERS-scoped**, workspace `T01SDRYJMM1`) token in **personal** Fly secrets; channel/DM are hardcoded code defaults | Token rotated → ERS app only, channel/DM set explicitly; personal stack sheds the token (reverse dependency resolved both directions) | ~0.5–1 d |
| Registry/config | Image-baked `config/brain-platform.john-ers-pilot.json`; `default_brain_id: ai-brain-jem`; sole principal JEM-Fizbit `220941196` owner of both brains | New `config/brain-platform.ers.json` (ERS-mirror-only, repo is public): `default_brain_id: ers-brain`, ERS principals pinned by numeric id | ~1–2 d |
| Local ops (John's Mac) | Brain Monitor runs a JEM + an ERS profile today, but **both share one `.env.local`** → the ERS profile syncs SharePoint↔**personal** Postgres, and its doctor health-checks the personal stack (hardcoded app/base URL) | Per-profile env passthrough (or second checkout); ERS profile re-pointed at ERS DB/host with fresh sync state | ~1.5–2 d |
| Data | Audit 2026-07-12: 44 md files (+1 tombstoned head), 309 revisions, 128 sources (125 real + 3 drift), 57 texts, 128 storage objects, 243 latency events, 0 chunks. After the 2026-07-17 spec 013 migration: 50 md files, zero conflicts, and exact SharePoint/hosted convergence | Re-seed the current SharePoint mirror (D1); fresh history; pilot rows verifiably purged after soak | ~1.5–2 d |
| Release/custody | Annotated release tags and guarded deploy provenance are active upstream; `v1.4.1` contains the deployed structural runtime; `v1.4.2` was the first imported mirror tag; `v1.4.3` adds tenant-neutral single-Brain profile tests and overlay-aware guarded provenance; `v1.4.4` adds the Brain-vault namespace guard and conflict idempotency; `v1.4.5` adds the parity-gated local state-rebase procedure | Private ERS-Genomics mirror + overlay, tracking reviewed upstream tags only | ~2–3 d |
| Monitoring | One alert path (auth failures → Slack), inside the monitored process; doctor 100% laptop-bound; no external uptime check; backups never rehearsed | External `/health` monitor, off-laptop scheduled doctor, sync heartbeat, backup-restore cadence | ~2–4 d |
| Billing | Personal Fly + Supabase | ERS cards on both; baseline **~$31/mo** (~$6 Fly + $25 Supabase Pro); PITR-7d would be +$100/mo (defer recommended — §9) | ~0.5 d admin |

## Technical constraints (found by the audit; the spec is built around these)

1. **Hostname is a one-way door.** `MCP_OAUTH_PUBLIC_BASE` bakes into JWT `iss`/`aud`, the GitHub OAuth callback, and every connector enrollment. Changing it later invalidates all tokens and forces org-wide re-enrollment. The hostname decision (§9) must precede GitHub-OAuth-app creation and first enrollment.
2. **The registry is the access model and it ships inside the image.** `Dockerfile` `COPY config ./config` + `scripts/fly-entrypoint.sh` hardcoded `DEFAULT_REGISTRY` mean an unmodified image carries John's registry (JEM-Fizbit `220941196` as owner of `ers-brain`) as a silent boot fallback — the single riskiest mechanism found. Conversely, an ERS registry committed upstream would publish ERS staff numeric GitHub ids (repo is public). Hence: registry lives only in the **private** mirror; upstream entrypoint gets a fail-fast (§1).
3. **`GITHUB_ALLOWED_LOGINS`/`GITHUB_ALLOWED_EMAILS` is an env-plane side door** (`src/services/registry.ts:246-257`): grants **owner on `default_brain_id`** to mutable logins/emails, bypassing numeric-id pinning. On ERS, `default_brain_id` = the shared company brain. D1 mandates absence; today absence is the only enforcement, and nothing asserts it. (The personal app currently has both set.)
4. **DB URL must be the transaction pooler (`:6543`)**, username `brain_runtime_user.<project-ref>` — the session pooler re-triggers the documented `EMAXCONNSESSION` outage.
5. **Hosted tool surface is 21/25.** `brain_ingest`, `brain_ingest_complete`, `brain_semantic_index`, `brain_semantic_search` hard-error on postgres brains; `brain_scan_inbox` degrades gracefully; `brain_commit` is a documented no-op. Day-2 source ingestion is the operator-shell pipeline (inventory → upload → extract-text → verify), currently runnable by exactly one person on one Mac.
6. **The `brain_list_sources`/ingest category enum is JEM-shaped** (14 personal categories; zero overlap with ERS's `brand/ceo/company/examples/legal/projects/templates`) — ERS category filtering Zod-rejects until relaxed.
7. **`test/deploy-config.test.mjs` pins personal values** (registry path, brain ids, JEM-Fizbit principal) — the mirror cannot pass `npm test` without upstream parameterization, which would otherwise force exactly the test-code divergence D2 forbids.
8. **Storage objects are not in any DB backup tier**; `pg_dump` covers Postgres only. The SharePoint `sources/` tree holds every original byte.
9. **OAuth state is not brain-scoped** — ERS and personal connector registrations are mixed in one `brain.oauth_state`; the purge predicate needs client-metadata review (§6).

## 1. Preconditions — upstream hardening (code changes in this repo, before the fork)

All land upstream so both stacks inherit them; the mirror then needs zero source edits. **P0 (blocking the fork):**

1. **Entrypoint/registry fail-fast:** remove the `DEFAULT_REGISTRY` auto-copy personal fallback from `scripts/fly-entrypoint.sh`; require `BRAIN_PLATFORM_CONFIG` to resolve to an existing file in HTTP mode or refuse to boot. Decide whether `Dockerfile` narrows `COPY config` (surfaced in §9; fail-fast alone removes the silent-fallback hazard).
2. **Parameterize `test/deploy-config.test.mjs`:** derive the registry path from `fly.toml`'s `BRAIN_PLATFORM_CONFIG`; keep universal invariants inline (version 1, `default_brain_id ∈ brains`, postgres backends, ≥1 numeric-id principal owning the default brain, no-secrets regex); move identity constants to a `test/deploy-expectations.json` profile the mirror overlay replaces. **Add a universal assertion that `GITHUB_ALLOWED_*` never appears in `fly.toml`.** Make the pilot-seed test profile-aware/skip-if-absent.
3. **Slack alert targets required-when-enabled:** delete the hardcoded ERS channel/DM defaults (`src/services/auth-alert.ts:194-195`); when `BRAIN_SLACK_BOT_TOKEN` is set, `BRAIN_SLACK_ALERT_CHANNEL`/`BRAIN_SLACK_ALERT_DM` are required (else alerting stays a no-op). Set the two vars explicitly on the personal app in the same change (it currently relies on the defaults).
4. **Fail-fast `BRAIN_ID` in HTTP mode:** replace the `|| "ai-brain-jem"` fallbacks on the hosted paths (`registry.ts:86`, `active-brain-store.ts:75`, `auth-alert.ts:197`, `auth-telemetry.ts:119`; keep a documented default for local stdio only).
5. **Ops tooling parameterization:** `BRAIN_FLY_APP` env for the hardcoded `flyctl status --app jem-brain-mcp` in `scripts/hosted-doctor.mjs`; strip the personal-project `BRAIN_SUPABASE_URL` default from `scripts/upload-source-artifacts-postgres.mjs` + `run-source-upload-interactive.sh` (a mis-enved ERS upload currently targets the personal project) and the `/Users/johnemilad/...` `BRAIN_REPO_ROOT` defaults from the source-pipeline scripts — make them required.
6. **Tagging + guarded deploy (implements D2's release contract):** annotated tag `v1.2.0` (anchor commit surfaced in §9), rule "every version-bump commit is tagged immediately"; `repository` field in package.json; a deploy script that refuses unless tree-clean + HEAD==tag + tests green, passes `GIT_SHA`/version as OCI labels, and records app/tag/sha/date. Optional per-tag GitHub Release with a migrations/env-contract/security-diff checklist (this is the ERS review artifact).
7. **Category enum relax:** `sourceCategoryEnum` + `ListSourcesSchema.category` → `z.string()` minimal fix (registry-driven per-brain lists is a later design item).

**P1 (ship with the fork, not gating):** OAuth metadata doc URLs env-driven (currently hardcode the personal repo URL into public discovery metadata); menubar installer per-profile env passthrough (§4.5 — or accept the two-checkout workaround); S1-guard/inbox error text rewritten so hosted users aren't advised into a local-stdio fallback that bypasses the revision store; sync heartbeat event (§7). **Decision, not default (§9):** hard-disabling the `GITHUB_ALLOWED_*` code path (e.g. refuse to boot in HTTP mode when set) vs env-absence discipline.

**Execution status (2026-07-18):** P0 and P1 completed upstream with test-first coverage at `v1.2.0`. The generic spec 013 server and Brain-structure content baseline shipped at `v1.4.1`; `v1.4.2` reconciled the fork runbook, complete migration manifest, structural data baseline, and regression coverage and became the first private-mirror import. The first real overlay preflight then exposed two generic release-contract gaps: the deployment test still named both pilot Brains, and the exact-tag deploy guard could not attest a committed overlay. `v1.4.3` fixed both upstream without changing `src/`, `db/`, the runtime image, or the resolved topology. The 2026-07-18 beta incident then proved that ordinary Brain writes also needed a reserved external-namespace guard and that repeated identical conflicts needed an idempotency boundary; `v1.4.4` fixes both without schema change. Deployed `v1.4.5` closes the related local-state maintenance gap with a parity-gated, backup-first rebase command and is the required base for the first private overlay.

Verification: `npm test` (logic changes) + `npm run build`; each change follows normal spec-less commit discipline (mechanical, intent in commit messages, this spec is the record).

## 2. Fork mechanics — repo custody + upstream relationship

Resolves the D2 ("one upstream repo, optional mirror") vs 2026-07-10 destination-state ("fork in the ERS-Genomics org, not a deployment pulling from John's personal repo") wording conflict. Both are satisfiable by exactly one model:

1. **Upstream:** `JEM-Fizbit/brain-mcp-server` (public, MIT, John's). All development happens here, only here. Releases are annotated tags.
2. **ERS repo:** **private** `ERS-Genomics/brain-mcp-server` — a mirror that tracks **upstream tags only** (never `main` HEAD), plus an ERS overlay applied on top of each tag containing ONLY: `config/brain-platform.ers.json` (staff numeric GitHub ids — the reason the repo must be private), the ERS `fly.toml`, `test/deploy-expectations.json`, the ERS deploy/ops runbook, and (optionally later) a tag-triggered test CI. **Zero `src/` divergence** — enforced per release by `git diff <tag>..<overlay> -- src/ db/ scripts/` being empty apart from nothing (overlay touches config/test-profile/docs only).
3. **ERS redeploy trigger:** a new upstream tag, never a branch head. Per-tag flow: John cuts + reviews the tag upstream → ERS operator reviews `git diff vOld..vNew` scoped to `src/oauth/`, `src/http/`, `src/services/registry.ts`, `Dockerfile`, `scripts/fly-entrypoint.sh`, `db/migrations/` → **any new migration is applied to the ERS Supabase (+ advisors re-check) before `fly deploy`** → overlay rebased onto the tag → `npm test` with the ERS profile → provenance-recording deploy. Until a second ERS admin exists, John reviews under both hats (flagged in §9).
4. **Entra ID path (sized, not built):** structurally a second `github.ts`-equivalent provider module (`src/oauth/entra.ts`: authorize redirect to the ERS tenant, callback resolving `oid` as `provider_user_id` with `provider: "entra"`, cert client-assertion config, route wiring). JWT claims and `principalMatches` are already provider-generic; switching IdP later means full re-enrollment + principal remap (`github:<id>` → `entra:<oid>`). ~1–2 days when scheduled; the ms-graph-mcp Entra app proves the ERS tenant registration path.
5. **DECISIONS entry at approval:** append a new entry locking this model and amending the D2 wording; update OWNERSHIP_AND_LIFECYCLE prerequisite 1 and BACKLOG phrasing to match ("private ERS-org mirror tracking upstream tags + config overlay").

## 3. Stand-up sequence (M1 — build the ERS stack, ~1.5 days)

Ask-first applies to every step; all are ERS-infra-mutating. Ordered; 1–3 are Gate-0-blocked (§9).

1. **ERS Fly org** (none exists — confirmed live): new org, ERS billing card, ERS admin. `fly apps create ers-brain-mcp --org <ers-org>` (name = suggestion; region `lhr` unless Gate 0 moves it).
2. **ERS Supabase org + project** (Pro — hard floor: Free has no backups), region matched to Fly. Record the new ref.
3. **GitHub OAuth app under ERS-Genomics** — *after* the hostname decision: homepage + callback `https://<ers-host>/authorize/github/callback`, scopes `read:user user:email`.
4. **Migrations, in file order (all six, verified tenant-neutral):** `2026-06-14_001_hosted_brain_postgres.sql` → `2026-06-14_002_harden_hosted_brain_advisors.sql` → `2026-06-14_003_brain_runtime_role.sql` → `2026-06-22_001_durable_oauth_state.sql` → `2026-07-08_001_brain_file_tombstones.sql` → `2026-07-17_001_brain_revision_fts.sql`. Advisors after each and the full security gate after the sequence. Migration 001 auto-creates the private `brain-artifacts` bucket — verify `public=false`, zero object policies. The FTS migration adds a private tombstone-filtered GIN index and no grants.
5. **Credentials:** create the `brain_runtime`-member LOGIN role outside migrations; build `BRAIN_REVISION_DATABASE_URL` on `:6543` with `brain_runtime_user.<new-ref>`; capture `BRAIN_SUPABASE_URL`; hold the service-role key in the ERS secret store for operator-shell ingestion only — never a Fly secret while runtime stays `metadata_only`.
6. **ERS registry** (`config/brain-platform.ers.json`, mirror-only): `default_brain_id: "ers-brain"`, single brain `ers-brain` (production metadata — drop `john-only-pilot`, set real `access_policy`/`team_access`), principals = John's ERS identity pinned by numeric `provider_user_id` (identity choice is Gate 0; ids on file: `jemilad-ers` = **259372947** — fetched 2026-07-12 — vs `JEM-Fizbit` = 220941196). Recommend omitting `login`/`email` from principal records so matching is numeric-id-only.

   Carry the validated `lint.graph_roots` and rotated-history `exempt_globs`. Any `BRAIN_LINT_MODE_OVERRIDES` value must contain only registry-known ids; the ERS-only deployment must never copy the pilot's `ai-brain-jem` override because startup rejects unknown ids.
7. **ERS-production seed** derived from `db/seeds/2026-06-24_001_bootstrap_ers_brain_pilot.sql` with rewritten metadata (required — every data table FKs `brain.brains(id)`). The JEM pilot seed **never** runs on the ERS project.
8. **Fly config + secrets:** ERS `fly.toml` deltas — app name, `MCP_OAUTH_PUBLIC_BASE`, `BRAIN_ID=ers-brain`, `BRAIN_PLATFORM_CONFIG` → ERS registry, ERS timezone, drop the vestigial `BRAIN_PLATFORM_STATE_ROOT=/data/state`; explicit `BRAIN_SLACK_ALERT_CHANNEL`/`_DM` if alerting is on. Secrets minted fresh: `MCP_OAUTH_SIGNING_SECRET`, `GITHUB_OAUTH_CLIENT_ID/SECRET`, `BRAIN_REVISION_DATABASE_URL`, `BRAIN_SUPABASE_URL`, optional rotated `BRAIN_SLACK_BOT_TOKEN`. Deliberately absent: `GITHUB_ALLOWED_*`, `GITHUB_OAUTH_MOCK_*`, `BRAIN_SUPABASE_SERVICE_ROLE_KEY`.
9. **Deploy + empty-stack smoke:** guarded deploy at the pinned tag; `/health` field assertions; RFC 9728/8414 metadata + 401 + DCR probes (all three callback classes); `smoke:hosted:oauth` read-only; `smoke:brain-runtime-role` with `BRAIN_ID=ers-brain`; verify the revision-FTS index exists and no public grants were added. After the content seed, add one ranked-search assertion and the structural-file role checks to the acceptance evidence.
10. **Register every asset** in `ers-registry/ers-assets.md` as created (§8), keys recoverable via ERS custody, not John's personal accounts as sole path.

## 4. Data cutover (M2, ~1 day; write-freeze ≤ half day)

Source of truth for content: the SharePoint Markdown mirror (current — verified matching hosted live heads at audit). **Revision history does not move** (locked, D1): the 309 pilot revisions survive only in the pre-cutover archive; `LOG.md` carries human-readable history forward inside the content.

1. **Pre-flight checkpoint (personal pilot):** archived `pg_dump` (needs a Postgres-17-compatible dump path or Docker — currently uninstalled, see risks) + Markdown/git export checkpoint per `docs/hosted-brain-recovery-and-git-export.md`; `hosted:doctor` must show 0 open conflicts. Storage objects are excluded from the dump — the SharePoint `sources/` tree is proposed as the artifact archive (sign-off in §9).
2. **Write freeze** on `ers-brain` (self-discipline; John is the only writer). Stop the ERS sync watcher; archive its `state.json` (both the Application Support copy and the checkout's `.brain-sync/`).
3. **Markdown re-seed:** `BRAIN_ID=ers-brain BRAIN_DIR="<SharePoint>/01_ers-brain/brain" npm run sync:seed:all-markdown:postgres` against the ERS DB with a **fresh** state file. The current structural baseline is 50 Markdown files; re-measure immediately before seeding and treat the live SharePoint count as authoritative.
4. **Sources re-seed:** `sources:inventory:postgres` → `sources:upload:postgres` (operator shell, `BRAIN_ARTIFACT_BYTE_ACCESS=admin` + ERS service-role key) → `sources:extract-text:postgres` → `sources:verify-list:postgres`, all with `BRAIN_REPO_ROOT=<SharePoint checkout>` and `BRAIN_EXPECTED_SOURCE_COUNT=125` — **not** the pilot's 128; the 3 `working/*` rows are path-drift duplicating vault files and must not be re-created.
5. **Parity verification:** `verify-core-postgres` counts; one bounded sync cycle; bidirectional parity (`--write --verify-local`, `--local-write --verify-hosted`).
6. **Restore rehearsal on the ERS project** (folded in per the locked decision): restore the ERS project's own backup to a scratch project, verify counts, time it, record in the new gate doc.
7. **Local sync re-point:** ERS Brain Monitor profile gets ERS `BRAIN_REVISION_DATABASE_URL` + `BRAIN_HOSTED_BASE_URL` + `BRAIN_FLY_APP` via per-profile env passthrough (P1 change) or a second checkout with its own `.env.local` (zero-code fallback); regenerate/reinstall the Monitor app (config is baked at install; FDA re-grant if renamed); re-pin node to a stable `node@22` path. **Flip is atomic with §5** — while `ers-brain` rows exist in both DBs, exactly one store is authoritative at any moment; the watcher and the connectors move together.

## 5. Client cutover (M3a, ~0.5–1 day + 2–3 day soak)

New hostname ⇒ new `iss`/`aud` ⇒ every surface enrolls fresh; nothing carries over. Reuse [hosted-client-cutover.md](../hosted-client-cutover.md) per-surface procedures with the ERS URL; documented order: ChatGPT-family first, Codex last, fresh sessions for tool discovery.

| Surface | Action |
|---|---|
| ChatGPT Business (ERS workspace) | Full **delete + recreate** of the workspace app (reconnect does not work), then the per-user connection step |
| Claude ERS Teams account | New user-scope custom connector (suggest name `brain-ers`); org-level Teams-admin connector deferred to team rollout (new admin-console asset — register it then) |
| Claude Code CLI/Desktop | New `~/.claude.json` HTTP entry `brain-ers`; loopback flow — test first, most likely to expose redirect bugs |
| Codex CLI | New `[mcp_servers.brain-ers]` + `codex mcp login` + one Always-allow approval |
| Personal surfaces | Untouched — stay on `jem-brain-mcp` |

Post-enrollment: run the REMOTE_MCP_SERVICE_PATTERN test matrix against the ERS endpoint; one read + one narrow write per surface; then **soak 2–3 days** with the ERS stack authoritative before §6 runs. John operates both connectors permanently (`brain` personal + `brain-ers`) — the two-connector shape is the destination state, not a transition artifact.

## 6. Personal-stack separation (M3b) — the "pristine" guarantees

Two directions, both required by exit portability. **This is the point of no return — gated on §5 soak + §4.6 rehearsal + an explicit purge sign-off (register item 10: CEO, on the verification evidence).** "Never delete data as a fix" discipline: the purge is not a fix, it is the governance boundary — and it runs only after the archived dump has been restore-verified.

**(a) ERS data off the personal stack (verified purge):**
1. Registry shrink first: remove `ers-brain` + the role grant from the personal registry, redeploy `jem-brain-mcp` → hosted surface stops resolving `ers-brain`.
2. `delete from brain.brains where id='ers-brain'` — cascades to revisions (309), heads (45), sources (128) → artifacts → extracted text, conflicts (6), sync_events (243).
3. Storage prefix delete: all objects under `brains/ers-brain/` in `brain-artifacts` (not cascaded — Storage API pass; ~70 objects should remain).
4. OAuth rows: identify ERS-surface client registrations among the 9 `oauth_state.clients` rows (+ their refresh tokens, 305 total — prune accumulation in the same pass). Rows are not brain-tagged; **the deletion predicate must be written from client metadata review before cutover day** (open item, §9). Residual ERS auth telemetry keyed under the default brain is deleted via the `clientId` join to the removed clients.
5. Verification queries (record output in the cutover log): per-table `count(*) where brain_id='ers-brain'` = 0; storage prefix count = 0; `brain_list_brains` → one brain; `brain_describe(ers-brain)` → not found; personal connectors still authenticate; `hosted:doctor` green.

**(b) ERS dependencies off the personal stack (reverse direction):**
1. **Rotate the claude-jembot token** at fork time; install the new token only on the ERS app; `fly secrets unset BRAIN_SLACK_BOT_TOKEN -a jem-brain-mcp` (post-rotation this is cleanup — rotation is what actually kills the personal copy). Personal alerting becomes a designed no-op unless John later wires a personal-workspace bot (his call, recorded in §9).
2. Confirm jembot app custody sits with ERS (creator/collaborator review) — credential boundary follows ownership boundary.
3. Personal-hygiene flag (same window, John's stack, his call): the personal app itself still runs the `GITHUB_ALLOWED_*` side door — recommend replacing with an explicit registry principal and unsetting both secrets.

**Residual single-operator dependencies that survive the fork (flag, don't block):** the ERS sync daemon + canonical SharePoint checkout live on John's personal laptop; John's identity is initially the sole ERS admin. Mitigations: **second admin / break-glass = Cillian McGorman (named 2026-07-13**, provisioned at stand-up: Supabase org, Fly account, GitHub OAuth app**)**, and optionally a second sync-runner machine (no code obstacle found; macOS-specific OneDrive + FDA requirements apply).

## 7. Security re-gate + monitoring

**Security gate (re-run on the ERS project, new dated gate doc):** all Verification Queries from the gate doc; `smoke:brain-runtime-role` with `BRAIN_ID=ers-brain`; advisors clean after every migration; bucket private with zero object policies; no `GITHUB_ALLOWED_*`/mock env present (now test-asserted); privileged credentials never in chat/docs/commits; service-role key custody named. Plus the **cross-tenant isolation test** (BACKLOG item) before any second principal: unregistered identity → 403 at callback; scoped principal denied outside its brain.

**Monitoring the personal stack never had (ERS needs day one):** the only alert path today lives inside the monitored process and every doctor invocation is laptop-bound — when John's Mac sleeps, monitoring sleeps.
1. External uptime monitor on `/health` (assert body fields, not just 200), ERS-owned account, notifying an ERS channel — non-negotiable; in-process alerting cannot report its own death.
2. Scheduled off-laptop doctor: reduced profile (skip laptop-only checks — needs a skip flag) via GitHub Actions in the ERS mirror or a Fly cron machine (creds placement decides — §9).
3. Sync-staleness observability: small code change — per-cycle heartbeat row to `brain.sync_events` (metadata-only, telemetry rules apply) so "laptop asleep" is distinguishable from "no edits"; scheduled doctor alerts past threshold.
4. Backup posture: daily backups verified on the ERS project; restore rehearsal cadence (quarterly proposed); Storage-object export policy for `brain-artifacts` (SharePoint `sources/` is the proposed archive); PITR decision in §9.
5. Day-2 content-ops runbook (new doc in the mirror): the 5-step source pipeline with an explicit ERS env table, operator prerequisites (macOS + SharePoint mirror + repo build + poppler + service-role key), and the named bus-factor answer (§9).

## 8. Asset-register re-homing & doc updates

On ship (same change window as §6):
- **ers-registry/ers-assets.md:** new rows — ERS Fly org+app, ERS Supabase org+project, ERS-Genomics GitHub OAuth app, private mirror repo, uptime-monitor account, (if enabled) rotated jembot token usage; update row #3 (Brain MCP) from "personal-owned, beta" to ERS-owned service with its own stack; record billing owners + plan tiers (~$31/mo baseline).
- **jem-registry/personal-assets.md:** Fly row A12 + Table B brain-mcp-server row — drop the dual-registration/ERS-beta language, note the fork date, remove the jembot-token dependency note.
- **Docs:** OWNERSHIP_AND_LIFECYCLE ownership table + destination-state wording (D2 reconciliation); new DECISIONS entry; ERS variants of deploy/cutover/recovery runbooks live in the mirror; personal docs keep personal values.
- **BACKLOG.md:** delete the fork line (this spec's archive is the record); the cross-tenant-test line closes with §7; the IP/licensing line stays (separate work).

## 9. Decision register — resolved

**The three headline decisions (John + ERS governance):**

1. **Fork timing — fork now vs mitigated personal-stack beta.** For *now*: exit-hygiene debt compounds (every week adds ERS content/telemetry/OAuth rows to purge and deepens beta habits); the audit finds no technical blocker, ~2–4 operator days + ~1–2 weeks of prep/hardening; your own 2026-07-10 note records "prefer forking sooner." For *deferring*: Gate-0 governance (owners, billing, DPA, sign-offs) has real lead time; the mitigations in §1 + §6(b) can land pre-fork and cap the personal-stack contamination in the meantime; no second user is imminent until M4 hardening exists anyway. **Direction set (John, 2026-07-12): fork sooner — exit hygiene. Reframed 2026-07-13: the migration is UNGATED** — it is itself the risk reduction (moves ERS data off personal infra), so the ELT memo records decisions rather than requesting approval, and **the ELT decision point moves to rollout beyond the John+Cillian pilot** (register item 14: evidence package = vendor DPA reviews, isolation-test results, pilot experience, onboarding guide, proposed access model).
2. **ERS governance sign-off package** — now tracked transparently in a dedicated register: **`governance/brain-mcp-fork-signoff.md` in the ERS Brain** (created 2026-07-12; sign-off = John + ELT). Contents (who signs, and when): named ERS account owners + billing cards for Fly org / Supabase org / GitHub OAuth app; no-read-audit posture (A2-10); vendor DPA review (Fly + Supabase — never reviewed); content governance (recommend reader-majority, writers = John + 1–2 curators until concurrency hardening); data-residency/region confirmation; PITR; licence-acknowledgment adoption (GC-reviewed, then approved and recorded by ELT as a Decision Log entry — no signature; John, 2026-07-13); purge sign-off (§6 is irreversible).
3. **Where the "real ERS colleague on ers-brain" test runs — on the fork** (the audit corroborates: the prior review's success criteria place first-colleague onboarding on the ERS stack after P1 hardening; the pilot posture "must end before a single colleague is onboarded"). **Resolved 2026-07-13 (John): Cillian McGorman is the first colleague (second user) AND takes emergency access / second-admin (break-glass)** — closing register items 12+13 and the §6 residual second-admin flag, subject to the ELT memo's objection window. M4's gates (cross-tenant test, onboarding guide, vendor DPA review) still hold for him.

**Gate-0 technical decisions — ALL RESOLVED (John, 2026-07-12, one-by-one walkthrough):**

| # | Decision | Blocks | Resolution (John, 2026-07-12) |
|---|---|---|---|
| 4 | John's ERS registry identity + role | §3.6 | **`jemilad-ers` (259372947), owner.** Switch is free — the re-seed restarts attribution history. Pre-flight: verify the ERS-Genomics third-party OAuth-app policy |
| 5 | Hostname — **one-way door** | §3.3, §5 | **Custom ERS domain**; working name `brain.ersgenomics.online` (matches the `slack.`/`m365-graph.` estate); exact label confirmed at CNAME creation, before the OAuth app exists. Side effect: the Fly app name becomes internal-only |
| 6 | Fly org shape + provider acceptance | §3.1 | **Separate ERS Fly account** under `john.milad@ersgenomics.com` (ERS card; second admin added when named); same shape for the ERS Supabase org. ELT still to bless Fly as a second provider (register item 3) |
| 7 | PITR | §3.2 | **Defer** (baseline ~$31/mo). Revisit trigger: colleagues writing hosted-first without local mirrors |
| 8 | `GITHUB_ALLOWED_*` enforcement | §1 | **Hard gate in code**: refuse to boot in HTTP mode when set unless an explicit opt-in flag is present (personal deploy sets the flag); plus the fly.toml absence test |
| 9 | Registry authority | §2, §3.6 | **Image-baked JSON for v1** (access changes = auditable commit + redeploy); revisit at team rollout — the dormant Postgres principals tables are the upgrade path |
| 10 | Deploy pipeline | §2.3 | **Operator-local + guarded deploy script**; tag-triggered test-only CI is a cheap later add; deploy rights beyond John = second-admin item |
| 11 | Slack alerting day one | §3.8 | **On at cutover**: rotated jembot token + explicit channel/DM (deploy tokenless first, add once `/health` is green). Follow-on in BACKLOG: migrate to an ERS-owned Slack app |
| 12 | Day-2 ingest bus factor | §7.5 | **Accept single-operator at launch** (documented in runbook + register); **fast follower**: automated Graph-API ingestion — candidate: build on the ms-graph-mcp Entra app (new consent tranche for SharePoint/Files read) + Fly cron runner. BACKLOG item captured |
| 13 | Tag anchor | §1.6 | **`v1.2.0` at HEAD** when the §1 work starts; backfill optional |
| 14 | Scheduled-doctor credential placement | §7.2 | **Fly cron machine in the ERS org** — credentials never leave the provider that already holds them |
| 15 | Personal-stack alerting replacement | §6(b) | **None** — local doctor/menu-bar only; zero Slack dependencies on the personal stack. Reversible any time |
| 16 | Region pair + timezone | §3 | **lhr + eu-west-2, `BRAIN_DATE_TIME_ZONE=Europe/Dublin`** — subject only to the DPA/residency review (register item 6/7) not objecting |

## 10. Cutover checklist (condensed operator runbook)

```
GATE 0  ☑ technical decisions 4–16 resolved (John, 2026-07-12 — §9 table)
        ☑ identity: jemilad-ers (259372947), owner   ☑ hostname: custom ERS domain (label at CNAME time)
        ☑ 2026-07-13: migration UNGATED (ELT memo = record; ELT comments due 22 Jul feed the
          rollout gate, not the migration); pilot = John + Cillian
          (Cillian also second admin); the standing ELT gate = rollout beyond the pilot
          (register item 14 — ers-brain governance/brain-mcp-fork-signoff.md)
        □ purge predicate for OAuth rows written  ☑ MCP stateless-spec release date verified (see risks)
PREP    ☑ §1 P0+P1 upstream changes merged  ☑ structural release deployed  ☑ v1.4.2 imported  ☑ v1.4.5 corrective baseline tagged
        ☑ npm test green  ☑ private ERS-Genomics repo under custody  □ import v1.4.5 + add overlay (registry, fly.toml, expectations, runbook)
M1      □ Fly org+app  □ Supabase org+project  □ 6 migrations + advisors/security gate  □ brain_runtime login (:6543)
        □ bucket private  □ GitHub OAuth app  □ secrets set (no GITHUB_ALLOWED_*)  □ ERS seed row
        □ deploy @tag  □ /health + OAuth/DCR + runtime-role smokes  □ assets registered
M2      □ pilot pg_dump + export checkpoint (restore-verified)  □ doctor: 0 conflicts  □ write freeze
        □ md re-seed (fresh state)  □ sources re-seed (EXPECTED=125)  □ parity both directions
        □ restore rehearsal on ERS project (timed)  □ local sync re-pointed (atomic with M3a)
M3a     □ enroll: ChatGPT Business → Claude Teams → Claude Code → Codex  □ test matrix per surface
        □ soak 2–3 days (ERS authoritative)  □ external uptime monitor + scheduled doctor live
M3b     □ purge sign-off  □ registry shrink + personal redeploy  □ cascade delete + storage prefix delete
        □ OAuth/telemetry row purge per predicate  □ verification queries logged (all zero)
        □ jembot token rotated → ERS only; unset on jem-brain-mcp  □ personal doctor green
SHIP    □ security gate doc (ERS)  □ registers re-homed  □ OWNERSHIP/DECISIONS/BACKLOG updated
        □ spec 012 → archive with shipped commit
```

## 11. Rollback

- **Before M3b (purge):** rollback is trivial by design — the personal pilot stays live and untouched through M1–M3a. Abort = re-point connectors back per the cutover doc's rollback section, restore the ERS sync profile to the pilot DB URL + archived `state.json`, tear down or park the ERS stack. No data was moved, only copied.
- **After M3b:** the pilot's `ers-brain` rows are gone by intent. Recovery lanes: the archived restore-verified `pg_dump` (history), and the SharePoint mirror (content — reseedable to any stack via the same scripts). This is why M3b is gated on the soak, the rehearsal, and an explicit sign-off.
- **Per-surface rollback** (a single failing connector, a bad deploy) follows the existing runbooks: hosted-client-cutover rollback steps; Fly `releases`/redeploy at the previous tag (provenance from §1.6 makes "previous tag" answerable).

## 12. Risks

1. **MCP stateless-spec release expected 2026-07-28 — verified 2026-07-16.** The [official draft changelog](https://modelcontextprotocol.io/specification/draft/changelog) confirms the sessionless/stateless changes; the [official TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) says the full spec and stable SDK v2 are expected on 28 July 2026. This is not a same-day production cutoff: SDK v1.x remains the supported production line until then and is promised fixes/security updates for at least six months after v2 ships. Complete the ERS fork on the current supported v1 line; schedule the v2/CIMD migration as a separate post-fork work unit.
2. **Counts drift** — hosted file counts moved 40→41→44 and then 50 after the structural migration; the spec deliberately parameterizes on cutover-day measurement, never doc constants.
3. **`pg_dump` tooling gap** — no Postgres-17-compatible dump path installed; unblock (or Docker) before M2. The restore rehearsal has never been executed on any stack; it is a go-live blocker here by design.
4. **Supabase MCP connector is single-org** — cutover ops need a connector/PAT scoped to the ERS org (and the pilot org for the purge); the PAT-based local MCP BACKLOG item would retire the re-auth dance.
5. **Effort figures are judgment, not measurement** (flagged in the prior review); nothing dynamic (restore, load, the migration itself) has been executed yet.
6. **Single-operator residuals** (§6) — accepted at fork, must not silently become permanent; the second-admin/break-glass item needs an owner and a date.
7. **Public upstream repo** — nothing ERS-identifying may ever be committed upstream (registry, staff ids, ERS runbooks with internal URLs); the mirror is the only home for those. John's own numeric GitHub id remaining world-readable upstream is his accepted status quo.
8. **Graph-primary beta window through 2026-07-24** — this does not block mirror population, M1 stand-up, or M2 reseeding. Keep the inverse legacy comparison and immediate `graph_shadow` rollback path active through the window; defer only the comparator-cleanup decision until it closes cleanly.

## LOE summary

| Block | Estimate |
|---|---|
| §1 upstream hardening (P0+P1 code, tests, tagging/deploy script) | ~3–5 dev days |
| §2 mirror + overlay + release process | ~1–2 days (overlaps §1) |
| §3 M1 stand-up | ~1.5 days |
| §4 M2 data cutover | ~1 day (freeze ≤ 0.5 day) |
| §5 M3a client cutover | ~0.5–1 day + 2–3 day soak |
| §6 M3b purge + separation | ~0.5–1 day |
| §7 monitoring/day-2 + gate re-run | ~2–4 days (partly parallel) |
| Gate-0 admin (orgs, billing, sign-offs) | ~0.5 day work; **lead time is governance, not labor** |
| **Total to a forked, monitored, separated estate** | **≈ 2 focused weeks** (M4 team-onboarding hardening excluded — separate ~2–3 week track per the platform review) |

**Re-estimated 2026-07-13 (John — agentic coding):** the per-block figures above are conservative solo-dev estimates retained for reference. With Claude Code doing the code-side work, active effort compresses to **~1–2 days**; the elapsed 1–2 weeks is dominated by the ELT objection window (to 24 Jul), the deliberate 2–3-day soak, connector-enrollment choreography across four client surfaces, and governance latency — not engineering.

**Longer-term hosting direction (recorded 2026-07-13, ELT memo §4 + ROADMAP.md):** ERS's ultimate ambition is to self-host these services on ERS-owned on-prem hardware (Mac mini/Studio-class) once that infrastructure exists and a migration is proven not to compromise performance or reliability. The custom-domain decision (§9 #5) makes that later move user-invisible. Launch posture stays Fly + Supabase; echoes the self-hosting room noted in DECISIONS 2026-06-14.

## Test plan

Per-phase verification is embedded above: §3.9 empty-stack smokes, §4.5 parity + §4.6 rehearsal, §5 per-surface matrix, §6 purge queries, §7 gate + cross-tenant 403 test. Upstream code changes (§1): `npm test` + targeted tests for the deploy-expectations profile, `fly.toml` `GITHUB_ALLOWED_*` absence, alert-env requirements, entrypoint fail-fast, and complete in-order migration manifests in both fresh-stack docs.

## Verification commands

- This spec (docs-only): `git diff --check`
- §1 implementation: `npm run build`, `npm test`
- Infra steps: operator-run hard gates per [docs/TOOLING.md](../TOOLING.md) — every hosted/deploy-affecting command is ask-first, never run as routine verification.

## Approved execution assumptions

1. Region pair (lhr/eu-west-2) and hostname (custom ERS domain) are resolved (§9 #5, #16); the Fly app name `ers-brain-mcp` remains a suggestion — with a custom domain fronting it, the app name is internal-only and enrollment-invisible.
2. The SharePoint `sources/` tree is acceptable as the artifact archive (Storage objects excluded from DB dumps) — flagged inside §9 headline decision 2 (the sign-off package).
3. The 3 `working/*` source rows are seed path-drift, not intentional content (evidence: absent from SharePoint `sources/`, duplicate vault files) — excluded from re-seed and gone with the purge.
4. ERS accepts Fly as a second hosting provider (its other MCPs are on Cloudflare Workers; this server is not Workers-portable without rework).
5. John continues operating the ERS plane (sync daemon, ingest pipeline, deploys) from his Mac initially, wearing the ERS hat — with the second-admin item scheduled, not skipped.
6. `brain_load_context` on hosted returns loader+NOW without lint/inbox nudges; ERS colleagues accept this at cutover (nudge parity is a later item).
7. No JEM data, secret, or connector changes anywhere except the explicitly listed personal-stack steps (registry shrink, purge, jembot unset, alert-env explicit-set).
