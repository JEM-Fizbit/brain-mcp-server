-- Operator-only durable ingestion. Source bytes stay in private artifact custody.
create table brain.ingestion_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_ref text not null,
  brain_id text not null references brain.brains(id) on delete cascade,
  source_id uuid not null,
  artifact_id uuid not null,
  identity_key text not null,
  content_sha256 text not null check (content_sha256 ~ '^[a-f0-9]{64}$'),
  stage text not null default 'prepared' check (stage in
    ('prepared','verified','review','approved','needs_review','blocked','complete')),
  manifest jsonb not null,
  original jsonb,
  extraction jsonb,
  candidate jsonb,
  approval jsonb,
  receipt jsonb,
  lease_token uuid,
  lease_until timestamptz,
  attempts integer not null default 0,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_ref, brain_id, identity_key, content_sha256),
  unique (source_id, content_sha256),
  unique (artifact_id),
  check ((lease_token is null) = (lease_until is null))
);
create index ingestion_jobs_source_idx on brain.ingestion_jobs (source_id, created_at);
alter table brain.ingestion_jobs enable row level security;
revoke all on brain.ingestion_jobs from public, anon, authenticated;
grant select, insert, update, delete on brain.ingestion_jobs to brain_runtime;
create policy brain_runtime_all_ingestion_jobs on brain.ingestion_jobs
  for all to brain_runtime using (true) with check (true);
comment on table brain.ingestion_jobs is
 'Private operator ingestion jobs with owner binding, fenced leases and atomic reviewed-write receipts. No MCP or public client access.';
