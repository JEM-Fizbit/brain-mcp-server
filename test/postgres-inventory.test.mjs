import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PostgresRevisionStore, LocalSyncAgent } from '../dist/sync/index.js';

// Deliberately no ambient/profile or production-URL fallback.
const url = process.env.BRAIN_POSTGRES_TEST_DATABASE_URL;
test('metadata inventory preserves full heads and bidirectional sync on Postgres',
  { skip: !url && 'requires an isolated BRAIN_POSTGRES_TEST_DATABASE_URL' }, async () => {
  const store = new PostgresRevisionStore(url);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'brain-inventory-'));
  const ids = [`inventory-a-${Date.now()}`, `inventory-b-${Date.now()}`];
  try {
    for (const migration of ['2026-06-14_001_hosted_brain_postgres.sql', '2026-07-08_001_brain_file_tombstones.sql']) {
      await store.pool.query(await fs.readFile(new URL(`../db/migrations/${migration}`, import.meta.url), 'utf8'));
    }
    for (const brainId of ids) {
      await store.pool.query("insert into brain.brains(id,type,template_used,integration_mode) values($1,'personal','personal','vertical')", [brainId]);
      const write = async (filename, content) => {
        const base = await store.getHead(brainId, filename);
        const r = await store.proposeRevision({ brainId, filename, content,
          baseRevisionId: base?.revisionId ?? null, origin: 'hosted_mcp',
          actor: { provider: 'test', id: brainId, name: 'Fixture', email: 'fixture@example.invalid' } });
        assert.equal(r.ok, true); return r.head;
      };
      const fixtures = new Map([
        ['00_loader.md', '# Loader\n'], ['NOW.md', '# Now\n'],
        ['empty.md', ''], ['unicode.md', 'é🙂漢字\r\nsecond\n\n'],
        ['single.md', 'one'], ['large.md', 'x'.repeat(200000)],
        // Keep a single deletion below the existing 10% mass-delete guard.
        ['stable-a.md', 'a'], ['stable-b.md', 'b'], ['stable-c.md', 'c'],
      ]);
      for (const [name, content] of fixtures) await write(name, content);
      const removed = await write('deleted.md', 'retained history');
      await store.proposeDeletion({ brainId, filename: 'deleted.md', baseRevisionId: removed.revisionId, origin: 'hosted_mcp' });
      const renamed = await write('old.md', 'rename body');
      await store.proposeRename({ brainId, from: 'old.md', to: 'new.md', baseRevisionId: renamed.revisionId, origin: 'hosted_mcp' });
      // Large evidence metadata must not ride along with every inventory.
      await store.pool.query("update brain.brain_file_revisions set metadata=metadata || jsonb_build_object('writeContext', repeat('evidence', 10000)) where brain_id=$1", [brainId]);

      const originalQuery = store.pool.query.bind(store.pool);
      let rawInventory;
      store.pool.query = async (...args) => {
        const result = await originalQuery(...args);
        if (typeof args[0] === 'string' && args[0].includes('as line_count')) rawInventory = result;
        return result;
      };
      const all = await store.listFiles(brainId, { includeDeleted: true });
      store.pool.query = originalQuery;
      assert.ok(rawInventory);
      assert.ok(!rawInventory.fields.some(f => ['content', 'metadata', 'parent_revision_id'].includes(f.name)));
      assert.ok(Buffer.byteLength(JSON.stringify(rawInventory.rows)) < 15000);
      const ordered = (await originalQuery('select filename from brain.brain_files where brain_id=$1 order by filename', [brainId])).rows.map(r => r.filename);
      assert.deepEqual(all.map(h => h.filename), ordered);
      for (const head of all) {
        assert.deepEqual(head, await store.getHead(brainId, head.filename));
        assert.equal(head.brainId, brainId);
      }
      const live = await store.listFiles(brainId);
      assert.deepEqual(live, all.filter(h => !h.deleted));

      const brainDir = path.join(root, brainId, 'brain');
      await fs.mkdir(brainDir, { recursive: true });
      const agent = new LocalSyncAgent({ brainId, brainDir,
        stateFile: path.join(root, brainId, 'state.json'), store,
        actor: { provider: 'test', id: brainId } });
      const initial = await agent.pullHostedChanges();
      assert.equal(initial.conflicts.length, 0);
      for (const [name, content] of fixtures) assert.equal(await fs.readFile(path.join(brainDir, name), 'utf8'), content);
      assert.equal(await fs.readFile(path.join(brainDir, 'new.md'), 'utf8'), 'rename body');
      const readRevision = store.readRevision.bind(store);
      let downloads = 0;
      store.readRevision = async (...args) => { downloads++; return readRevision(...args); };
      await agent.pullHostedChanges();
      assert.equal(downloads, 0, 'unchanged polling must not fetch file content');
      await write('unicode.md', 'updated remotely 🙂\n');
      await agent.pullHostedChanges();
      assert.equal(downloads, 1, 'only the changed file should be downloaded');
      store.readRevision = readRevision;
      await fs.writeFile(path.join(brainDir, 'single.md'), 'local edit');
      await agent.pushLocalChanges();
      assert.equal((await store.readFile(brainId, 'single.md')).content, 'local edit');
      await fs.writeFile(path.join(brainDir, 'local-new.md'), 'local create');
      await agent.pushLocalChanges();
      assert.equal((await store.readFile(brainId, 'local-new.md')).content, 'local create');
      await fs.rename(path.join(brainDir, 'local-new.md'), path.join(brainDir, 'local-renamed.md'));
      await agent.pushLocalChanges();
      await agent.pushLocalChanges(); // deletion inference requires two absent scans
      assert.equal((await store.readFile(brainId, 'local-renamed.md')).content, 'local create');
      assert.equal((await store.getHead(brainId, 'local-new.md')).deleted, true);
      await fs.unlink(path.join(brainDir, 'local-renamed.md'));
      await agent.pushLocalChanges();
      await agent.pushLocalChanges();
      assert.equal((await store.getHead(brainId, 'local-renamed.md')).deleted, true);
      const remoteRename = await store.getHead(brainId, 'new.md');
      await store.proposeRename({ brainId, from: 'new.md', to: 'moved.md', baseRevisionId: remoteRename.revisionId, origin: 'hosted_mcp' });
      await agent.pullHostedChanges();
      assert.equal(await fs.readFile(path.join(brainDir, 'moved.md'), 'utf8'), 'rename body');
      await assert.rejects(fs.access(path.join(brainDir, 'new.md')));
      const remoteDelete = await store.getHead(brainId, 'large.md');
      await store.proposeDeletion({ brainId, filename: 'large.md', baseRevisionId: remoteDelete.revisionId, origin: 'hosted_mcp' });
      await agent.pullHostedChanges();
      await assert.rejects(fs.access(path.join(brainDir, 'large.md')));
      await fs.writeFile(path.join(brainDir, 'single.md'), 'unsynced local');
      await write('single.md', 'concurrent remote');
      const conflict = await agent.pullHostedChanges();
      assert.ok(conflict.conflicts.length > 0);
      assert.equal(await fs.readFile(path.join(brainDir, 'single.md'), 'utf8'), 'unsynced local');
      assert.equal((await store.readFile(brainId, 'single.md')).content, 'concurrent remote');
    }
    assert.ok((await store.listFiles(ids[0])).every(h => h.brainId === ids[0]));
    assert.ok((await store.listFiles(ids[1])).every(h => h.brainId === ids[1]));
  } finally {
    for (const id of ids) await store.pool.query('delete from brain.brains where id=$1', [id]);
    await store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
