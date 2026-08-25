import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { PostgresAccessGrantStore } = await import(path.join(__dirname, "..", "dist", "services", "access-grants.js"));

const tenant = "11111111-1111-4111-8111-111111111111";
const objectId = "22222222-2222-4222-8222-222222222222";
const principal = { provider: "entra", providerTenantId: tenant, providerUserId: objectId };

test("grant lookup is keyed by exact provider, tenant, and object ID", async () => {
  let params;
  const pool = {
    async query(_sql, values) { params = values; return { rows: [{ brain_id: "ers-brain", role: "reader" }] }; },
    async end() {},
  };
  const store = new PostgresAccessGrantStore(pool);
  assert.deepEqual(await store.rolesForPrincipal(principal), { "ers-brain": "reader" });
  assert.deepEqual(params, ["entra", tenant, objectId]);
});

test("grant store refuses to reduce the active Owner roster below two", async () => {
  const queries = [];
  const client = {
    async query(sql) {
      const normalized = String(sql).replace(/\s+/g, " ").trim();
      queries.push(normalized);
      if (normalized.startsWith("select id from brain.brains")) return { rows: [{ id: "ers-brain" }] };
      if (normalized.startsWith("insert into brain.principals")) return { rows: [{ id: "principal-id" }] };
      if (normalized.startsWith("select role, status, version")) return { rows: [{ role: "owner", status: "active", version: 1 }] };
      if (normalized.startsWith("select count(*)::int as count")) return { rows: [{ count: 2 }] };
      return { rows: [] };
    },
    release() { queries.push("release"); },
  };
  const pool = { async connect() { return client; }, async end() {} };
  const store = new PostgresAccessGrantStore(pool);
  await assert.rejects(
    () => store.applyMutation({
      brainId: "ers-brain",
      target: principal,
      role: "reader",
      status: "active",
      roleSource: "entra_group",
      actor: { ...principal, providerUserId: "33333333-3333-4333-8333-333333333333" },
    }),
    /below two/
  );
  assert.ok(queries.includes("rollback"));
  assert.ok(queries.some((query) => query.includes("p.provider = $2") && query.includes("p.provider_tenant_id = $3")));
  assert.ok(!queries.some((query) => query.startsWith("insert into brain.brain_roles")));
});
