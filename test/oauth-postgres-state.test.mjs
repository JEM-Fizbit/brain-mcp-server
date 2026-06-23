import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { PostgresStateProvider } = await import(
  path.join(__dirname, "..", "dist", "oauth", "postgres-state.js")
);

class FakePool {
  rows = new Map();

  rowKey(store, key) {
    return `${store}\0${key}`;
  }

  async query(sql, params) {
    const normalized = sql.replace(/\s+/g, " ").trim().toLowerCase();
    if (normalized.startsWith("insert into brain.oauth_state")) {
      const [store, key, rawValue, expiresAt] = params;
      const parsedValue = JSON.parse(rawValue);
      const rowKey = this.rowKey(store, key);
      const existing = this.rows.get(rowKey);
      this.rows.set(rowKey, {
        store,
        state_key: key,
        value: parsedValue,
        expires_at: expiresAt,
        created_at: existing?.created_at || new Date(),
        updated_at: new Date(),
      });
      return { rowCount: 1, rows: [] };
    }

    if (
      normalized.startsWith("select value, expires_at") &&
      normalized.includes("where store = $1") &&
      normalized.includes("state_key = $2")
    ) {
      const [store, key] = params;
      const row = this.rows.get(this.rowKey(store, key));
      if (!row || isExpired(row.expires_at)) return { rowCount: 0, rows: [] };
      return { rowCount: 1, rows: [{ value: row.value, expires_at: row.expires_at }] };
    }

    if (
      normalized.startsWith("delete from brain.oauth_state") &&
      normalized.includes("returning value")
    ) {
      const [store, key] = params;
      const rowKey = this.rowKey(store, key);
      const row = this.rows.get(rowKey);
      this.rows.delete(rowKey);
      return row
        ? { rowCount: 1, rows: [{ value: row.value, expires_at: row.expires_at }] }
        : { rowCount: 0, rows: [] };
    }

    if (
      normalized.startsWith("delete from brain.oauth_state") &&
      normalized.includes("expires_at <= now()")
    ) {
      const [store] = params;
      let count = 0;
      for (const [key, row] of this.rows.entries()) {
        if (row.store === store && isExpired(row.expires_at)) {
          this.rows.delete(key);
          count += 1;
        }
      }
      return { rowCount: count, rows: [] };
    }

    if (normalized.startsWith("delete from brain.oauth_state")) {
      const [store, key] = params;
      const deleted = this.rows.delete(this.rowKey(store, key));
      return { rowCount: deleted ? 1 : 0, rows: [] };
    }

    if (normalized.startsWith("select state_key, value")) {
      const [store] = params;
      const rows = [...this.rows.values()]
        .filter((row) => row.store === store && !isExpired(row.expires_at))
        .sort((left, right) => left.state_key.localeCompare(right.state_key))
        .map((row) => ({ state_key: row.state_key, value: row.value }));
      return { rowCount: rows.length, rows };
    }

    throw new Error(`Unhandled SQL in fake pool: ${sql}`);
  }

  async end() {}
}

function isExpired(expiresAt) {
  return Boolean(expiresAt && expiresAt.getTime() <= Date.now());
}

test("Postgres OAuth state provider preserves StateProvider semantics", async () => {
  const pool = new FakePool();
  const state = new PostgresStateProvider(pool);
  const future = Math.floor(Date.now() / 1000) + 60;
  const past = Math.floor(Date.now() / 1000) - 60;

  await state.put("clients", "client-1", { client_id: "client-1" });
  await state.put("refresh_tokens", "refresh-1", {
    client_id: "client-1",
    expires_at: future,
  });
  await state.put("refresh_tokens", "expired", {
    client_id: "client-1",
    expires_at: past,
  });

  assert.deepEqual(await state.get("clients", "client-1"), {
    client_id: "client-1",
  });
  assert.equal(await state.get("refresh_tokens", "expired"), null);

  const consumed = await state.consumeOnce("refresh_tokens", "refresh-1");
  assert.equal(consumed.client_id, "client-1");
  assert.equal(await state.consumeOnce("refresh_tokens", "refresh-1"), null);

  assert.deepEqual(await state.listAll("clients"), {
    "client-1": { client_id: "client-1" },
  });
  assert.equal(await state.del("clients", "client-1"), true);
  assert.equal(await state.get("clients", "client-1"), null);
});
