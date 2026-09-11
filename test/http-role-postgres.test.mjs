import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { handleHttpRequest } from '../dist/http/server.js';
import { issueAccessToken } from '../dist/oauth/jwt.js';
import { activeBrainStore } from '../dist/services/active-brain-store.js';
import { postgresAccessGrantStore, resetAccessGrantStoreForTests } from '../dist/services/access-grants.js';

// This fixture changes grants and content only in an explicitly selected local DB.
test('HTTP MCP enforces live Postgres grants, reviewed writes and tenant isolation with unchanged bearer tokens', { timeout: 30000 }, async t => {
  const url = process.env.BRAIN_POSTGRES_TEST_DATABASE_URL;
  if (!url) return t.skip('requires a disposable local BRAIN_POSTGRES_TEST_DATABASE_URL');
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname));
  const root = await mkdtemp(path.join(tmpdir(), 'brain-http-roles-'));
  const brainId = `test-${randomUUID()}`;
  const tenant = randomUUID();
  const roles = ['reader', 'member', 'admin', 'owner'];
  const principals = roles.map(() => ({ provider: 'entra', providerTenantId: tenant, providerUserId: randomUUID() }));
  const overrides = {
    TRANSPORT: 'http', BRAIN_ID: brainId, BRAIN_PLATFORM_CONFIG: path.join(root, 'registry.json'),
    BRAIN_REVISION_STORE: 'postgres', BRAIN_REVISION_DATABASE_URL: url,
    BRAIN_ACCESS_GRANT_STORE: 'postgres', BRAIN_IDENTITY_PROVIDERS: 'entra',
    BRAIN_HOSTED_MCP_LATENCY_AWAIT_DB_WRITE: undefined,
  };
  const prior = Object.fromEntries(Object.keys(overrides).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  await writeFile(overrides.BRAIN_PLATFORM_CONFIG, JSON.stringify({ version: 1, brains: [{
    id: brainId, type: 'shared', template_used: 'shared', integration_mode: 'vertical',
    storage_backend: 'postgres', storage_config: { brain_dir: root, repo_path: root },
  }] }));
  resetAccessGrantStoreForTests();
  const grants = postgresAccessGrantStore();
  const store = activeBrainStore();
  const clients = [];
  let server;
  const text = result => (result.content || []).filter(x => x.type === 'text').map(x => x.text).join('\n');
  const allowed = result => assert.notEqual(result.isError, true, text(result));
  const denied = (result, reason) => { assert.equal(result.isError, true, text(result)); assert.match(text(result), reason); };
  try {
    await grants.pool.query("insert into brain.brains(id,type,template_used,integration_mode) values($1,'shared','shared','vertical')", [brainId]);
    for (let i = 0; i < roles.length; i++) await grants.applyMutation({ brainId, target: principals[i], actor: principals[3], role: roles[i], status: 'active', roleSource: 'entra_group' });
    await store.writeFile(brainId, '00_loader.md', '# Fixture', 'replace', undefined, undefined, 'owner');
    const config = { issuer: 'http://127.0.0.1', resourceUri: 'http://127.0.0.1/mcp', signingSecret: randomUUID(), identityProviders: ['entra'], accessTokenTtlSec: 3600 };
    server = http.createServer((req, res) => { void handleHttpRequest(req, res, { config, state: {} }); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const endpoint = new URL(`http://127.0.0.1:${server.address().port}/mcp`);
    async function connect(principal) {
      // Deliberately claim Owner upstream. Current grants, not stale JWT roles, must win.
      const token = issueAccessToken(config, { sub: `entra:${principal.providerUserId}`, clientId: 'fixture', scope: 'mcp:tools', ...principal, upstreamRole: 'owner', email: 'same@example.invalid' }).token;
      const client = new Client({ name: 'isolated-role-acceptance', version: '1' });
      clients.push(client);
      await client.connect(new StreamableHTTPClientTransport(endpoint, { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
      return client;
    }
    const call = (client, name, args = {}) => client.callTool({ name, arguments: { brain_id: brainId, ...args } });
    for (let i = 0; i < roles.length; i++) {
      const client = await connect(principals[i]);
      allowed(await call(client, 'brain_read_file', { filename: '00_loader.md' }));
      allowed(await call(client, 'brain_prepare_ingest', { source_label: 'isolated fixture' }));
      const result = await call(client, 'brain_update_file', { filename: `${roles[i]}.md`, content: 'base', mode: 'replace', expected_revision: 'new' });
      if (i === 0) denied(result, /access denied/); else allowed(result);
      const structural = await call(client, 'brain_update_file', { filename: '00_loader.md', content: '\nupdate', mode: 'append' });
      if (i < 2) denied(structural, /access denied|owner|admin/i); else allowed(structural);
      if (i > 0) {
        const deletion = await call(client, 'brain_delete_file', { filename: `${roles[i]}.md` });
        if (i === 1) denied(deletion, /requires admin/); else allowed(deletion);
      }
    }
    const member = clients[1];
    const read = await call(member, 'brain_read_file', { filename: 'member.md' });
    const snapshot = await store.readFileSnapshot(brainId, 'member.md');
    assert.ok(text(read).includes(snapshot.revisionId), 'the client receives the reviewed revision');
    const replace = { filename: 'member.md', mode: 'replace', content: 'reviewed replacement', expected_revision: snapshot.revisionId };
    allowed(await call(member, 'brain_update_file', replace));
    denied(await call(member, 'brain_update_file', { ...replace, content: 'stale overwrite' }), /Stale/);
    assert.equal(await store.readFile(brainId, 'member.md'), 'reviewed replacement');
    await grants.applyMutation({ brainId, target: principals[1], actor: principals[3], role: 'reader', status: 'active', roleSource: 'entra_group' });
    allowed(await call(member, 'brain_read_file', { filename: 'member.md' }));
    denied(await call(member, 'brain_update_file', { filename: 'member.md', content: 'blocked', mode: 'append' }), /requires member/);
    await grants.applyMutation({ brainId, target: principals[1], actor: principals[3], role: 'reader', status: 'suspended', roleSource: 'entra_group' });
    denied(await call(member, 'brain_read_file', { filename: 'member.md' }), /not accessible/);
    await grants.applyMutation({ brainId, target: principals[0], actor: principals[3], role: 'reader', status: 'revoked', roleSource: 'entra_group' });
    denied(await call(clients[0], 'brain_read_file', { filename: '00_loader.md' }), /not accessible/);
    const wrongTenant = await connect({ ...principals[3], providerTenantId: randomUUID() });
    denied(await call(wrongTenant, 'brain_read_file', { filename: '00_loader.md' }), /not accessible/);
    denied(await call(clients[3], 'brain_read_file', { brain_id: 'other-brain', filename: '00_loader.md' }), /not accessible/);
  } finally {
    await Promise.all(clients.map(client => client.close().catch(() => {})));
    if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    await grants.pool.query('delete from brain.access_audit_events where brain_id=$1', [brainId]);
    await grants.pool.query('delete from brain.brains where id=$1', [brainId]);
    await grants.pool.query('delete from brain.principals where provider_tenant_id=$1', [tenant]);
    await grants.close();
    await store.revisionStore.close();
    resetAccessGrantStoreForTests();
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  }
});
