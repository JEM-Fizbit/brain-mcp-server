import pg from "pg";
import type { OauthStore, StateProvider } from "./state.js";
import { postgresPoolOptions } from "../sync/postgres-revision-store.js";

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
        ? new Pool(
            postgresPoolOptions(poolOrConnectionString, {
              allowExitOnIdle: true,
              maxEnv: "BRAIN_OAUTH_STATE_PG_POOL_MAX",
              defaultMax: 2,
            })
          )
        : poolOrConnectionString;
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
