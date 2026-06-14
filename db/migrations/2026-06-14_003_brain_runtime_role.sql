-- Least-privilege database role boundary for hosted Brain runtime.
--
-- This creates a no-login group role for server-side Brain database access.
-- Create a separate LOGIN role/user outside this migration, grant it
-- membership in brain_runtime, and store that connection URL as a secret.
-- Do not grant anon/authenticated/public access to the private brain schema.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'brain_runtime') then
    create role brain_runtime nologin;
  end if;
end $$;

grant usage on schema brain to brain_runtime;
grant select, insert, update, delete on all tables in schema brain to brain_runtime;
grant usage, select on all sequences in schema brain to brain_runtime;

alter default privileges in schema brain
  grant select, insert, update, delete on tables to brain_runtime;

alter default privileges in schema brain
  grant usage, select on sequences to brain_runtime;

do $$
declare
  brain_table_name text;
  policy_name text;
begin
  foreach brain_table_name in array array[
    'brains',
    'principals',
    'brain_roles',
    'brain_files',
    'brain_file_revisions',
    'sync_clients',
    'sync_file_states',
    'sync_conflicts',
    'sources',
    'source_artifacts',
    'source_artifact_text',
    'source_chunks',
    'ingest_jobs',
    'sync_events'
  ]
  loop
    policy_name := format('brain_runtime_all_%s', brain_table_name);
    if not exists (
      select 1
      from pg_policies
      where schemaname = 'brain'
        and tablename = brain_table_name
        and policyname = policy_name
    ) then
      execute format(
        'create policy %I on brain.%I for all to brain_runtime using (true) with check (true)',
        policy_name,
        brain_table_name
      );
    end if;
  end loop;
end $$;

revoke all on schema brain from public;
revoke all on schema brain from anon;
revoke all on schema brain from authenticated;

comment on role brain_runtime is
  'Server-side hosted Brain runtime role. Intended for private MCP runtime database connections, not browser/client access.';
