import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(
  __dirname,
  "..",
  "db",
  "migrations",
  "2026-06-14_001_hosted_brain_postgres.sql"
);
const hardeningPath = path.join(
  __dirname,
  "..",
  "db",
  "migrations",
  "2026-06-14_002_harden_hosted_brain_advisors.sql"
);
const runtimeRolePath = path.join(
  __dirname,
  "..",
  "db",
  "migrations",
  "2026-06-14_003_brain_runtime_role.sql"
);
const pilotSeedPath = path.join(
  __dirname,
  "..",
  "db",
  "seeds",
  "2026-06-14_001_bootstrap_pilot_brain.sql"
);

test("production schema keeps binaries out of Postgres hot path", async () => {
  const sql = await fs.readFile(schemaPath, "utf-8");

  assert.match(sql, /create schema if not exists brain/i);
  assert.match(sql, /to_regclass\('storage\.buckets'\)/i);
  assert.match(sql, /values \('brain-artifacts', 'brain-artifacts', false\)/i);
  assert.match(sql, /create table if not exists brain\.brain_file_revisions/i);
  assert.match(sql, /create table if not exists brain\.source_artifacts/i);
  assert.match(sql, /storage_bucket text/i);
  assert.match(sql, /storage_path text/i);
  assert.match(sql, /external_provider text/i);
  assert.match(sql, /external_id text/i);
  assert.doesNotMatch(sql, /\bbytea\b/i, "original binaries should not live in Postgres");
});

test("advisor hardening revokes public automatic-RLS function execution", async () => {
  const sql = await fs.readFile(hardeningPath, "utf-8");

  assert.match(sql, /revoke execute on function public\.rls_auto_enable\(\) from public/i);
  assert.match(sql, /revoke execute on function public\.rls_auto_enable\(\) from anon/i);
  assert.match(sql, /revoke execute on function public\.rls_auto_enable\(\) from authenticated/i);
});

test("advisor hardening indexes nullable foreign keys", async () => {
  const sql = await fs.readFile(hardeningPath, "utf-8");
  const indexes = [
    "brain_file_revisions_parent_revision_idx",
    "brain_roles_principal_idx",
    "ingest_jobs_source_idx",
    "sync_conflicts_local_base_revision_idx",
    "sync_conflicts_remote_head_revision_idx",
    "sync_conflicts_resolution_revision_idx",
    "sync_events_revision_idx",
    "sync_events_sync_client_idx",
    "sync_file_states_brain_idx",
    "sync_file_states_revision_idx",
  ];

  for (const index of indexes) {
    assert.match(sql, new RegExp(`create index if not exists ${index}`, "i"));
  }
});

test("production schema enables RLS on private Brain tables", async () => {
  const sql = await fs.readFile(schemaPath, "utf-8");
  const tables = [
    "brains",
    "principals",
    "brain_roles",
    "brain_files",
    "brain_file_revisions",
    "sync_clients",
    "sync_file_states",
    "sync_conflicts",
    "sources",
    "source_artifacts",
    "source_artifact_text",
    "source_chunks",
    "ingest_jobs",
    "sync_events",
  ];

  for (const table of tables) {
    assert.match(
      sql,
      new RegExp(`alter table brain\\.${table} enable row level security`, "i"),
      `${table} should have RLS enabled`
    );
  }
});

test("pilot seed bootstraps Brain registry without public grants", async () => {
  const sql = await fs.readFile(pilotSeedPath, "utf-8");
  const executableSql = sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");

  assert.match(sql, /insert into brain\.brains/i);
  assert.match(sql, /'ai-brain-jem'/i);
  assert.match(sql, /on conflict \(id\) do update/i);
  assert.doesNotMatch(executableSql, /\bgrant\b/i);
  assert.doesNotMatch(executableSql, /create policy/i);
  assert.doesNotMatch(executableSql, /alter table .* disable row level security/i);
});

test("runtime role migration grants server access without public client access", async () => {
  const sql = await fs.readFile(runtimeRolePath, "utf-8");
  const executableSql = sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
  const tables = [
    "brains",
    "principals",
    "brain_roles",
    "brain_files",
    "brain_file_revisions",
    "sync_clients",
    "sync_file_states",
    "sync_conflicts",
    "sources",
    "source_artifacts",
    "source_artifact_text",
    "source_chunks",
    "ingest_jobs",
    "sync_events",
  ];

  assert.match(sql, /create role brain_runtime nologin/i);
  assert.match(sql, /grant usage on schema brain to brain_runtime/i);
  assert.match(
    sql,
    /grant select, insert, update, delete on all tables in schema brain to brain_runtime/i
  );
  assert.match(sql, /alter default privileges in schema brain/i);
  assert.doesNotMatch(executableSql, /create role brain_runtime\b[^;]*\blogin\b/i);
  assert.doesNotMatch(executableSql, /\bbypassrls\b/i);
  assert.doesNotMatch(executableSql, /grant .* on schema brain to public/i);
  assert.doesNotMatch(executableSql, /grant .* on schema brain to anon/i);
  assert.doesNotMatch(executableSql, /grant .* on schema brain to authenticated/i);
  assert.match(executableSql, /revoke all on schema brain from public/i);
  assert.match(executableSql, /revoke all on schema brain from anon/i);
  assert.match(executableSql, /revoke all on schema brain from authenticated/i);
  assert.match(sql, /policy_name := format\('brain_runtime_all_%s', brain_table_name\)/i);
  assert.match(
    sql,
    /create policy .* on brain\.%I for all to brain_runtime using \(true\) with check \(true\)/i
  );

  for (const table of tables) {
    assert.match(sql, new RegExp(`'${table}'`, "i"));
  }
});
