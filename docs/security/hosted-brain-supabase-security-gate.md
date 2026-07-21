# Hosted Brain Supabase Security Gate

**Status:** passed for ERS M1 stand-up; runtime deployment still pending
**Checked:** 2026-07-21
**Project:** `brain-platform-pilot`
**Supabase project ref:** `omnwbcdtmtvxasgdmvwr`
**Organization:** `ERS Genomics`
**Scope:** ERS-owned hosted Brain database, dedicated runtime role, and private artifact bucket before the first ERS Fly deployment.

## Gate Decision

The ERS-owned hosted Brain database may proceed through M1 deployment, provided credentials remain in a password manager or deployment secret store and the `brain` schema remains private until the hosted access model is explicitly designed.

This gate does not approve broad client-side access, public API access, additional users, or the later irreversible cross-tenant purge. Those remain governed by spec 012's separate rollout and cutover gates.

## Verified Controls

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
- Define the end-user access model before adding RLS policies.
- Decide the narrower artifact download model before exposing original bytes through hosted MCP.
- Confirm backup, retention, audit, and artifact deletion requirements for ERS-owned data.

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
