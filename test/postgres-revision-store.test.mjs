import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const databaseUrl = process.env.BRAIN_REVISION_DATABASE_URL;

test("PostgresRevisionStore compare-and-swap flow", async (t) => {
  if (!databaseUrl) {
    t.skip("set BRAIN_REVISION_DATABASE_URL to run Postgres integration test");
    return;
  }

  const { PostgresRevisionStore } = await import(
    path.join(__dirname, "..", "dist", "sync", "index.js")
  );
  const migration = await fs.readFile(
    path.join(
      __dirname,
      "..",
      "db",
      "migrations",
      "2026-06-14_001_hosted_brain_postgres.sql"
    ),
    "utf-8"
  );
  const store = new PostgresRevisionStore(databaseUrl);
  const brainId = `test-brain-${Date.now()}`;

  try {
    await store.pool.query(migration);
    await store.pool.query(
      `
        insert into brain.brains (id, type, template_used, integration_mode)
        values ($1, 'personal', 'personal', 'vertical')
      `,
      [brainId]
    );

    const first = await store.proposeRevision({
      brainId,
      filename: "NOW.md",
      baseRevisionId: null,
      content: "postgres first\n",
      origin: "hosted_mcp",
    });
    assert.equal(first.ok, true);
    assert.equal(first.status, "accepted");

    const second = await store.proposeRevision({
      brainId,
      filename: "NOW.md",
      baseRevisionId: first.head.revisionId,
      content: "postgres second\n",
      origin: "local_agent",
    });
    assert.equal(second.ok, true);
    assert.equal(second.status, "accepted");

    const stale = await store.proposeRevision({
      brainId,
      filename: "NOW.md",
      baseRevisionId: first.head.revisionId,
      content: "postgres stale\n",
      origin: "hosted_mcp",
    });
    assert.equal(stale.ok, false);
    assert.equal(stale.status, "conflict");

    const current = await store.readFile(brainId, "NOW.md");
    assert.equal(current.content, "postgres second\n");

    const conflicts = await store.listConflicts(brainId, "open");
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].filename, "NOW.md");
  } finally {
    await store.pool.query("delete from brain.brains where id = $1", [brainId]).catch(
      () => undefined
    );
    await store.close();
  }
});
