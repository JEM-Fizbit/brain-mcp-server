// Synthetic local-only verification. Never loads a production profile or .env.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { performance } from 'node:perf_hooks';
import http from 'node:http';
import pg from 'pg';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { handleHttpRequest } from '../dist/http/server.js';
import { issueAccessToken } from '../dist/oauth/jwt.js';
import { closeToolTelemetryForTests } from '../dist/services/tool-telemetry.js';
import { activeBrainStore } from '../dist/services/active-brain-store.js';
import { postgresAccessGrantStore, resetAccessGrantStoreForTests } from '../dist/services/access-grants.js';
import { PostgresRevisionStore, LocalSyncAgent } from '../dist/sync/index.js';
import { RevisionBrainStore } from '../dist/services/revision-brain-store.js';
import { PostgresSourceMetadataStore } from '../dist/sources/index.js';

const supplied = process.env.BRAIN_ISOLATED_ADMIN_URL;
assert.ok(supplied, 'Set BRAIN_ISOLATED_ADMIN_URL to a disposable local Postgres cluster');
const adminUrl = new URL(supplied);
assert.equal(adminUrl.hostname, '127.0.0.1', 'Only literal loopback is allowed');
assert.equal(adminUrl.username, 'brain_acceptance', 'Requires the explicit disposable fixture role');
const bin = process.env.BRAIN_ISOLATED_PG_BIN || '/opt/homebrew/opt/postgresql@17/bin';
const exec = promisify(execFile);
const id = randomUUID().replaceAll('-', '');
const databases = [`brain_fixture_${id}`, `brain_restore_${id}`];
const urlFor = database => { const u = new URL(adminUrl); u.pathname = '/' + database; return u.href; };
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'brain-resilience-'));
const admin = new pg.Pool({connectionString: supplied, max: 1});
const pools = [], clients = [];
let server, store, grants;
const report = {version: 1, observedAt: new Date().toISOString(), environment: 'synthetic loopback PostgreSQL; no production data or provider backup', stages: []};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
try {
  for (const database of databases) await admin.query(`create database ${database} template template0`);
  const sourcePool = new pg.Pool({connectionString: urlFor(databases[0]), max: 4}); pools.push(sourcePool);
  for (const name of (await fs.readdir(new URL('../db/migrations/', import.meta.url))).filter(x => x.endsWith('.sql')).sort()) {
    await sourcePool.query(await fs.readFile(new URL('../db/migrations/' + name, import.meta.url), 'utf8'));
  }
  const brainId = 'test-resilience';
  const configPath = path.join(root, 'registry.json');
  await fs.writeFile(configPath, JSON.stringify({version: 1, brains: [{id: brainId, type: 'shared', template_used: 'shared', integration_mode: 'vertical', storage_backend: 'postgres', storage_config: {brain_dir: root, repo_path: root}}]}));
  Object.assign(process.env, {TRANSPORT: 'http', BRAIN_ID: brainId, BRAIN_ACCESS_GRANT_STORE: 'postgres', BRAIN_IDENTITY_PROVIDERS: 'entra', BRAIN_LOAD_LOCAL_ENV: '0', BRAIN_REVISION_STORE: 'postgres', BRAIN_REVISION_DATABASE_URL: urlFor(databases[0]), BRAIN_PLATFORM_CONFIG: configPath, BRAIN_PG_POOL_MAX: '4'});
  delete process.env.BRAIN_CONFIG; delete process.env.BRAIN_PLATFORMS;
  resetAccessGrantStoreForTests();
  grants = postgresAccessGrantStore(); store = activeBrainStore();
  await sourcePool.query("insert into brain.brains(id,type,template_used,integration_mode) values($1,'shared','shared','vertical')", [brainId]);
  const tenant = randomUUID(), principal = {provider: 'entra', providerTenantId: tenant, providerUserId: randomUUID()};
  await grants.applyMutation({brainId, target: principal, actor: principal, role: 'owner', status: 'active', roleSource: 'entra_group'});
  const seed = new Map([['00_loader.md', '# Synthetic fixture\n'], ['NOW.md', '# Synthetic current context\n']]);
  for (let i = 0; i < 100; i++) seed.set(`notes/item-${i}.md`, `# Synthetic ${i}\n${'Test evidence only. '.repeat(220)}`);
  for (const [filename, content] of seed) await store.writeFile(brainId, filename, content, 'replace', undefined, undefined, 'owner');
  const syncDir = path.join(root, 'mirror');
  const sync = new LocalSyncAgent({brainId, brainDir: syncDir, stateFile: path.join(root, 'state.json'), store: store.revisionStore});
  await sync.syncOnce();
  const oauth = {issuer: 'http://127.0.0.1', resourceUri: 'http://127.0.0.1/mcp', signingSecret: randomUUID(), identityProviders: ['entra'], accessTokenTtlSec: 3600};
  server = http.createServer((req, res) => { void handleHttpRequest(req, res, {config: oauth, state: {}}); });
  await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
  const endpoint = new URL(`http://127.0.0.1:${server.address().port}/mcp`);
  const bearer = issueAccessToken(oauth, {sub: `entra:${principal.providerUserId}`, clientId: 'isolated-capacity', scope: 'mcp:tools', ...principal}).token;
  for (let i = 0; i < 16; i++) {
    const client = new Client({name: 'synthetic-capacity', version: '1'}); clients.push(client);
    await client.connect(new StreamableHTTPClientTransport(endpoint, {requestInit: {headers: {Authorization: `Bearer ${bearer}`}}}));
  }
  const call = async (client, name, args) => {
    const result = await client.callTool({name, arguments: {brain_id: brainId, ...args}});
    assert.notEqual(result.isError, true, JSON.stringify(result)); return result;
  };
  const writes = [];
  for (const concurrency of [1, 4, 8, 16]) {
    const timings = [], start = performance.now();
    let next = 0, syncChain = Promise.resolve();
    await Promise.all(Array.from({length: concurrency}, (_, worker) => (async () => {
      for (;;) {
        const n = next++; if (n >= 100) break;
        const begun = performance.now();
        let kind;
        if (n % 10 === 9) {
          kind = 'sync';
          const filename = `local/stage-${concurrency}-${n}.md`, content = `manual fixture ${n}\n`;
          syncChain = syncChain.then(async () => {
            await fs.mkdir(path.join(syncDir, 'local'), {recursive: true});
            await fs.writeFile(path.join(syncDir, filename), content);
            const result = await sync.syncOnce();
            assert.equal(result.conflicts.length, 0); assert.ok(!result.guardTripped);
            assert.equal(await store.readFile(brainId, filename), content);
          });
          await syncChain;
        } else if (n % 10 >= 7) {
          kind = 'reviewed_write';
          const filename = `writes/stage-${concurrency}-${n}.md`, content = `reviewed fixture ${n}\n`;
          await call(clients[worker], 'brain_update_file', {filename, content, mode: 'replace', expected_revision: 'new'});
          writes.push([filename, content]);
        } else {
          kind = 'read';
          await call(clients[worker], 'brain_read_file', {filename: `notes/item-${n}.md`});
        }
        timings.push({kind, ms: performance.now() - begun});
      }
    })()));
    const summarize = values => {
      const sorted = values.sort((a,b) => a-b);
      return {count: sorted.length, p50Ms: +sorted[Math.ceil(sorted.length*.5)-1].toFixed(2), p95Ms: +sorted[Math.ceil(sorted.length*.95)-1].toFixed(2), maxMs: +sorted.at(-1).toFixed(2)};
    };
    report.stages.push({concurrency, durationMs: +(performance.now()-start).toFixed(2), operations: Object.fromEntries(['read','reviewed_write','sync'].map(kind => [kind, summarize(timings.filter(t=>t.kind===kind).map(t=>t.ms))])), errors: 0});
  }
  for (const [filename, content] of writes) assert.equal(await store.readFile(brainId, filename), content);
  const snapshot = await store.readFileSnapshot(brainId, 'notes/item-0.md');
  const race = await Promise.allSettled(Array.from({length: 16}, (_, n) => store.writeFile(brainId, 'notes/item-0.md', `contender ${n}`, 'replace', undefined, undefined, undefined, snapshot.revisionId)));
  assert.equal(race.filter(r=>r.status==='fulfilled').length, 1);
  for (const rejected of race.filter(r=>r.status==='rejected')) assert.match(String(rejected.reason), /Stale|Revision conflict/);
  report.reviewedRace = {contenders: 16, accepted: 1, staleOrConflictRefusals: 15};
  await sync.syncOnce();
  report.reviewedRace.recordedConflicts = (await store.revisionStore.listConflicts(brainId, 'open')).length;

  // The provider's Storage API is intentionally not impersonated. This byte
  // fixture tests separate export/restore + hash verification, not Supabase DR.
  const sources = new PostgresSourceMetadataStore(sourcePool);
  const source = await sources.createSource({brainId, category: 'fixture', label: 'synthetic original'});
  const original = Buffer.concat([Buffer.from([0,255,1,128]), Buffer.from('synthetic original bytes\n'.repeat(1000))]);
  const originalHash = hash(original), objectPath = path.join(root, 'original.bin');
  await fs.writeFile(objectPath, original);
  const artifact = await sources.recordArtifact({sourceId: source.id, artifactKind: 'original', originalFilename: 'fixture.bin', storageBucket: 'synthetic-local-fixture', storagePath: 'fixture.bin', byteSize: original.length, contentSha256: originalHash, retentionStatus: 'active'});
  await sources.recordArtifactText({artifactId: artifact.id, textFormat: 'plain_text', content: 'synthetic reviewed companion'});
  const conflictsBefore = await store.revisionStore.listConflicts(brainId, 'open');
  const heads = (await sourcePool.query('select filename,current_revision_id from brain.brain_files where brain_id=$1 order by filename', [brainId])).rows;
  const dump = path.join(root, 'database.dump');
  await exec(path.join(bin, 'pg_dump'), ['--dbname', urlFor(databases[0]), '--format=custom', '--no-owner', '--no-acl', '--schema=brain', '--file', dump], {timeout: 60_000});
  await fs.copyFile(objectPath, path.join(root, 'artifact-export.bin'));
  await exec(path.join(bin, 'pg_restore'), ['--dbname', urlFor(databases[1]), '--no-owner', '--no-acl', '--exit-on-error', dump], {timeout: 60_000});
  const restored = new PostgresRevisionStore(urlFor(databases[1])); pools.push({end:()=>restored.close()});
  const restoredStore = new RevisionBrainStore(restored);
  assert.deepEqual(await restored.listConflicts(brainId, 'open'), conflictsBefore);
  assert.deepEqual((await restored.pool.query('select filename,current_revision_id from brain.brain_files where brain_id=$1 order by filename', [brainId])).rows, heads);
  for (const {filename} of heads) assert.equal(await restoredStore.readFile(brainId, filename), await store.readFile(brainId, filename));
  const restoredSources = new PostgresSourceMetadataStore(restored.pool);
  assert.equal((await restoredSources.readArtifactText(brainId, artifact.id)).content, 'synthetic reviewed companion');
  const restoredArtifact = (await restoredSources.listArtifacts(source.id))[0];
  assert.equal(restoredArtifact.contentSha256, originalHash);
  const recoveredObject = path.join(root, 'restored-original.bin');
  await assert.rejects(fs.readFile(recoveredObject), {code: 'ENOENT'});
  await fs.writeFile(recoveredObject, 'corrupt'); assert.notEqual(hash(await fs.readFile(recoveredObject)), restoredArtifact.contentSha256);
  await fs.copyFile(path.join(root, 'artifact-export.bin'), recoveredObject);
  assert.equal(hash(await fs.readFile(recoveredObject)), restoredArtifact.contentSha256);
  const flags = db => db.query("select tablename, rowsecurity from pg_tables where schemaname='brain' order by tablename");
  assert.deepEqual((await flags(sourcePool)).rows, (await flags(restored.pool)).rows);
  const freshMirror = path.join(root, 'restored-mirror');
  const fresh = new LocalSyncAgent({brainId, brainDir: freshMirror, stateFile: path.join(root,'restored-state.json'), store: restored});
  await fresh.syncOnce();
  for (const {filename} of heads) assert.equal(await fs.readFile(path.join(freshMirror, filename), 'utf8'), await restoredStore.readFile(brainId, filename));
  const reseedBrain = 'test-reseed';
  await restored.pool.query("insert into brain.brains(id,type,template_used,integration_mode) values($1,'shared','shared','vertical')", [reseedBrain]);
  const reseed = new LocalSyncAgent({brainId: reseedBrain, brainDir: freshMirror, stateFile: path.join(root,'reseed-state.json'), store: restored});
  const reseedResult = await reseed.syncOnce();
  assert.equal(reseedResult.conflicts.length, 0);
  for (const {filename} of heads) assert.equal(await restoredStore.readFile(reseedBrain, filename), await restoredStore.readFile(brainId, filename));
  report.recovery = {heads: heads.length, conflictRecords: conflictsBefore.length, exactRevisionIds: true, exactMarkdownBytes: true, artifactCompanion: true, separateOriginalByteRestore: true, missingAndCorruptOriginalDetected: true, rlsFlagsPreserved: true, freshMirrorVerified: true, emptyBrainReseedVerified: true};
} finally {
  await Promise.allSettled(clients.map(client => client.close()));
  if (server) await new Promise(resolve => {server.close(resolve); server.closeAllConnections();});
  await closeToolTelemetryForTests();
  if (store) await store.revisionStore.close();
  if (grants) await grants.close();
  await Promise.allSettled(pools.map(pool=>pool.end()));
  for (const database of databases) await admin.query(`drop database if exists ${database} with (force)`);
  await admin.end();
  await fs.rm(root, {recursive: true, force: true});
}
console.log(JSON.stringify({...report, cleanup: 'fixture databases and synthetic files removed'}, null, 2));
