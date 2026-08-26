# Hosted Brain Supabase Security Gate

**Status:** passed for the live JEM and ERS hosted runtimes
**Checked:** JEM 2026-08-26; ERS 2026-08-19
**Projects:** `jem-brain-personal`; `brain-platform-pilot`
**Supabase project refs:** `gfipcidoyrtgngauzijy`; `omnwbcdtmtvxasgdmvwr`
**Organizations:** John E. Milad personal; `ERS Genomics`
**Scope:** owner-isolated hosted Brain databases, dedicated runtime roles, private artifact buckets, and bounded operational-observability schemas.

## Gate Decision

The ERS-owned hosted Brain database may proceed through M1 deployment, provided credentials remain in a password manager or deployment secret store and the `brain` schema remains private until the hosted access model is explicitly designed.

This gate does not approve broad client-side access, public API access or
additional users. Production identity and permissions are governed by
[spec 018](../specs/018-ers-production-identity-and-rollout.md); the completed
infrastructure separation remains governed by spec 012.

## Verified Controls

- The 2026-08-26 JEM bounded-observability gate reported 17/17 Brain
  tables with RLS, zero `anon`/`authenticated`/`public` Brain grants, zero
  non-`brain_runtime` Brain policies, one `brain_runtime`-only policy and no
  other policy on `brain.sync_heartbeats`, a private artifact bucket, zero
  client Storage policies, no client/public execute privilege on
  `public.rls_auto_enable()`, and a valid/ready partial observability index.
  The dedicated `brain_jem_sync_user` remained login-capable, inherited
  `brain_runtime`, and had no elevated database privilege. A fresh Supabase
  Security Advisor run returned 0 errors, 0 warnings, and 0 suggestions.
- After the JEM watcher created a fresh current-state heartbeat, a bounded
  cleanup removed 57,861 JEM and 475,091 ERS legacy `sync_heartbeat` events.
  JEM's 1,890 and ERS's 1,404 non-heartbeat operational events were preserved
  exactly, and both current-state heartbeat rows remained fresh. These deleted
  low-value telemetry rows are recoverable only through the providers' backup
  or point-in-time recovery facilities; no application-level archive was
  retained. Automatic vacuum completed on both event tables with zero estimated
  dead rows. PostgreSQL retained 54,591,488 JEM and 527,908,864 ERS allocated
  relation bytes for internal reuse; a locking `VACUUM FULL` was deliberately
  not run.
- The 2026-08-22 JEM-first source-reference migration was applied to the
  personal `jem-brain-personal` project (`gfipcidoyrtgngauzijy`) with ERS
  untouched. The post-migration gate reported 16/16 Brain tables with RLS,
  zero `anon`/`authenticated`/`public` Brain grants, one `brain_runtime`-only
  policy and no other policy on `brain.source_brain_links`, a private artifact
  bucket, all five new path/identity constraints present, and all 70 existing
  source plus 70 artifact rows preserved. A fresh Supabase Security Advisor run
  returned 0 errors, 0 warnings, and 0 suggestions. The reviewed JEM canary then
  added one pointer-only artifact and one declared source-to-Brain link, for
  totals of 71 sources, 71 artifacts, and one reviewed link; its complete
  persisted identity digest matched the compiled manifest, and no source bytes
  or extracted content were uploaded.
- The personal local-sync login `brain_jem_sync_user` exists solely for the JEM
  Monitor profile, inherits `brain_runtime`, and has no superuser, role-creation,
  database-creation, replication, or RLS-bypass privilege. Its transaction
  pooler URL is stored only in the owner-readable (`0600`) installed Monitor
  config, bound to expected project ref `gfipcidoyrtgngauzijy`, and excluded
  from ambient repo env loading. A known personal hosted revision pulled to the
  local JEM mirror after cutover. A fresh post-credential Security Advisor run
  again returned 0 errors, 0 warnings, and 0 suggestions.
- The `brain` schema has no grants to `anon`, `authenticated`, or `public`.
- All `brain.*` tables have Row Level Security enabled.
- The `brain.*` tables have server-side RLS policies only for the no-login `brain_runtime` database role; web/client roles still have no row access.
- The `brain_runtime` role is a no-login group role for private MCP runtime database connections. Dedicated login roles may inherit it, but `anon`, `authenticated`, and `public` must not.
- The ERS-owned `brain_runtime_user` login exists, has a user-generated Dashlane-custodied password, inherits `brain_runtime`, and has no superuser, role-creation, database-creation, replication, or RLS-bypass privilege. Direct read-only authentication through the shared transaction pooler on `:6543` passed with `verify-full` against Supabase's published CA; the password and encoded runtime URL were never exposed to the agent.
- The `brain-artifacts` Storage bucket exists and is private.
- Storage has no public policies granting object access.
- The `public.rls_auto_enable()` helper no longer grants execute privileges to `public`, `anon`, or `authenticated`.
- Supabase security advisors showed no active WARN or ERROR findings after the 2026-06-14 hardening pass.
- Remaining 2026-06-14 security advisor notices were expected INFO findings for RLS-enabled private tables with no policies.
- The 2026-07-17 spec 013 recheck followed application of the private, tombstone-filtered Brain-revision GIN full-text index. The index is valid and ready with predicate `deleted = false`; it added no grants or policies. All 15 `brain` tables retained RLS, public/client Brain grants remained zero, all Brain policies remained scoped to `brain_runtime`, the runtime role remained no-login/non-bypass, the artifact bucket remained private, and `public.rls_auto_enable()` remained unavailable to client/public roles.
- The 2026-07-17 Supabase security advisor returned no findings. Performance advisors returned INFO only (existing unused-index notices plus the Auth connection-strategy notice), and `supabase db lint --schema brain --fail-on error` found no schema errors. Dedicated runtime-role smokes connected for both `ai-brain-jem` and `ers-brain` with zero public grants.
- The 2026-07-21 ERS re-gate again reported 15/15 Brain tables with RLS, zero public/client Brain grants, 15/15 Brain policies scoped only to `brain_runtime`, a private `brain-artifacts` bucket, zero Storage policies, and no client/public execute privilege on `public.rls_auto_enable()`. Security advisors returned no findings before and after the dedicated login was created; performance advisors remained INFO-only.
- The 2026-08-19 bounded-observability migration added `brain.sync_heartbeats` and the partial `sync_events_hosted_observability_idx`. The post-migration gate reported 16/16 Brain tables with RLS, zero `anon`/`authenticated`/`public` Brain grants, one `brain_runtime`-only policy and no other policy on `sync_heartbeats`, and a valid/ready partial index. The dedicated ERS runtime login could select, insert, and update the table through RLS. A fresh Supabase Security Advisor run returned 0 errors, 0 warnings, and 0 suggestions; Performance Advisor returned 0 errors and 0 warnings, with six INFO-only unused-index/Auth-connection notices. No historical telemetry was deleted.
- The pilot `ai-brain-jem` registry row has been bootstrapped without adding grants, RLS policies, or public Storage access.
- Durable OAuth connector state now lives in private `brain.oauth_state` with RLS enabled, a `brain_runtime`-only policy, and zero grants to `anon`, `authenticated`, or `public`. The 2026-06-22 migration check reported `rowsecurity=true`, `public_grants=0`, and `runtime_policies=1`.
- A temporary Postgres smoke test Brain completed local push, hosted revision read, fresh local pull, content verification, and cleanup on 2026-06-14.
- The real `ai-brain-jem` canary push completed for `00_loader.md` on 2026-06-14. Hosted Postgres recorded one current file revision from `local_sync_cli` and no sync conflicts.
- The real `ai-brain-jem` hosted-to-local canary pull completed for `00_loader.md` into a fresh temporary mirror on 2026-06-14. The pulled file matched the local Brain file byte-for-byte.
- The real `ai-brain-jem` staged core seed completed for 14 root Brain files on 2026-06-14. A fresh hosted-to-local mirror verification matched all 14 files byte-for-byte and recorded zero conflicts.
- A temporary Postgres BrainStore smoke test completed read, write, list, search, and no-op commit checks through the MCP-facing storage abstraction on 2026-06-14, then cleaned up its temporary Brain row.
- The real `ai-brain-jem` full Markdown seed completed for 49 Markdown files on 2026-06-14. A fresh hosted-to-local mirror verification matched all 49 files byte-for-byte and recorded zero conflicts.
- Source/original artifact inventory completed for 70 local files on 2026-06-14. Postgres now records pointer-only artifact manifests with checksums, sizes, MIME guesses, local provenance paths, and `storage_upload_status=pending`; no binary bytes were uploaded in that step.
- Source/original artifact upload completed for 70 local files on 2026-06-14. Supabase Storage now contains 70 private objects in `brain-artifacts`; Postgres manifests are `active`, have distinct Storage paths, and have no missing hashes.
- Hosted source discovery is available through Postgres-backed source manifest listing, filename/path metadata search, and extracted-text search when `brain.source_artifact_text` rows exist. OCR/text extraction population remains an ingestion concern; original binary bytes are still not exposed through hosted source reads.
- Source text extraction populated 49 `brain.source_artifact_text` rows on 2026-06-14 from supported local Markdown/plain/text-like and PDF artifacts. The extractor skipped 21 unsupported binaries, with zero missing files, empty extractions, or failures. Hosted MCP smoke verification confirmed `brain_search` can find extracted source text through the private Postgres-backed runtime without exposing Storage object bytes.
- The 2026-06-22 runtime-role smoke verified a dedicated runtime login can connect and read hosted file metadata while public/client grants remain zero (`hostedFiles=52`, `publicGrants=0`). Representative SQL-gate checks reported 15 `brain` tables, 0 Brain tables without RLS, 0 `anon`/`authenticated`/`public` grants, and 0 non-`brain_runtime` Brain policies. The 2026-07-17 recheck supersedes the earlier advisor-coverage gap by calling the authenticated Management API advisor endpoints directly.

## Expected Supabase Surface

Supabase Storage tables may show grants for Supabase's standard `anon` and `authenticated` roles. That does not make Brain artifacts public by itself. Storage object access is still gated by Storage RLS policies and bucket privacy. For this pilot, no policies grant anonymous or authenticated users access to `brain-artifacts` objects.

The service role, database owner, Supabase project owners, dedicated `brain_runtime` database logins, and privileged database connection strings can still access Brain data. This is expected for administration and server-side operation, and it makes secret handling the primary remaining leakage risk. Prefer a dedicated `brain_runtime` login for `BRAIN_REVISION_DATABASE_URL`. Normal hosted runtime source access is metadata/extracted-text only and does not require `BRAIN_SUPABASE_SERVICE_ROLE_KEY`; set `BRAIN_ARTIFACT_BYTE_ACCESS=admin` and provide the service key only for ingestion/admin byte operations.

## Required Handling Rules

- Do not paste the database password, service role key, or privileged connection strings into chat, issues, docs, logs, commits, or screenshots.
- Store the database password and service credentials only in Dashlane, local secret storage, or a deployment secret manager.
- Do not use `NEXT_PUBLIC_` or any other browser-exposed environment variable for service role keys or privileged database URLs.
- Do not add `brain` to exposed API schemas unless a separate API/RLS design has been approved.
- Do not grant `anon` or `authenticated` access to `brain` tables during ingestion or sync implementation.
- Do not use the database owner or Supabase service-role database connection for routine hosted Brain revision traffic after a dedicated `brain_runtime` login is available.
- Run Supabase security advisors after each migration that touches schemas, functions, RLS, Storage, or user data.
- Source artifact byte uploads require `BRAIN_ARTIFACT_BYTE_ACCESS=admin` plus `BRAIN_SUPABASE_SERVICE_ROLE_KEY` in a local/deployment secret. Do not paste it into chat or commit it to the repository.
- Auth telemetry (`hosted_mcp_auth` rows) may record the non-secret OAuth `clientId` and `grantType` for tracking and stale-connector classification (spec 005). A `clientId` is a public identifier already stored plaintext in `brain.oauth_state` `clients`; recording it is permitted. Do not record `User-Agent`, IP, or other network identifiers without an explicit gate review (deferred — see the BACKLOG observability item), and never record tokens, refresh tokens, authorization headers, request bodies, client secrets, or Brain content.

## Before Production Cutover

- [x] Move the project into ERS-owned Supabase organization custody.
- [x] Re-run this gate against the ERS project and record the project ref.
- [x] Create an ERS-owned dedicated database login that inherits `brain_runtime`.
- [x] Verify the dedicated login through the transaction pooler and prepare its strictly validated `BRAIN_REVISION_DATABASE_URL` for Fly secret loading.
- [x] Implement the tenant-neutral Entra identity, fixed-group adapter, private
  grant/audit projection, hosted access-administration controls and automated
  security tests in spec 018.
- [ ] Apply the private grant/audit migration to ERS, rerun this live gate and
  verify the fixed app-role groups before wider enrollment. No additional
  client-side RLS policy is implied.
- [ ] Align SharePoint Brain-folder writes with the named MCP curator population
  and record the team-wide audit/read-logging posture.
- [x] Keep original bytes unexposed (`metadata_only`) for this rollout; a
  narrower download model is required only before hosted byte access is added.
- [ ] Confirm current backup, retention and artifact-deletion requirements.
  The timed isolated restore rehearsal remains recommended resilience work but,
  by the 2026-08-25 decision, is not a Spec 018 production cutover gate.

## Verification Queries

These are representative checks used for this gate. They are safe to rerun because they do not expose secrets.

```sql
select schemaname, tablename, rowsecurity
from pg_tables
where schemaname = 'brain'
order by tablename;
```

```sql
select grantee, table_schema, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'brain'
  and grantee in ('anon', 'authenticated', 'public')
order by table_name, grantee, privilege_type;
```

```sql
select bucket_id, name, public
from storage.buckets
where id = 'brain-artifacts';
```

```sql
select schemaname, tablename, policyname, roles, cmd
from pg_policies
where schemaname in ('brain', 'storage')
order by schemaname, tablename, policyname;
```

```sql
select rolname, rolcanlogin, rolbypassrls
from pg_roles
where rolname = 'brain_runtime';
```

After applying the runtime role migration, this smoke creates a temporary login role, grants it `brain_runtime`, verifies it can read Brain metadata through RLS, verifies public/client grants remain zero, and drops the temporary role:

```bash
npm run smoke:brain-runtime-role
```

```sql
select
  has_function_privilege('anon', 'public.rls_auto_enable()', 'execute') as anon_can_execute,
  has_function_privilege('authenticated', 'public.rls_auto_enable()', 'execute') as authenticated_can_execute,
  has_function_privilege('public', 'public.rls_auto_enable()', 'execute') as public_can_execute;
```
