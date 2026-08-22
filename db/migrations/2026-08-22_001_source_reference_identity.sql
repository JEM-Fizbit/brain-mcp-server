-- Additive source-reference identity and reviewed Brain-link contract.
--
-- Existing source/artifact rows remain valid with nullable new fields. Provider
-- ids and revisions are stable machine identity; root aliases and safe relative
-- paths support local human navigation without persisting machine-specific
-- absolute paths.

alter table brain.sources
  add column if not exists companion_path text;

alter table brain.sources
  drop constraint if exists sources_companion_path_check;

alter table brain.sources
  add constraint sources_companion_path_check check (
    companion_path is null
    or (
      companion_path like 'sources/%.md'
      and companion_path not like '/%'
      and position('..' in companion_path) = 0
      and position(E'\\' in companion_path) = 0
    )
  );

create unique index if not exists sources_brain_companion_path_idx
  on brain.sources (brain_id, companion_path)
  where companion_path is not null;

alter table brain.source_artifacts
  add column if not exists provider_revision text,
  add column if not exists root_alias text,
  add column if not exists relative_path text,
  add column if not exists observed_at timestamptz;

alter table brain.source_artifacts
  drop constraint if exists source_artifacts_root_alias_check;

alter table brain.source_artifacts
  add constraint source_artifacts_root_alias_check check (
    root_alias is null or root_alias ~ '^[a-z][a-z0-9_]{0,63}$'
  );

alter table brain.source_artifacts
  drop constraint if exists source_artifacts_relative_path_check;

alter table brain.source_artifacts
  add constraint source_artifacts_relative_path_check check (
    relative_path is null
    or (
      relative_path not like '/%'
      and relative_path !~ '^[A-Za-z]:'
      and position('..' in relative_path) = 0
      and position(E'\\' in relative_path) = 0
    )
  );

alter table brain.source_artifacts
  drop constraint if exists source_artifacts_local_locator_pair_check;

alter table brain.source_artifacts
  add constraint source_artifacts_local_locator_pair_check check (
    (root_alias is null and relative_path is null)
    or (root_alias is not null and relative_path is not null)
  );

alter table brain.source_artifacts
  drop constraint if exists source_artifacts_check;

alter table brain.source_artifacts
  drop constraint if exists source_artifacts_locator_check;

alter table brain.source_artifacts
  add constraint source_artifacts_locator_check check (
    (storage_bucket is not null and storage_path is not null)
    or external_url is not null
    or external_id is not null
    or (root_alias is not null and relative_path is not null)
  );

create index if not exists source_artifacts_provider_identity_idx
  on brain.source_artifacts (external_provider, external_id, provider_revision)
  where external_provider is not null and external_id is not null;

create table if not exists brain.source_brain_links (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references brain.sources(id) on delete cascade,
  brain_filename text not null,
  relation text not null check (
    relation in ('supports', 'context', 'contradicts', 'derived_from', 'mentions')
  ),
  label text,
  anchor text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (brain_filename like '%.md'),
  check (brain_filename not like '/%'),
  check (position('..' in brain_filename) = 0),
  check (position(E'\\' in brain_filename) = 0),
  unique (source_id, brain_filename, relation, anchor)
);

create index if not exists source_brain_links_source_idx
  on brain.source_brain_links (source_id, brain_filename);

alter table brain.source_brain_links enable row level security;

grant select, insert, update, delete on brain.source_brain_links to brain_runtime;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'brain'
      and tablename = 'source_brain_links'
      and policyname = 'brain_runtime_all_source_brain_links'
  ) then
    create policy brain_runtime_all_source_brain_links
      on brain.source_brain_links
      for all
      to brain_runtime
      using (true)
      with check (true);
  end if;
end $$;

revoke all on table brain.source_brain_links from public;
revoke all on table brain.source_brain_links from anon;
revoke all on table brain.source_brain_links from authenticated;

comment on table brain.source_brain_links is
  'Reviewed semantic links from a source manifest to Brain Markdown files. Rows are declared provenance, never inferred relationships.';

comment on column brain.source_artifacts.external_id is
  'Provider-issued stable artifact identity, such as a Dropbox file id.';

comment on column brain.source_artifacts.provider_revision is
  'Provider-issued observed revision/version for exact traceability.';

comment on column brain.source_artifacts.root_alias is
  'Registered local root alias. Absolute local filesystem paths are not canonical identity.';
