// NOTE: run pg-gated test files serially (node --test-concurrency=1) against a
// shared test database — the gated files each apply migration 001, and
// concurrent DDL + row/advisory locks across files can deadlock the victim.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { loadLocalEnv } = await import(
  path.join(__dirname, "..", "scripts", "lib", "load-local-env.mjs")
);

loadLocalEnv(path.join(__dirname, ".."));
const testDatabaseUrl = process.env.BRAIN_POSTGRES_TEST_DATABASE_URL;
const shouldApplyMigration = Boolean(testDatabaseUrl);

test("concurrent first-creation of the same file never double-accepts", async (t) => {
  if (!testDatabaseUrl) {
    t.skip(
      "set BRAIN_POSTGRES_TEST_DATABASE_URL to run the mutating Postgres integration test"
    );
    return;
  }

  const { PostgresRevisionStore } = await import(
    path.join(__dirname, "..", "dist", "sync", "index.js")
  );
  const store = new PostgresRevisionStore(testDatabaseUrl);
  const brainId = `test-race-${Date.now()}`;

  try {
    if (shouldApplyMigration) {
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
      await store.pool.query(migration);
    }
    await store.pool.query(
      `
        insert into brain.brains (id, type, template_used, integration_mode)
        values ($1, 'personal', 'personal', 'vertical')
      `,
      [brainId]
    );

    // The race window is transaction interleaving before the head row exists.
    // Repeat concurrent creation across many filenames; the invariant must
    // hold on every attempt: exactly one accepted, the loser conflicts, and
    // the head matches the accepted content.
    for (let attempt = 0; attempt < 15; attempt += 1) {
      const filename = `race-${attempt}.md`;
      const [a, b] = await Promise.all([
        store.proposeRevision({
          brainId,
          filename,
          baseRevisionId: null,
          content: `writer A attempt ${attempt}\n`,
          origin: "hosted_mcp",
        }),
        store.proposeRevision({
          brainId,
          filename,
          baseRevisionId: null,
          content: `writer B attempt ${attempt}\n`,
          origin: "local_agent",
        }),
      ]);

      const accepted = [a, b].filter((r) => r.status === "accepted");
      const conflicts = [a, b].filter((r) => r.status === "conflict");
      assert.equal(
        accepted.length,
        1,
        `attempt ${attempt}: expected exactly one accepted creation, got ` +
          `${accepted.length} (statuses: ${a.status}/${b.status})`
      );
      assert.equal(conflicts.length, 1, `attempt ${attempt}: loser must conflict`);

      const head = await store.readFile(brainId, filename);
      assert.equal(
        head.content,
        accepted[0].revision.content,
        `attempt ${attempt}: head must match the accepted revision`
      );
      assert.equal(
        accepted[0].revision.parentRevisionId ?? null,
        null,
        `attempt ${attempt}: the accepted first revision has no parent`
      );
    }
  } finally {
    await store.pool.query(`delete from brain.brains where id = $1`, [brainId]);
    await store.close?.();
  }
});
