-- Hosted Brain production storage foundation.
--
-- Postgres owns Brain revisions, sync state, conflicts, source provenance,
-- extracted text, chunks, and operational metadata. Supabase Storage owns
-- original binary/source artifacts; this schema stores manifests and pointers.

create extension if not exists pgcrypto;

create schema if not exists brain;

do $$
begin
  if to_regclass('storage.buckets') is not null then
    execute $sql$
      insert into storage.buckets (id, name, public)
      values ('brain-artifacts', 'brain-artifacts', false)
      on conflict (id) do update
      set name = excluded.name,
          public = false
    $sql$;
  end if;
end $$;

create table if not exists brain.brains (
  id text primary key,
  type text not null check (type in ('personal', 'shared')),
  template_used text not null,
  integration_mode text not null check (
    integration_mode in ('vertical', 'aggregation', 'hybrid')
  ),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists brain.principals (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_user_id text not null,
  login text,
  email text,
  name text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_user_id)
);

create table if not exists brain.brain_roles (
  brain_id text not null references brain.brains(id) on delete cascade,
  principal_id uuid not null references brain.principals(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member', 'reader')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (brain_id, principal_id)
);

create table if not exists brain.brain_file_revisions (
  id uuid primary key default gen_random_uuid(),
  brain_id text not null references brain.brains(id) on delete cascade,
  filename text not null,
  parent_revision_id uuid references brain.brain_file_revisions(id),
  content text not null,
  content_sha256 text not null,
  origin text not null check (
    origin in ('local_agent', 'hosted_mcp', 'import', 'system')
  ),
  actor_provider text,
  actor_id text,
  actor_name text,
  actor_email text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (filename like '%.md'),
  check (filename not like '/%'),
  check (position('..' in filename) = 0)
);

create index if not exists brain_file_revisions_file_created_idx
  on brain.brain_file_revisions (brain_id, filename, created_at desc);

create index if not exists brain_file_revisions_hash_idx
  on brain.brain_file_revisions (brain_id, filename, content_sha256);

create table if not exists brain.brain_files (
  brain_id text not null references brain.brains(id) on delete cascade,
  filename text not null,
  current_revision_id uuid references brain.brain_file_revisions(id),
  current_content_sha256 text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (brain_id, filename),
  check (filename like '%.md'),
  check (filename not like '/%'),
  check (position('..' in filename) = 0)
);

create index if not exists brain_files_current_revision_idx
  on brain.brain_files (current_revision_id);

create table if not exists brain.sync_clients (
  id uuid primary key default gen_random_uuid(),
  brain_id text not null references brain.brains(id) on delete cascade,
  client_name text not null,
  client_kind text not null check (
    client_kind in ('local_agent', 'hosted_mcp', 'system')
  ),
  last_cursor timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brain_id, client_name)
);

create table if not exists brain.sync_file_states (
  sync_client_id uuid not null references brain.sync_clients(id) on delete cascade,
  brain_id text not null references brain.brains(id) on delete cascade,
  filename text not null,
  revision_id uuid references brain.brain_file_revisions(id),
  content_sha256 text,
  local_sha256 text,
  status text not null default 'clean' check (
    status in ('clean', 'pending', 'blocked', 'conflict')
  ),
  updated_at timestamptz not null default now(),
  primary key (sync_client_id, filename),
  check (filename like '%.md'),
  check (filename not like '/%'),
  check (position('..' in filename) = 0)
);

create table if not exists brain.sync_conflicts (
  id uuid primary key default gen_random_uuid(),
  brain_id text not null references brain.brains(id) on delete cascade,
  filename text not null,
  local_base_revision_id uuid references brain.brain_file_revisions(id),
  remote_head_revision_id uuid references brain.brain_file_revisions(id),
  local_content_sha256 text not null,
  remote_content_sha256 text,
  local_origin text not null check (
    local_origin in ('local_agent', 'hosted_mcp', 'import', 'system')
  ),
  remote_origin text check (
    remote_origin in ('local_agent', 'hosted_mcp', 'import', 'system')
  ),
  local_actor_provider text,
  local_actor_id text,
  remote_actor_provider text,
  remote_actor_id text,
  status text not null default 'open' check (
    status in ('open', 'resolved', 'superseded')
  ),
  resolution_revision_id uuid references brain.brain_file_revisions(id),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  check (filename like '%.md'),
  check (filename not like '/%'),
  check (position('..' in filename) = 0)
);

create index if not exists sync_conflicts_open_idx
  on brain.sync_conflicts (brain_id, status, created_at desc);

create table if not exists brain.sources (
  id uuid primary key default gen_random_uuid(),
  brain_id text not null references brain.brains(id) on delete cascade,
  category text not null,
  label text not null,
  status text not null default 'pending' check (
    status in ('pending', 'processed', 'blocked', 'archived')
  ),
  source_date date,
  provenance_note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sources_brain_category_idx
  on brain.sources (brain_id, category, created_at desc);

create table if not exists brain.source_artifacts (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references brain.sources(id) on delete cascade,
  artifact_kind text not null check (
    artifact_kind in (
      'original',
      'markdown_conversion',
      'ocr_text',
      'extracted_text',
      'thumbnail',
      'derived'
    )
  ),
  storage_bucket text,
  storage_path text,
  external_url text,
  external_provider text,
  external_id text,
  original_filename text,
  mime_type text,
  byte_size bigint,
  content_sha256 text,
  retention_status text not null default 'active' check (
    retention_status in ('active', 'snapshot', 'pointer_only', 'deleted')
  ),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (
    (storage_bucket is not null and storage_path is not null)
    or external_url is not null
    or external_id is not null
  )
);

create index if not exists source_artifacts_source_kind_idx
  on brain.source_artifacts (source_id, artifact_kind, created_at desc);

create unique index if not exists source_artifacts_storage_path_idx
  on brain.source_artifacts (storage_bucket, storage_path)
  where storage_bucket is not null and storage_path is not null;

create table if not exists brain.source_artifact_text (
  artifact_id uuid primary key references brain.source_artifacts(id) on delete cascade,
  text_format text not null check (
    text_format in ('plain_text', 'markdown', 'ocr_text')
  ),
  content text not null,
  content_sha256 text not null,
  language text,
  created_at timestamptz not null default now()
);

create table if not exists brain.source_chunks (
  id uuid primary key default gen_random_uuid(),
  artifact_id uuid not null references brain.source_artifacts(id) on delete cascade,
  chunk_index integer not null check (chunk_index >= 0),
  content text not null,
  content_sha256 text not null,
  token_count integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (artifact_id, chunk_index)
);

create table if not exists brain.ingest_jobs (
  id uuid primary key default gen_random_uuid(),
  brain_id text not null references brain.brains(id) on delete cascade,
  source_id uuid references brain.sources(id) on delete set null,
  status text not null default 'queued' check (
    status in ('queued', 'running', 'succeeded', 'failed', 'blocked')
  ),
  requested_by_provider text,
  requested_by_id text,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create index if not exists ingest_jobs_status_idx
  on brain.ingest_jobs (brain_id, status, created_at desc);

create table if not exists brain.sync_events (
  id uuid primary key default gen_random_uuid(),
  brain_id text not null references brain.brains(id) on delete cascade,
  sync_client_id uuid references brain.sync_clients(id) on delete set null,
  event_type text not null,
  filename text,
  revision_id uuid references brain.brain_file_revisions(id),
  duration_ms numeric,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists sync_events_brain_created_idx
  on brain.sync_events (brain_id, created_at desc);

alter table brain.brains enable row level security;
alter table brain.principals enable row level security;
alter table brain.brain_roles enable row level security;
alter table brain.brain_files enable row level security;
alter table brain.brain_file_revisions enable row level security;
alter table brain.sync_clients enable row level security;
alter table brain.sync_file_states enable row level security;
alter table brain.sync_conflicts enable row level security;
alter table brain.sources enable row level security;
alter table brain.source_artifacts enable row level security;
alter table brain.source_artifact_text enable row level security;
alter table brain.source_chunks enable row level security;
alter table brain.ingest_jobs enable row level security;
alter table brain.sync_events enable row level security;

comment on schema brain is
  'Private hosted Brain schema. Access should go through the MCP server/service role, not public Data API clients.';

comment on table brain.source_artifacts is
  'Manifest for original and derived source artifacts. Binary content lives in Supabase Storage or an external canonical system such as SharePoint. The default private Supabase bucket is brain-artifacts when the storage schema is present.';
