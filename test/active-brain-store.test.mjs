import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { activeBrainStore, activeStoreStatus } = await import(
  path.join(__dirname, "..", "dist", "services", "active-brain-store.js")
);

async function withEnv(overrides, callback) {
  const old = {};
  for (const key of Object.keys(overrides)) old[key] = process.env[key];
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    return await callback();
  } finally {
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("activeBrainStore reuses Postgres-backed store for stable runtime config", async () => {
  await withEnv(
    {
      BRAIN_REVISION_STORE: "postgres",
      BRAIN_REVISION_DATABASE_URL: "postgresql://postgres@example.invalid/postgres",
    },
    async () => {
      const first = activeBrainStore();
      const second = activeBrainStore();
      assert.equal(first, second);
      assert.equal(activeStoreStatus(), "Revision store: Postgres");
    }
  );
});

test("activeBrainStore refreshes cached store when Postgres connection config changes", async () => {
  await withEnv(
    {
      BRAIN_REVISION_STORE: "postgres",
      BRAIN_REVISION_DATABASE_URL: "postgresql://postgres@example-a.invalid/postgres",
    },
    async () => {
      const first = activeBrainStore();
      process.env.BRAIN_REVISION_DATABASE_URL =
        "postgresql://postgres@example-b.invalid/postgres";
      const second = activeBrainStore();
      assert.notEqual(first, second);
    }
  );
});

test("activeBrainStore shares one Postgres pool across revision and source stores", async () => {
  await withEnv(
    {
      BRAIN_REVISION_STORE: "postgres",
      BRAIN_REVISION_DATABASE_URL: "postgresql://postgres@example-shared.invalid/postgres",
    },
    async () => {
      const store = activeBrainStore();
      assert.equal(store.revisionStore.pool, store.sourceStore.pool);
    }
  );
});
