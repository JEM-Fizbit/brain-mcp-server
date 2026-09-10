import type { RegistrationLimits } from "./admission.js";
import pg from "pg";
import type { OauthStore, StateProvider } from "./state.js";
import { postgresPoolOptions } from "../sync/postgres-revision-store.js";
import { attachPoolErrorLogger } from "../services/pg-pool.js";

const { Pool } = pg;
type Pool = pg.Pool;

function expiresAt(value: any): Date | null {
  const epochSeconds = Number(value?.expires_at);
  if (!Number.isFinite(epochSeconds) || epochSeconds <= 0) return null;
  return new Date(epochSeconds * 1000);
}

function isExpired(date: Date | null): boolean {
  return Boolean(date && date.getTime() <= Date.now());
}

export class PostgresStateProvider implements StateProvider {
  readonly pool: Pool;

  constructor(poolOrConnectionString: Pool | string) {
    this.pool =
      typeof poolOrConnectionString === "string"
        ? attachPoolErrorLogger(
            new Pool(
              postgresPoolOptions(poolOrConnectionString, {
                allowExitOnIdle: true,
                maxEnv: "BRAIN_OAUTH_STATE_PG_POOL_MAX",
                defaultMax: 2,
              })
            ),
            "oauth_state"
          )
        : poolOrConnectionString;
  }

  async registerClient(key: string, value: any, limits: RegistrationLimits): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock(hashtext('brain.oauth.registration'))");
      const counts = await client.query(`select count(*)::int as total,
        count(*) filter (where created_at > now() - interval '1 hour')::int as recent
        from brain.oauth_state where store = 'clients'`);
      if (Number(counts.rows[0].total) >= limits.maximumClients || Number(counts.rows[0].recent) >= limits.perHour) {
        await client.query("rollback");
        return false;
      }
      await client.query(`insert into brain.oauth_state (store, state_key, value, expires_at, updated_at)
        values ('clients', $1, $2::jsonb, null, now())`, [key, JSON.stringify(value)]);
      await client.query("commit");
      return true;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  async cleanupExpired(limit = 500): Promise<number> {
    const bounded = Math.max(1, Math.min(5000, Math.floor(limit)));
    const result = await this.pool.query(`delete from brain.oauth_state where ctid in (
      select ctid from brain.oauth_state
      where store in ('auth_codes', 'refresh_tokens', 'oauth_states')
        and expires_at is not null and expires_at <= now()
      order by expires_at limit $1 for update skip locked
    )`, [bounded]);
    return Number(result.rowCount || 0);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async get(store: OauthStore, key: string): Promise<any | null> {
    const result = await this.pool.query(
      `
        select value, expires_at
        from brain.oauth_state
        where store = $1
          and state_key = $2
          and (expires_at is null or expires_at > now())
      `,
      [store, key]
    );
    return result.rows[0]?.value || null;
  }

  async put(store: OauthStore, key: string, value: any): Promise<any> {
    await this.pool.query(
      `
        insert into brain.oauth_state (
          store,
          state_key,
          value,
          expires_at,
          updated_at
        )
        values ($1, $2, $3::jsonb, $4, now())
        on conflict (store, state_key) do update
        set value = excluded.value,
            expires_at = excluded.expires_at,
            updated_at = now()
      `,
      [store, key, JSON.stringify(value), expiresAt(value)]
    );
    return value;
  }

  async del(store: OauthStore, key: string): Promise<boolean> {
    const result = await this.pool.query(
      `
        delete from brain.oauth_state
        where store = $1 and state_key = $2
      `,
      [store, key]
    );
    return Number(result.rowCount || 0) > 0;
  }

  async consumeOnce(store: OauthStore, key: string): Promise<any | null> {
    const result = await this.pool.query(
      `
        delete from brain.oauth_state
        where store = $1 and state_key = $2
        returning value, expires_at
      `,
      [store, key]
    );
    const row = result.rows[0];
    if (!row || isExpired(row.expires_at)) return null;
    return row.value || null;
  }

  async listAll(store: OauthStore): Promise<Record<string, any>> {
    await this.pool.query(
      `
        delete from brain.oauth_state
        where store = $1
          and expires_at is not null
          and expires_at <= now()
      `,
      [store]
    );
    const result = await this.pool.query(
      `
        select state_key, value
        from brain.oauth_state
        where store = $1
          and (expires_at is null or expires_at > now())
        order by state_key
      `,
      [store]
    );
    return Object.fromEntries(
      result.rows.map((row: { state_key: string; value: any }) => [
        row.state_key,
        row.value,
      ])
    );
  }
}

export function makePostgresStateProvider(
  poolOrConnectionString: Pool | string
): StateProvider {
  return new PostgresStateProvider(poolOrConnectionString);
}
