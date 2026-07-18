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
const allowRuntimeDatabaseUrl =
  process.env.BRAIN_POSTGRES_TEST_ALLOW_RUNTIME_URL === "1";
const databaseUrl =
  testDatabaseUrl ||
  (allowRuntimeDatabaseUrl ? process.env.BRAIN_REVISION_DATABASE_URL : undefined);
const shouldApplyMigration = Boolean(testDatabaseUrl);

test("PostgresRevisionStore compare-and-swap flow", async (t) => {
  if (!databaseUrl) {
    t.skip(
      "set BRAIN_POSTGRES_TEST_DATABASE_URL to run the mutating Postgres integration test"
    );
    return;
  }

  const { PostgresRevisionStore } = await import(
    path.join(__dirname, "..", "dist", "sync", "index.js")
  );
  const store = new PostgresRevisionStore(databaseUrl);
  const brainId = `test-brain-${Date.now()}`;

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

    const duplicate = await store.recordConflict({
      brainId: conflicts[0].brainId,
      filename: conflicts[0].filename,
      localBaseRevisionId: conflicts[0].localBaseRevisionId,
      remoteHeadRevisionId: conflicts[0].remoteHeadRevisionId,
      localContentHash: conflicts[0].localContentHash,
      remoteContentHash: conflicts[0].remoteContentHash,
      localOrigin: conflicts[0].localOrigin,
      remoteOrigin: conflicts[0].remoteOrigin,
      localActor: conflicts[0].localActor,
      remoteActor: conflicts[0].remoteActor,
    });
    assert.equal(duplicate.conflictId, conflicts[0].conflictId);
    assert.equal((await store.listConflicts(brainId, "open")).length, 1);

    const resolved = await store.resolveConflict({
      brainId,
      conflictId: conflicts[0].conflictId,
      content: "postgres resolved\n",
      actor: { provider: "test", id: "resolver" },
    });
    assert.equal(resolved.conflict.status, "resolved");
    assert.equal(
      resolved.conflict.resolutionRevisionId,
      resolved.revision.revisionId
    );
    assert.equal(resolved.revision.content, "postgres resolved\n");
    assert.equal((await store.listConflicts(brainId, "open")).length, 0);
    assert.equal((await store.listConflicts(brainId, "resolved")).length, 1);
    assert.equal((await store.readFile(brainId, "NOW.md")).content, "postgres resolved\n");
  } finally {
    await store.pool.query("delete from brain.brains where id = $1", [brainId]).catch(
      () => undefined
    );
    await store.close();
  }
});

test("PostgresRevisionStore delete/tombstone flow (spec 011)", async (t) => {
  if (!databaseUrl) {
    t.skip("set BRAIN_POSTGRES_TEST_DATABASE_URL to run the mutating Postgres integration test");
    return;
  }

  const { PostgresRevisionStore } = await import(
    path.join(__dirname, "..", "dist", "sync", "index.js")
  );
  const { FileDeletedError } = await import(
    path.join(__dirname, "..", "dist", "sync", "types.js")
  );
  const store = new PostgresRevisionStore(databaseUrl);
  const brainId = `test-brain-del-${Date.now()}`;

  try {
    if (shouldApplyMigration) {
      for (const file of [
        "2026-06-14_001_hosted_brain_postgres.sql",
        "2026-07-08_001_brain_file_tombstones.sql",
      ]) {
        const sql = await fs.readFile(
          path.join(__dirname, "..", "db", "migrations", file),
          "utf-8"
        );
        await store.pool.query(sql);
      }
    }
    await store.pool.query(
      `insert into brain.brains (id, type, template_used, integration_mode)
       values ($1, 'personal', 'personal', 'vertical')`,
      [brainId]
    );

    const created = await store.proposeRevision({
      brainId,
      filename: "note.md",
      baseRevisionId: null,
      content: "# hi\n",
      origin: "hosted_mcp",
    });
    assert.equal(created.status, "accepted");

    const updated = await store.proposeRevision({
      brainId,
      filename: "note.md",
      baseRevisionId: created.head.revisionId,
      content: "# newer\n",
      origin: "hosted_mcp",
    });
    assert.equal(updated.status, "accepted");

    // Stale-base delete conflicts (never silent).
    const staleDelete = await store.proposeDeletion({
      brainId,
      filename: "note.md",
      baseRevisionId: created.head.revisionId,
      origin: "local_agent",
    });
    assert.equal(staleDelete.ok, false);
    assert.equal(staleDelete.status, "conflict");

    // Real delete.
    const del = await store.proposeDeletion({
      brainId,
      filename: "note.md",
      baseRevisionId: updated.head.revisionId,
      origin: "local_agent",
    });
    assert.equal(del.status, "accepted");
    assert.equal(del.head.deleted, true);

    // Excluded from default listFiles; visible with includeDeleted.
    assert.equal(
      (await store.listFiles(brainId)).find((f) => f.filename === "note.md"),
      undefined
    );
    assert.equal(
      (await store.listFiles(brainId, { includeDeleted: true })).find(
        (f) => f.filename === "note.md"
      )?.deleted,
      true
    );

    // readFile throws FileDeletedError.
    await assert.rejects(
      () => store.readFile(brainId, "note.md"),
      (err) => err instanceof FileDeletedError
    );

    // Re-delete is idempotent.
    assert.equal(
      (
        await store.proposeDeletion({
          brainId,
          filename: "note.md",
          baseRevisionId: del.head.revisionId,
          origin: "local_agent",
        })
      ).status,
      "unchanged"
    );

    // Recreate over the tombstone with base=null is accepted, not a conflict.
    const recreated = await store.proposeRevision({
      brainId,
      filename: "note.md",
      baseRevisionId: null,
      content: "# back\n",
      origin: "hosted_mcp",
    });
    assert.equal(recreated.status, "accepted");
    assert.equal((await store.readFile(brainId, "note.md")).content, "# back\n");
    assert.equal(
      (await store.listFiles(brainId)).find((f) => f.filename === "note.md")?.deleted ?? false,
      false
    );
  } finally {
    await store.pool.query("delete from brain.brains where id = $1", [brainId]).catch(
      () => undefined
    );
    await store.close();
  }
});

test("PostgresRevisionStore atomic rename flow (spec 011)", async (t) => {
  if (!databaseUrl) {
    t.skip("set BRAIN_POSTGRES_TEST_DATABASE_URL to run the mutating Postgres integration test");
    return;
  }
  const { PostgresRevisionStore } = await import(
    path.join(__dirname, "..", "dist", "sync", "index.js")
  );
  const store = new PostgresRevisionStore(databaseUrl);
  const brainId = `test-brain-rename-${Date.now()}`;
  try {
    if (shouldApplyMigration) {
      for (const file of [
        "2026-06-14_001_hosted_brain_postgres.sql",
        "2026-07-08_001_brain_file_tombstones.sql",
      ]) {
        await store.pool.query(
          await fs.readFile(path.join(__dirname, "..", "db", "migrations", file), "utf-8")
        );
      }
    }
    await store.pool.query(
      `insert into brain.brains (id, type, template_used, integration_mode)
       values ($1, 'personal', 'personal', 'vertical')`,
      [brainId]
    );

    const created = await store.proposeRevision({
      brainId,
      filename: "old.md",
      baseRevisionId: null,
      content: "# body\n",
      origin: "hosted_mcp",
    });

    // Rename onto a live target conflicts (source untouched).
    await store.proposeRevision({
      brainId,
      filename: "taken.md",
      baseRevisionId: null,
      content: "other\n",
      origin: "hosted_mcp",
    });
    const blocked = await store.proposeRename({
      brainId,
      from: "old.md",
      to: "taken.md",
      baseRevisionId: created.head.revisionId,
      origin: "local_agent",
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.status, "conflict");
    assert.equal((await store.getHead(brainId, "old.md")).deleted ?? false, false);

    // Clean rename: content moves, pairing recorded, old tombstoned.
    const renamed = await store.proposeRename({
      brainId,
      from: "old.md",
      to: "new.md",
      baseRevisionId: created.head.revisionId,
      origin: "local_agent",
    });
    assert.equal(renamed.status, "accepted");
    assert.equal(renamed.head.renamedFrom, "old.md");
    assert.equal((await store.readFile(brainId, "new.md")).content, "# body\n");
    const oldHead = await store.getHead(brainId, "old.md");
    assert.equal(oldHead.deleted, true);
    assert.equal(oldHead.renamedTo, "new.md");
    assert.equal(
      (await store.listFiles(brainId)).find((f) => f.filename === "old.md"),
      undefined
    );

    // Stale-base rename conflicts and creates no duplicate head.
    const stale = await store.proposeRename({
      brainId,
      from: "new.md",
      to: "newer.md",
      baseRevisionId: created.head.revisionId,
      origin: "local_agent",
    });
    assert.equal(stale.ok, false);
    assert.equal(await store.getHead(brainId, "newer.md"), null);
  } finally {
    await store.pool.query("delete from brain.brains where id = $1", [brainId]).catch(
      () => undefined
    );
    await store.close();
  }
});
