import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import pg from 'pg';
import {PostgresStateProvider} from '../dist/oauth/postgres-state.js';
import {PostgresAccessGrantStore,resetAccessGrantStoreForTests,postgresAccessGrantStore} from '../dist/services/access-grants.js';
import {MonitoringRoutes} from '../dist/monitor/routes.js';
import {MonitoringStatus} from '../dist/monitor/status.js';

test('monitor Entra session survives reconstruction and obeys real Postgres grants, tenant and Brain isolation',async t=>{
 const url=process.env.BRAIN_POSTGRES_TEST_DATABASE_URL;if(!url)return t.skip('requires disposable local Postgres');assert.equal(new URL(url).hostname,'127.0.0.1');
 const root=await mkdtemp(path.join(os.tmpdir(),'monitor-pg-'));const brainId='test-'+randomUUID(),tenant=randomUUID();
 const prior={...process.env};Object.assign(process.env,{BRAIN_ID:brainId,BRAIN_PLATFORM_CONFIG:path.join(root,'registry.json'),BRAIN_REVISION_DATABASE_URL:url,BRAIN_ACCESS_GRANT_STORE:'postgres'});
 await writeFile(process.env.BRAIN_PLATFORM_CONFIG,JSON.stringify({version:1,brains:[{id:brainId,type:'shared',template_used:'shared',integration_mode:'vertical',storage_backend:'postgres',storage_config:{}}]}));
 resetAccessGrantStoreForTests();const grants=postgresAccessGrantStore(),pool=grants.pool,state=new PostgresStateProvider(pool),status=new MonitoringStatus(pool);
 const principal={provider:'entra',providerTenantId:tenant,providerUserId:randomUUID()};
 const config={issuer:'https://brain.example',authorizationEndpoint:'https://brain.example/authorize',resourceUri:'https://brain.example/mcp',identityProviders:['entra'],scopes:['mcp:tools'],signingSecret:'fixture-only',accessTokenTtlSec:3600,refreshTokenTtlSec:3600,entra:{tenantId:tenant}};
 let server;
 try{
  await pool.query("insert into brain.brains(id,type,template_used,integration_mode) values($1,'shared','shared','vertical')",[brainId]);
  await grants.applyMutation({brainId,target:principal,actor:principal,role:'reader',status:'active',roleSource:'entra_group'});
  const routes=new MonitoringRoutes(config,state,(id,role)=>status.read(id,role));
  const login=await routes.sessions.begin();const params=new URL(login.location).searchParams;
  const code=randomUUID();await state.put('auth_codes',code,{client_id:routes.sessions.clientId,redirect_uri:routes.sessions.callback,code_challenge:params.get('code_challenge'),code_challenge_method:'S256',resource:config.resourceUri,scope:'mcp:tools',provider:'entra',provider_tenant_id:tenant,provider_user_id:principal.providerUserId,entra_role:'Brain.Reader',expires_at:Date.now()/1000+60});
  const cookies=await routes.sessions.complete(new URLSearchParams({code,state:params.get('state')}),login.cookie.split(';')[0]);const cookie=cookies[0].split(';')[0];
  const reconstructed=new MonitoringRoutes(config,state,(id,role)=>status.read(id,role));
  server=http.createServer((req,res)=>void reconstructed.handle(req,res,new URL(req.url,config.issuer)));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port;const call=id=>fetch(base+'/monitor/api/status?brain_id='+id,{headers:{cookie}});
  let response=await call(brainId);assert.equal(response.status,200);let data=await response.json();assert.equal(data.diagnostics,undefined);assert.equal(data.sync.state,'unknown');
  await grants.applyMutation({brainId,target:principal,actor:principal,role:'admin',status:'active',roleSource:'entra_group'});
  await pool.query("insert into brain.sync_heartbeats(brain_id,last_seen_at,metadata) values($1,now(),'{\"private_path\":\"PRIVATE\"}')",[brainId]);
  await pool.query("insert into brain.sync_events(brain_id,event_type,duration_ms,metadata) values($1,'hosted_mcp_latency',25,'{\"ok\":true,\"error\":\"PRIVATE\",\"name\":\"secret_filename\"}')",[brainId]);
  response=await call(brainId);const body=await response.text();assert.doesNotMatch(body,/PRIVATE|secret_filename/);data=JSON.parse(body);assert.equal(data.diagnostics.operations,1);assert.equal(data.sync.state,'recent');
  assert.equal((await call('other-brain')).status,403);
  await grants.applyMutation({brainId,target:principal,actor:principal,role:'reader',status:'revoked',roleSource:'entra_group'});assert.equal((await call(brainId)).status,403);
  await reconstructed.sessions.logout(cookie);
 }finally{
  if(server)await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
  await pool.query('delete from brain.access_audit_events where brain_id=$1',[brainId]);await pool.query('delete from brain.brains where id=$1',[brainId]);await pool.query('delete from brain.principals where provider_tenant_id=$1',[tenant]);
  await state.del('clients','brain-monitor-'+(await import('node:crypto')).createHash('sha256').update(config.issuer).digest('hex').slice(0,24));
  await grants.close();resetAccessGrantStoreForTests();for(const key of ['BRAIN_ID','BRAIN_PLATFORM_CONFIG','BRAIN_REVISION_DATABASE_URL','BRAIN_ACCESS_GRANT_STORE']){if(prior[key]===undefined)delete process.env[key];else process.env[key]=prior[key];}await rm(root,{recursive:true,force:true});
 }
});
