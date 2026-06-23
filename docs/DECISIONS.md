# Working Decisions Log

> Locked design decisions for this project, with rationale. Append-only — when a decision is reversed, add a new entry referencing the prior one. Do not delete history.

Each entry captures: **what was decided**, **why** (the constraint or insight), **when**, and **what alternatives were rejected**. This is the durable answer to "why did we do it this way?" months from now.

Format: newest entries at the top.

---

## 2026-06-23 — Trust ChatGPT's documented MCP connector OAuth callback path by pattern

**Decision:** Accept ChatGPT MCP app OAuth redirect URIs under `https://chatgpt.com/connector/oauth/<callback-id>` by code, plus the documented legacy `https://chatgpt.com/connector_platform_oauth_redirect` callback. Keep the trust narrow: HTTPS only, exact `chatgpt.com` host, no query or fragment, and a single callback-id path segment. Continue to use `MCP_OAUTH_ALLOWED_REDIRECT_URIS` for other exact non-loopback callbacks.

**Why:** ChatGPT creates connector-specific callback IDs, and the previous exact-secret allowlist caused connector registration failures whenever the callback changed. During the 2026-06-23 ChatGPT re-enrollment failure, hosted Postgres had no ChatGPT dynamic-client record and a live DCR probe returned `invalid_redirect_uri` for the documented ChatGPT callback shape. Trusting only that documented callback class removes the per-app secret churn without broadly opening OAuth redirects.

**Alternatives rejected:** Exact per-ChatGPT-callback Fly secrets (too brittle for connector recreation); broad `https://chatgpt.com/*` trust (unnecessarily wide); moving to CIMD/private-key JWT in this hardening slice (valuable later, but larger than needed to restore DCR).

**Related:** `src/oauth/config.ts`; `test/oauth-register.test.mjs`; `docs/hosted-client-cutover.md`; `docs/deploy-fly.md`; OpenAI Apps SDK authentication docs.

---

## 2026-06-23 — Hosted Brain MCP ownership: personal-owned, ERS beta-shared; fork at cutover

**Decision:** The hosted Brain MCP (this repo + Fly app `jem-brain-mcp` + Supabase `brain-platform-pilot`) is a **personal-owned** asset, currently **shared with ERS for beta hardening** with John as the sole user. It is dual-registered in both the personal and ERS asset registers. At full multi-tenant / multi-Brain ERS cutover a **dedicated ERS MCP is forked** (separate Fly.io instance(s), Supabase migrated to ERS control, all other dependencies audited + migrated); the personal MCP/infra stays personal. The JEM Brain and the `mcp__brain__*` connector are personal; the ERS Brain content is a separate ERS asset. Canonical detail: [`docs/OWNERSHIP_AND_LIFECYCLE.md`](OWNERSHIP_AND_LIFECYCLE.md).

**Why:** The personal/ERS boundary for the shared hosted MCP kept needing re-explanation. Locking it once — with a canonical doc as the source of truth — prevents drift and re-litigation, and sets a clear trigger (multi-user and/or multi-Brain need) for the fork.

**Alternatives rejected:** Treating the hosted MCP as ERS-owned now (it is personal-owned; ERS is only beta-using it). Moving the personal asset to ERS at migration instead of forking (the personal MCP stays personal — the ERS service is a separate forked deployment).

**Related:** `docs/OWNERSHIP_AND_LIFECYCLE.md`; `jem-registry/personal-assets.md`; `ers-registry/ers-assets.md`; `BACKLOG.md` (ERS Brain MCP fork item); `docs/ROADMAP.md`.

---

## 2026-06-23 — Surface hosted auth failures and alert to Slack in real time

**Decision:** Add a `hosted_mcp_auth_failures` doctor check (so the Checks tab and overall status reflect `hosted_mcp_auth` rows) and a real-time, server-side Slack alerter that posts from the Fly app when an auth failure is recorded: `warn` (≥ 3 failures / trailing 60m) to `#claude-ops`, `fail` (≥ 10) to the operator DM with `[Action needed]`, with a per-severity cooldown. Alerting is gated on `BRAIN_SLACK_BOT_TOKEN` and posts via Slack `chat.postMessage` (bot identity), not the slack-claude-jembot MCP connector (unreachable from the Fly runtime).

**Why:** Auth telemetry was written and displayed in the cockpit Operation Log but wired into no health check and no notification path — so a persistent OAuth failure could run for hours while the Checks tab stayed green and the operator was never told (observed 2026-06-23). Real-time server-side delivery catches failures 24/7 regardless of whether the operator's Mac is awake; piggybacking on the existing best-effort/non-blocking auth-telemetry write keeps it off the latency-critical path.

**Alternatives rejected:** Scheduled local doctor poll (misses failures while the Mac sleeps); scheduled cloud routine driving the jembot MCP (most moving parts; the interactively-authed MCP may be absent in headless cron runs). A new metrics DB/daemon — rejected; cooldown/dispatch state reuses `brain.sync_events` via a new `hosted_mcp_auth_alert` event type.

**Related:** `docs/specs/004-hosted-auth-failure-alerting.md`; `src/services/auth-alert.ts`; `src/services/slack.ts`; `scripts/hosted-doctor.mjs`; `docs/hosted-cockpit.md`.

---

## 2026-06-23 — Durable OAuth state migration intentionally invalidates pre-existing connector registrations

**Decision:** Record that the 2026-06-22 `Harden hosted OAuth connector state` deploy (`brain.oauth_state` migration, releases v17/v18) intentionally starts the client-registration store empty, which is a one-time forced re-auth of every connector holding a pre-migration `client_id`. The resulting `invalid_client` spike on the `oauth_token` endpoint is an expected, self-healing consequence as connectors re-register via dynamic client registration — not an incident.

**Why:** The migration moved OAuth client/session state into Postgres so a Fly machine replacement can no longer strand cloud-synced clients. The migration file documents that rationale, but the operational side-effect (existing connectors invalidated → expected `invalid_client` wave) was not recorded anywhere, so the spike read as a fresh fire on 2026-06-23 — compounded by `hosted_mcp_auth` telemetry being introduced in the same deploy, giving the errors no pre-deploy baseline. This entry makes the next such spike immediately attributable.

**Alternatives rejected:** Leaving the consequence implicit in the migration header and commit message (what caused the 2026-06-23 confusion); attempting to migrate/preserve old in-memory registrations (unnecessary — dynamic client registration re-establishes them).

**Related:** `db/migrations/2026-06-22_001_durable_oauth_state.sql`; commit `52324c4`; `src/oauth/postgres-state.ts`; the 2026-06-23 `hosted_mcp_auth` analysis.

---

## 2026-06-17 — Verify hosted Brain on Claude personal and ERS accounts

**Decision:** Treat hosted Brain as activated and verified for both the Claude personal Max account and the Claude ERS account, strictly for John's personal use of `ai-brain-jem`.

**Why:** The personal Max and ERS verifications prove the hosted `/mcp` endpoint, GitHub OAuth flow, and revision-backed Brain tools work from Claude's cloud-synced custom connector path across John's account surfaces. The ERS connector is a user-scope path for John to reach his own JEM Brain from that account; it is not an ERS team rollout or a multi-user tenancy milestone.

**Alternatives rejected:** Keeping Claude ERS grouped with unverified Claude accounts; treating ERS account verification as an org-wide/team deployment; reopening the OpenAI/Codex/ChatGPT cutover decisions.

**Related:** `docs/hosted-client-cutover.md`; `docs/ROADMAP.md`; `https://jem-brain-mcp.fly.dev/mcp`.

---

## 2026-06-16 — Verify hosted Brain across OpenAI accounts before Claude rollout

**Decision:** Treat hosted Brain as deployed and verified for OpenAI surfaces after successful Codex verification plus ChatGPT verification in both ERS and personal OpenAI accounts. The next client rollout target is Claude surfaces for both personal and ERS accounts.

**Why:** Cross-account OpenAI verification proves the hosted `/mcp` endpoint, OAuth registration, and revision-backed `brain_sync_status` path work outside the local Codex-only configuration. Recording this as the handoff point keeps the next phase focused on Claude enrollment and verification rather than re-litigating OpenAI readiness.

**Alternatives rejected:** Waiting for Claude before recording OpenAI cutover success; treating one ChatGPT account as enough account-surface proof; moving immediately to cockpit productization without marking Claude as the next client deployment target.

**Related:** `docs/hosted-client-cutover.md`; `docs/ROADMAP.md`; `https://jem-brain-mcp.fly.dev/mcp`.

---

## 2026-06-16 — Make hosted Brain the default Codex connector

**Decision:** Codex now uses hosted Brain MCP as the default `brain` connector, and the previous local stdio connector is retained as `brain-local` for fallback and local filesystem-heavy work. ChatGPT uses the same hosted `/mcp` endpoint through its server-side connector settings.

**Why:** The hosted MCP path passed scripted and real-client rehearsal, and the user explicitly requested full cutover for OpenAI clients. Keeping the local connector under a fallback name preserves the local-first recovery path without leaving Codex's default Brain tool on filesystem mode.

**Alternatives rejected:** Leaving Codex default on local stdio after promotion; removing the local fallback entirely; trying to edit ChatGPT Electron caches instead of using ChatGPT's connector settings; using separate Brain endpoints for Codex and ChatGPT.

**Related:** `~/.codex/config.toml`; `docs/hosted-client-cutover.md`; `https://jem-brain-mcp.fly.dev/mcp`.

---

## 2026-06-16 — Promote hosted Brain MCP as the normal remote JEM path

**Decision:** Hosted `brain-hosted` is promoted as the normal remote MCP path for `ai-brain-jem`, while local stdio `brain` remains configured for fast local work, source-file handling, and recovery.

**Why:** The hosted test drive passed with hosted/local sync parity, OAuth reuse, conflict lifecycle, latency reporting, zero open conflicts, and a fresh local sync loop. A real hosted client shadow rehearsal then passed, and the post-rehearsal cockpit doctor reported hosted health green, 50 hosted files, 0 open conflicts, and fresh sync health. This satisfies the JEM remote-client promotion gate without weakening the local-first contract.

**Alternatives rejected:** Keeping hosted as a smoke-script-only pilot after a successful real-client rehearsal; removing the local stdio connector; making hosted mandatory for local filesystem-heavy work; waiting for multi-Brain or ERS tenancy before using the JEM remote path.

**Related:** `docs/hosted-client-cutover.md`; `docs/ROADMAP.md`; `npm run hosted:test-drive`; `npm run hosted:cockpit`.

---

## 2026-06-16 — Rehearse hosted MCP as a shadow client connector before promotion

**Decision:** Add hosted Brain MCP to Claude/Codex as a separate `brain-hosted` connector for real-client rehearsal before making it the normal remote JEM path, while preserving the local stdio `brain` connector as the default local fallback.

**Why:** The hosted test drive now verifies the server, OAuth smoke, sync parity, conflict lifecycle, and latency, but the final cutover risk is client enrollment and day-to-day ergonomics. A shadow connector lets a real client prove OAuth, reads, writes, cockpit visibility, and local mirror catch-up without removing the trusted local path.

**Alternatives rejected:** Replacing the local `brain` connector immediately after a passing scripted rehearsal; requiring every local Claude/Codex session to use hosted MCP before a real shadow session; leaving hosted usable only through bespoke smoke scripts; removing the local fallback during the JEM pilot.

**Related:** `docs/hosted-client-cutover.md`; `docs/ROADMAP.md`; `docs/deploy-fly.md`; `npm run hosted:test-drive`; `npm run hosted:doctor`.

---

## 2026-06-16 — Automate Brain maintenance and proactively surface required user action

**Decision:** Brain MCP maintenance must be automation-first: routine linting, sync health, hosted health, conflict detection, and stale-state checks should run through tools or scheduled/operator commands, and any issue needing human judgement must be clearly and proactively surfaced to the user with the next required action.

**Why:** The Brain is meant to reduce cognitive and operational load, not create a second system the user must manually babysit. Sync conflicts, lint drift, stale daemon health, and source-ingestion issues are real, but they should be detected automatically and presented as actionable exceptions. Manual work is acceptable only where semantic judgement is required, such as choosing the correct merged Markdown content for a conflict.

**Alternatives rejected:** Requiring users to remember maintenance commands; burying sync/lint failures in logs; silently resolving semantic conflicts; treating hosted Brain operation as an expert-only database/admin workflow; making every routine check a manual user ritual.

**Related:** `docs/ROADMAP.md`; `docs/conflict-resolution.md`; `docs/deploy-fly.md`; `brain_load_context` lint/inbox nudges; `npm run hosted:doctor`.

---

## 2026-06-16 — Stage hosted Brain cutover before ERS multi-tenant buildout

**Decision:** Treat the JEM hosted Brain as a local-first pilot that must become operationally boring before normal remote-client cutover, then build multi-Brain support, ERS-owned Supabase migration, ERS multi-user access, and true multi-tenant product shape in that order.

**Why:** The rebuild has proven the core Supabase-backed sync, conflict, and OAuth paths, but production trust depends on repeatable operator checks, daemon health, conflict resolution guidance, and recovery rehearsal. ERS multi-user and multi-tenant work should build on a proven single-user/multi-Brain contract rather than mixing product tenancy concerns into the remaining JEM pilot hardening.

**Alternatives rejected:** Cutting over hosted MCP immediately because tests pass once; treating hosted cutover as abandoning local Markdown; building ERS multi-tenant machinery before multi-Brain routing and operational recovery are proven; treating John's private Supabase pilot as final ERS production infrastructure.

**Related:** `docs/ROADMAP.md`; `docs/specs/002-local-first-hosted-sync-contract.md`; `docs/specs/003-hosted-brain-sync-architecture.md`.

---

## 2026-06-14 — Remove git hot path from Fly hosted runtime config

**Decision:** The committed Fly runtime config, Docker image, and entrypoint must represent the Supabase-backed hosted Brain runtime, not the retired git working-copy pilot. Fly must not mount a deploy key, install SSH/git only for hosted writes, or enable `BRAIN_AUTO_SYNC`/`BRAIN_AUTO_PUSH` for the Supabase-backed server.

**Why:** Documentation already retired the hosted git hot path, but executable deployment files still preserved it. That mismatch could accidentally redeploy the old architecture with sensitive Brain data and recreate local/hosted drift. Keeping deployment-specific Supabase URLs and credentials in Fly secrets also preserves the future ERS-owned Supabase cutover path.

**Alternatives rejected:** Leaving the old Fly config as a historical artifact; keeping deploy-key support in the image "just in case"; committing the pilot Supabase project URL into `fly.toml`; treating docs as sufficient protection against deploying the wrong runtime.

**Related:** `fly.toml`; `Dockerfile`; `scripts/fly-entrypoint.sh`; `docs/deploy-fly.md`; `docs/specs/003-hosted-brain-sync-architecture.md`.

---

## 2026-06-14 — Keep artifact byte access out of the normal hosted runtime

**Decision:** Normal hosted Brain runtime may use Supabase Storage as the artifact authority while running in `BRAIN_ARTIFACT_BYTE_ACCESS=metadata_only` mode, without a Supabase service-role key. Service-role-backed Storage byte access is restricted to explicit ingestion/admin operations with `BRAIN_ARTIFACT_BYTE_ACCESS=admin`.

**Why:** Hosted source tools currently expose Postgres manifests and extracted text, not original binary bytes. Requiring a broad Storage service key in the public hosted MCP runtime increases blast radius without providing runtime value. Separating metadata/search from byte upload/download lets the runtime use the narrower `brain_runtime` database login while keeping original artifact byte handling behind explicit operator/admin paths.

**Alternatives rejected:** Requiring `BRAIN_SUPABASE_SERVICE_ROLE_KEY` for every hosted runtime process; exposing signed URLs or raw artifact bytes before the download authorization model is designed; treating Supabase Storage object access as equivalent to Postgres metadata access.

**Related:** `docs/security/hosted-brain-supabase-security-gate.md`; `docs/deploy-fly.md`; `src/services/runtime-config.ts`.

---

## 2026-06-14 — Use a dedicated Brain runtime database role

**Decision:** Use a no-login `brain_runtime` Postgres role as the server-side database access boundary for hosted Brain revision/source metadata traffic. Dedicated runtime login roles may inherit `brain_runtime`; browser/client roles (`anon`, `authenticated`, `public`) must not receive Brain schema access.

**Why:** The hosted runtime needs transactional read/write access to private Brain tables while preserving the decision that Brain data is not exposed through Supabase client roles or the public Data API. A dedicated runtime role avoids routine use of the database owner/service-role connection for revision traffic and keeps the future ERS production cutover portable.

**Alternatives rejected:** Continuing to use a privileged database owner connection for all hosted runtime queries; granting `anon`/`authenticated` table access before the end-user access model is designed; using `BYPASSRLS` for the runtime role; putting Brain tables into an exposed schema.

**Related:** `db/migrations/2026-06-14_003_brain_runtime_role.sql`; `docs/security/hosted-brain-supabase-security-gate.md`; `docs/specs/003-hosted-brain-sync-architecture.md`.

---

## 2026-06-14 — Treat Supabase security as a pre-ingestion gate

**Decision:** Before continuing hosted Brain migration work with sensitive data, record and pass a Supabase security gate for the pilot project. The gate requires the `brain` schema to remain private, Brain tables to have RLS enabled with no public/client policies, the artifact bucket to remain private, security advisors to be free of active WARN/ERROR findings, and privileged credentials to stay out of chat, docs, commits, logs, and screenshots.

**Why:** Hosted Brain will contain private Markdown revisions, source provenance, extracted source text, and original artifacts. The main leak risk at this stage is not anonymous database access, but accidentally exposing privileged Supabase credentials or widening schema/API access before the hosted access model is designed.

**Alternatives rejected:** Importing sensitive data before checking grants, RLS, policies, Storage privacy, and advisor output. Treating private bucket status alone as sufficient. Adding broad `anon`/`authenticated` grants early for convenience. Treating the private-org pilot as production security approval for the future ERS-owned project.

**Related:** `docs/security/hosted-brain-supabase-security-gate.md`; `docs/specs/003-hosted-brain-sync-architecture.md`; `db/migrations/2026-06-14_002_harden_hosted_brain_advisors.sql`.

---

## 2026-06-14 — Use a dedicated Supabase project and preserve ERS account portability

**Decision:** Create a new dedicated Supabase project for hosted Brain in John's private Supabase org for the first MCP rebuild/pilot, then migrate to an ERS-owned Supabase project before ERS production cutover. Existing application projects such as Promptalis, Social Creator, Fizbit-DM, or TeachMeIn5 must not host Brain production state.

**Why:** Brain storage will contain private Markdown revisions, source provenance, original artifacts, and future ERS-owned operational data. Starting in John's private org is the fastest controlled pilot path, but ERS production data must be owned by ERS, with billing, access control, audit, and account continuity separated from John's personal/private Supabase account. A dedicated project also keeps migration, backup, RLS, Storage, and lifecycle policies clean.

**Alternatives rejected:** Reusing an existing Supabase app project; hard-coding project refs, org ids, bucket URLs, or account-specific assumptions into the server; treating the private-org pilot as final ERS production infrastructure; using a shared Supabase project for unrelated applications and Brain state.

**Related:** `docs/specs/003-hosted-brain-sync-architecture.md`; prior decision "2026-06-14 — Use Postgres plus Supabase Storage for production hosted Brain state".

---

## 2026-06-14 — Use immutable Supabase Storage object paths for source artifacts

**Decision:** Store Brain source artifacts in a private Supabase Storage bucket named `brain-artifacts` using immutable object paths that include Brain id, source id, artifact kind, content hash, and sanitized original filename. Postgres stores the manifest row and provenance; object uploads default to `upsert=false`.

**Why:** Source artifacts are evidence, not mutable working files. Immutable paths prevent silent overwrites, avoid stale CDN/cache behavior, make duplicate detection checksum-driven, and keep the Postgres revision path focused on Markdown state and metadata. This also works for large/binary inputs while allowing SharePoint/OneDrive pointers where those systems remain canonical.

**Alternatives rejected:** Mutable object names such as `latest.pdf`; using Storage as the source of truth for curated Markdown revisions; storing binary content directly in Postgres; making the artifact bucket public.

**Related:** `docs/specs/003-hosted-brain-sync-architecture.md`; `db/migrations/2026-06-14_001_hosted_brain_postgres.sql`.

---

## 2026-06-14 — Use Postgres plus Supabase Storage for production hosted Brain state

**Decision:** Use Postgres as the production `RevisionStore` and metadata database, with Supabase Storage private buckets for original binary/source artifacts. Curated Markdown revisions, sync cursors, conflicts, source provenance, extracted text, and future semantic chunks live in Postgres; PDFs, DOCX files, images, audio, and other original binaries live in object storage with Postgres manifest rows.

**Why:** Brain file revisions need transactional compare-and-swap writes, conflict tracking, audit metadata, cursors, and future RLS/pgvector support. Original source artifacts need blob/object semantics, retention metadata, checksums, and private access control without bloating database backups or mixing binary storage into the hot revision path. Supabase is a good fit because it provides managed Postgres plus integrated private Storage, while still leaving room for self-hosting or a Mac mini Postgres later.

**Alternatives rejected:** Storing original binaries as Postgres `bytea` except for tiny test fixtures. Using Supabase Storage as the authority for Markdown revisions. Treating SharePoint/OneDrive as the universal platform store; it remains an ERS collaboration/canonical-source adapter where appropriate, not the core Brain revision engine. Continuing with file-backed JSON beyond local harness tests.

**Related:** `docs/specs/003-hosted-brain-sync-architecture.md`; prior decision "2026-06-14 — Rebuild hosted Brain around replicated revisions, not git hot path".

---

## 2026-06-14 — Rebuild hosted Brain around replicated revisions, not git hot path

**Decision:** Rebuild hosted Brain sync around a hosted revision store plus local sync agent, with local Markdown preserved as a first-class editing surface and git demoted to async backup/export/history rather than live sync transport.

**Why:** The Fly/git pilot made remote MCP reachable but failed the local-first product contract: hosted writes did not automatically update the local Markdown Brain, local edits had no automatic hosted propagation path, and git push/pull semantics created drift and latency risk. A revision store with compare-and-swap writes, local sync cursors, and explicit conflicts directly addresses the required hosted-to-local, local-to-hosted, dirty-file block, and latency-instrumented acceptance tests.

**Alternatives rejected:** Continuing to patch the Fly hosted working copy as the default architecture. Treating GitHub as the live sync fabric because it already provides backup/history. Making local Markdown a stale export of a cloud-only Brain. Re-enabling `brain-hosted` as an active Codex connector before the sync contract passes.

**Related:** `docs/specs/003-hosted-brain-sync-architecture.md`; `docs/specs/002-local-first-hosted-sync-contract.md`; prior decision "2026-06-14 — Revert Codex to local Brain MCP while hosted is rebuilt".

---

## 2026-06-14 — Revert Codex to local Brain MCP while hosted is rebuilt

**Decision:** Remove the experimental `brain-hosted` MCP registration from Codex and keep the existing local stdio `brain` MCP as the active/default Brain path while the hosted architecture is rebuilt against the local-first sync contract.

**Why:** The hosted pilot introduced regressions against the actual working baseline: higher latency, hosted writes that did not automatically update the local Markdown working surface, and an unclear path for local edits to sync back to hosted clients. Remote/mobile access remains required, but it cannot come at the cost of the current local MCP behavior.

**Alternatives rejected:** Continuing to use hosted MCP as the default while fixing sync later. Treating Fly/GitHub availability as sufficient proof of Brain platform success. Removing the hosted work entirely; it remains a useful pilot and deployment reference, but not the load-bearing connector.

**Related:** `docs/specs/002-local-first-hosted-sync-contract.md`; prior decision "2026-06-14 — Put git-backed hosted Brain architecture under review".

---

## 2026-06-14 — Put git-backed hosted Brain architecture under review

**Decision:** Do not treat the Fly + git working-copy pilot as the settled architecture. Further hosted Brain work must satisfy the local-first hosted sync contract before it is considered successful, and git's role must be re-derived from requirements rather than inherited from the local-only backup workflow.

**Why:** The pilot proved hosted OAuth/MCP reachability and hosted auto-commit/push, but exposed a product regression: remote writes did not automatically update John's primary local Markdown working surface, and local edits did not have a defined path back to the hosted server. GitHub was originally a backup/versioning layer; using it as live sync requires an explicit decision and complete bidirectional verification.

**Alternatives rejected:** Continuing to patch around local drift without revisiting storage/sync architecture. Treating GitHub as the hot path simply because it was already present. Blocking all hosted progress indefinitely; the interim host remains useful if it can meet the sync contract and stay portable to the future Mac mini.

**Related:** `docs/specs/002-local-first-hosted-sync-contract.md`; prior decision "2026-06-13 — Pilot hosted Brain on Fly with filesystem git storage".

---

## 2026-06-13 — Pilot hosted Brain on Fly with filesystem git storage

**Decision:** Use Fly.io plus a persistent volume as the first hosted Brain MCP runtime, preserving the current Markdown filesystem and git working-copy model.

**Why:** The current server edits Markdown files in a real git checkout and relies on commit/push behavior, so a Node runtime with durable filesystem state is the fastest low-regression path to remote MCP access. This requires a repo-scoped deploy key on the host; revisit whether a cloud database/content-store backend would provide a better long-term security and operations model after the hosted pilot proves the product flow.

**Alternatives rejected:** Cloudflare Workers + D1/KV as the first host because the Brain needs filesystem git operations in Phase 2. Cloud database as source of truth deferred because it would change the storage model and local Markdown/git workflows.

**Related:** `docs/specs/001-brain-platform-phase-1-2.md`; `BACKLOG.md` item "Revisit Brain Platform storage architecture after hosted Fly pilot".

---

<!-- Template for a new entry. Copy-paste, fill in, leave the divider. -->

<!--
## YYYY-MM-DD — <Short title of the decision>

**Decision:** <One sentence — what was locked in.>

**Why:** <The constraint, insight, or trade-off that drove it. The reasoning that future-you needs to evaluate whether this still applies.>

**Alternatives rejected:** <What else was on the table. One line each.>

**Related:** <Spec NNN, PR link, audit reference, or the conversation that produced it.>

---
-->
