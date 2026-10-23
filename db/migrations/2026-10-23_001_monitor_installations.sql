-- Spec 024. Apply separately with each deployment's database owner after approval.
begin;
create table if not exists brain.monitor_installations (
  brain_id text not null references brain.brains(id) on delete cascade,
  provider text not null check(provider in ('github','entra')),
  provider_tenant_id text not null default '',
  provider_user_id text not null check(length(provider_user_id) between 1 and 160),
  installation_id uuid not null,
  app_version text not null check(length(app_version) between 1 and 60),
  build text not null check(build ~ '^[0-9]{1,16}$'),
  source_revision text not null check(source_revision ~ '^[0-9a-f]{40}$'),
  platform text not null check(platform='darwin'),
  arch text not null check(arch in ('arm64','x64')),
  update_mode text not null check(update_mode in ('automatic','mdm','developer')),
  update_state text not null check(update_state in ('current','checking','available','downloaded','deferred','failed','unknown')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key(brain_id,provider,provider_tenant_id,provider_user_id,installation_id)
);
alter table brain.monitor_installations enable row level security;
revoke all on brain.monitor_installations from public,anon,authenticated,brain_runtime;
grant select,insert,update on brain.monitor_installations to brain_runtime;
drop policy if exists brain_runtime_monitor_installations on brain.monitor_installations;
create policy brain_runtime_monitor_installations on brain.monitor_installations
  for all to brain_runtime using(true) with check(true);
create index if not exists monitor_installations_recent on brain.monitor_installations(brain_id,last_seen_at desc);
comment on table brain.monitor_installations is 'Latest authenticated self-reports. No hardware identity, paths, content or tokens. Access grants are separate; last contact is not proof of uninstall.';
commit;
