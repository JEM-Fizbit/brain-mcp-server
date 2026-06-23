-- Durable OAuth client/session state for hosted MCP connectors.
--
-- Brain content and operational telemetry already live in Postgres. Hosted
-- connector enrollment must live there too, otherwise a Fly machine replacement
-- can strand cloud-synced clients with refresh tokens the server no longer
-- recognizes.

create table if not exists brain.oauth_state (
  store text not null check (
    store in ('clients', 'auth_codes', 'refresh_tokens', 'oauth_states')
  ),
  state_key text not null,
  value jsonb not null,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (store, state_key)
);

create index if not exists oauth_state_expires_idx
  on brain.oauth_state (expires_at)
  where expires_at is not null;

alter table brain.oauth_state enable row level security;

grant select, insert, update, delete on brain.oauth_state to brain_runtime;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'brain'
      and tablename = 'oauth_state'
      and policyname = 'brain_runtime_all_oauth_state'
  ) then
    create policy brain_runtime_all_oauth_state
      on brain.oauth_state
      for all
      to brain_runtime
      using (true)
      with check (true);
  end if;
end $$;

revoke all on table brain.oauth_state from public;
revoke all on table brain.oauth_state from anon;
revoke all on table brain.oauth_state from authenticated;

comment on table brain.oauth_state is
  'Private OAuth client, authorization-code, state, and refresh-token records for hosted MCP connectors. Values are server-side auth metadata, not Brain content, and must not be exposed through public Data API roles.';

comment on column brain.oauth_state.value is
  'Bounded OAuth metadata stored as JSONB. Must never contain access tokens, request bodies, Brain file content, SQL text, or connector payload content.';
