import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {MonitorSessions} from '../dist/monitor/session.js';
import {MonitoringRoutes} from '../dist/monitor/routes.js';
import {MonitoringStatus} from '../dist/monitor/status.js';
import {makeFileStateProvider} from '../dist/oauth/state.js';
import {handleAuthorizeGet,handleGitHubCallback} from '../dist/oauth/github.js';

const config={issuer:'https://brain.example',authorizationEndpoint:'https://brain.example/authorize',resourceUri:'https://brain.example/mcp',identityProviders:['github'],identityDefaultProvider:'github',scopes:['mcp:tools'],signingSecret:'isolated-monitor-test-only',accessTokenTtlSec:3600,refreshTokenTtlSec:3600,oauthStateTtlSec:600,authCodeTtlSec:60,githubClientId:'fixture',githubCallbackUrl:'https://brain.example/oauth/github/callback'};
const sha=value=>createHash('sha256').update(value).digest('hex');
async function fixture(t){const root=await mkdtemp(path.join(os.tmpdir(),'brain-monitor-test-'));t.after(()=>rm(root,{recursive:true,force:true}));return {root,state:makeFileStateProvider(root)};}
async function signIn(sessions,state){
 const login=await sessions.begin();const params=new URL(login.location).searchParams;
 await state.put('auth_codes','code',{client_id:sessions.clientId,redirect_uri:sessions.callback,code_challenge:params.get('code_challenge'),code_challenge_method:'S256',resource:config.resourceUri,scope:'mcp:tools',provider:'github',provider_user_id:'fixture-user',github_login:'fixture',expires_at:Date.now()/1000+60});
 const callback=new URLSearchParams({code:'code',state:params.get('state')});
 const cookies=await sessions.complete(callback,login.cookie.split(';')[0]);
 return {cookie:cookies[0].split(';')[0],cookies,callback,login};
}

test('monitor login binds browser state and PKCE, consumes callbacks, stores no MCP tokens and logs out durably',async t=>{
 const {state}=await fixture(t);const sessions=new MonitorSessions(config,state);
 const login=await sessions.begin();const params=new URL(login.location).searchParams;
 assert.equal(params.get('redirect_uri'),'https://brain.example/monitor/callback');
 assert.equal(params.get('code_challenge_method'),'S256');
 await assert.rejects(sessions.complete(new URLSearchParams({code:'bad',state:params.get('state')})),/invalid/);
 const signed=await signIn(sessions,state);
 assert.match(signed.cookies[0],/HttpOnly; SameSite=Lax; Max-Age=3600; Secure/);
 await assert.rejects(sessions.complete(signed.callback,signed.login.cookie.split(';')[0]),/expired/);
 assert.equal((await sessions.get(signed.cookie)).principal.providerUserId,'fixture-user');
 assert.deepEqual(await state.listAll('refresh_tokens'),{});
 const restored=new MonitorSessions(config,state);assert.ok(await restored.get(signed.cookie));
 await restored.logout(signed.cookie);assert.equal(await sessions.get(signed.cookie),null);
 assert.equal(await sessions.get(signed.cookie+'; '+signed.cookie),null);
});

test('monitor session refuses expired, different issuer, disabled provider and wrong Entra tenant',async t=>{
 const {state}=await fixture(t);const sessions=new MonitorSessions({...config,identityProviders:['entra'],entra:{tenantId:'tenant-one'}},state);
 const token=randomBytes(32).toString('base64url');const key='monitor-session:'+sha(token);
 const record={kind:'monitor_session',issuer:config.issuer,principal:{provider:'entra',providerTenantId:'tenant-one',providerUserId:'id'},expires_at:Date.now()/1000+60};
 for(const change of [{expires_at:0},{issuer:'https://other.example'},{principal:{...record.principal,providerTenantId:'other'}},{principal:{...record.principal,provider:'github'}}]){
  await state.put('oauth_states',key,{...record,...change});assert.equal(await sessions.get('__Host-brain_monitor_session='+token),null);
 }
});

test('monitoring checks current roles on every HTTP request, redacts readers and fails closed without stale data',async t=>{
 const {root,state}=await fixture(t);const registry=path.join(root,'registry.json');
 await writeFile(registry,JSON.stringify({version:1,brains:[{id:'test-monitor',type:'personal',template_used:'personal',integration_mode:'vertical',storage_backend:'postgres',storage_config:{}}]}));
 const prior=process.env.BRAIN_PLATFORM_CONFIG;process.env.BRAIN_PLATFORM_CONFIG=registry;
 t.after(()=>{if(prior===undefined)delete process.env.BRAIN_PLATFORM_CONFIG;else process.env.BRAIN_PLATFORM_CONFIG=prior;});
 let role='owner',fail=false;const rows=[{sync_at:new Date(),conflicts:0},{operations:2,failed_operations:0,auth_events:1,p95_ms:25}];
 const status=new MonitoringStatus({query:async query=>{assert.deepEqual(query.values,['test-monitor']);if(fail)throw Error('password=PRIVATE /secret/path');return {rows:[query.text.startsWith('with')?rows[1]:rows[0]]};}});
 const routes=new MonitoringRoutes(config,state,(id,role)=>status.read(id,role),async()=>role?{'test-monitor':role}:{});
 const server=http.createServer((req,res)=>void routes.handle(req,res,new URL(req.url,config.issuer)));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
 const base='http://127.0.0.1:'+server.address().port;
 const canonical=await fetch(base+'/monitor/login',{headers:{'x-forwarded-proto':'https'},redirect:'manual'});
 assert.equal(canonical.status,303);assert.equal(canonical.headers.get('location'),new URL('/monitor/login',config.issuer).href);assert.equal(canonical.headers.get('set-cookie'),null);
 const {cookie}=await signIn(routes.sessions,state);const request=(suffix='',extra={})=>fetch(base+'/monitor/api/status?brain_id=test-monitor'+suffix,{headers:{cookie,...extra}});
 let response=await request();assert.equal(response.status,200);assert.equal((await response.json()).diagnostics.operations,2);assert.equal(response.headers.get('cache-control'),'no-store');
 role='reader';response=await request();const reader=await response.json();assert.equal(reader.diagnostics,undefined);assert.equal(reader.local_inbox.state,'unobserved');
 assert.equal((await fetch(base+'/monitor/api/status?brain_id=other',{headers:{cookie}})).status,403);
 assert.equal((await request('',{Origin:'https://attacker.example'})).status,403);
 role=null;assert.equal((await request()).status,403);role='owner';fail=true;
 response=await request();assert.equal(response.status,503);assert.doesNotMatch(await response.text(),/PRIVATE|secret|diagnostics|"service"/);
 assert.equal((await fetch(base+'/monitor/api/status')).status,401);
 assert.equal((await fetch(base+'/monitor/logout',{method:'POST',headers:{cookie}})).status,403);
 assert.equal((await fetch(base+'/monitor/logout',{method:'POST',headers:{cookie,Origin:config.issuer},redirect:'manual'})).status,303);
 assert.equal((await request()).status,401);
});

test('monitor reports unknown/stale observations and bounds concurrent reads and login admission',async t=>{
 const {state}=await fixture(t);const sessions=new MonitorSessions(config,state);
 for(let i=0;i<30;i++)await sessions.begin();await assert.rejects(sessions.begin(),/rate_limited/);
 for(const sync_at of [null,new Date(Date.now()-600_000),new Date(Date.now()+600_000)]){
  const status=new MonitoringStatus({query:async()=>({rows:[{sync_at,conflicts:0}]})});
  const result=await status.read('test-monitor','reader');assert.equal(result.sync.state,sync_at&&sync_at.getTime()<Date.now()?'stale':'unknown');
 }
 let release;const pending=new Promise(resolve=>release=resolve);const bounded=new MonitoringStatus({query:async()=>{await pending;return {rows:[{sync_at:null,conflicts:0}]};}});
 const reads=Array.from({length:4},()=>bounded.read('test-monitor','reader'));
 await assert.rejects(bounded.read('test-monitor','reader'),/busy/);release();await Promise.all(reads);
});
