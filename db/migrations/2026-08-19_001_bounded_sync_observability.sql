-- Bound internal Brain monitoring IO without weakening liveness detection.
--
-- Sync liveness is current state, not an event stream. Keep one row per Brain
-- and reserve sync_events for transitions and real hosted operations.

create table if not exists brain.sync_heartbeats (
  brain_id text primary key references brain.brains(id) on delete cascade,
  duration_ms numeric(12, 3),
  metadata jsonb not null default '{}'::jsonb,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sync_heartbeats_duration_nonnegative
    check (duration_ms is null or duration_ms >= 0)
);

alter table brain.sync_heartbeats enable row level security;

grant select, insert, update, delete on brain.sync_heartbeats to brain_runtime;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'brain'
      and tablename = 'sync_heartbeats'
      and policyname = 'brain_runtime_all_sync_heartbeats'
  ) then
    create policy brain_runtime_all_sync_heartbeats
      on brain.sync_heartbeats
      for all
      to brain_runtime
      using (true)
      with check (true);
  end if;
end $$;

revoke all on table brain.sync_heartbeats from public;
revoke all on table brain.sync_heartbeats from anon;
revoke all on table brain.sync_heartbeats from authenticated;

-- Keep the operational index small by excluding the historical heartbeat
-- flood. Doctor queries use only these metadata-only hosted event types.
create index if not exists sync_events_hosted_observability_idx
  on brain.sync_events (brain_id, event_type, created_at desc)
  where event_type in (
    'hosted_mcp_latency',
    'hosted_mcp_auth',
    'hosted_mcp_auth_alert'
  );

comment on table brain.sync_heartbeats is
  'Current per-Brain local sync liveness. One upserted metadata-only row replaces append-only per-cycle heartbeat events.';

comment on column brain.sync_heartbeats.metadata is
  'Bounded sync counts and timing classification only. Must not contain filenames, Brain content, SQL text, or query parameters.';
