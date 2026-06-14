-- Advisor hardening for hosted Brain pilot.
--
-- The first migration intentionally keeps Brain tables in a private schema with
-- RLS enabled and no public policies. This migration addresses concrete advisor
-- warnings: exposed automatic-RLS helper execution and unindexed foreign keys.

do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public;
    revoke execute on function public.rls_auto_enable() from anon;
    revoke execute on function public.rls_auto_enable() from authenticated;
  end if;
end $$;

create index if not exists brain_file_revisions_parent_revision_idx
  on brain.brain_file_revisions (parent_revision_id)
  where parent_revision_id is not null;

create index if not exists brain_roles_principal_idx
  on brain.brain_roles (principal_id);

create index if not exists ingest_jobs_source_idx
  on brain.ingest_jobs (source_id)
  where source_id is not null;

create index if not exists sync_conflicts_local_base_revision_idx
  on brain.sync_conflicts (local_base_revision_id)
  where local_base_revision_id is not null;

create index if not exists sync_conflicts_remote_head_revision_idx
  on brain.sync_conflicts (remote_head_revision_id)
  where remote_head_revision_id is not null;

create index if not exists sync_conflicts_resolution_revision_idx
  on brain.sync_conflicts (resolution_revision_id)
  where resolution_revision_id is not null;

create index if not exists sync_events_revision_idx
  on brain.sync_events (revision_id)
  where revision_id is not null;

create index if not exists sync_events_sync_client_idx
  on brain.sync_events (sync_client_id)
  where sync_client_id is not null;

create index if not exists sync_file_states_brain_idx
  on brain.sync_file_states (brain_id);

create index if not exists sync_file_states_revision_idx
  on brain.sync_file_states (revision_id)
  where revision_id is not null;
