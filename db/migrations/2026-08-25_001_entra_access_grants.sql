-- Entra-backed workforce access and audited in-app role administration.
--
-- The existing brain.principals / brain.brain_roles tables remain the private
-- authorization ledger. This migration adds tenant-stable identity, explicit
-- grant status/source/version fields, and an append-only metadata audit trail.

alter table brain.principals
  add column if not exists provider_tenant_id text not null default '';

alter table brain.principals
  drop constraint if exists principals_provider_provider_user_id_key;

create unique index if not exists principals_provider_tenant_user_idx
  on brain.principals (provider, provider_tenant_id, provider_user_id);

alter table brain.brain_roles
  add column if not exists status text not null default 'active',
  add column if not exists role_source text not null default 'registry',
  add column if not exists upstream_role text,
  add column if not exists upstream_group_id text,
  add column if not exists version bigint not null default 1;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'brain.brain_roles'::regclass
      and conname = 'brain_roles_status_check'
  ) then
    alter table brain.brain_roles
      add constraint brain_roles_status_check
      check (status in ('active', 'suspended', 'revoked'));
  end if;
end $$;

create index if not exists brain_roles_active_principal_idx
  on brain.brain_roles (principal_id, brain_id)
  where status = 'active';

create table if not exists brain.access_audit_events (
  id uuid primary key default gen_random_uuid(),
  brain_id text not null references brain.brains(id),
  actor_provider text not null,
  actor_tenant_id text not null default '',
  actor_user_id text not null,
  target_principal_id uuid not null references brain.principals(id),
  action text not null check (
    action in ('grant', 'change', 'suspend', 'reinstate', 'revoke', 'reconcile')
  ),
  old_role text check (old_role is null or old_role in ('owner', 'admin', 'member', 'reader')),
  new_role text check (new_role is null or new_role in ('owner', 'admin', 'member', 'reader')),
  old_status text check (old_status is null or old_status in ('active', 'suspended', 'revoked')),
  new_status text check (new_status is null or new_status in ('active', 'suspended', 'revoked')),
  reason text,
  graph_outcome text,
  graph_request_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists access_audit_events_brain_created_idx
  on brain.access_audit_events (brain_id, created_at desc);

alter table brain.access_audit_events enable row level security;

drop policy if exists brain_runtime_access_audit_events
  on brain.access_audit_events;

revoke delete on brain.principals from brain_runtime;
revoke delete on brain.brain_roles from brain_runtime;
revoke update, delete on brain.access_audit_events from brain_runtime;

grant select, insert, update on brain.principals to brain_runtime;
grant select, insert, update on brain.brain_roles to brain_runtime;
grant select, insert on brain.access_audit_events to brain_runtime;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'brain'
      and tablename = 'access_audit_events'
      and policyname = 'brain_runtime_select_access_audit_events'
  ) then
    create policy brain_runtime_select_access_audit_events
      on brain.access_audit_events
      for select
      to brain_runtime
      using (true);
  end if;
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'brain'
      and tablename = 'access_audit_events'
      and policyname = 'brain_runtime_insert_access_audit_events'
  ) then
    create policy brain_runtime_insert_access_audit_events
      on brain.access_audit_events
      for insert
      to brain_runtime
      with check (true);
  end if;
end $$;

revoke all on table brain.access_audit_events from public;
revoke all on table brain.access_audit_events from anon;
revoke all on table brain.access_audit_events from authenticated;

comment on column brain.principals.provider_tenant_id is
  'Stable provider tenant identifier. Required for Entra authorization; empty only for providers without a tenant concept.';

comment on table brain.access_audit_events is
  'Private metadata-only audit of access changes. Must never contain Graph tokens, Brain content, request bodies, secrets, or mutable display claims as authority.';
