import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {changeLogPage, changeLogOptions} from '../dist/monitor/change-log.js';
import {changeDiff} from '../dist/monitor/change-diff.js';
import {MonitoringRoutes} from '../dist/monitor/routes.js';
import {makeFileStateProvider} from '../dist/oauth/state.js';

const brain='test-history', issuer='https://brain.example';
const receipt=(id,kind='Automatic source-backed update',origin=issuer,owner=brain)=>`## [2026-10-23] UPDATE | ${kind} — 2026-10-23T12:30:00Z; ${brain}
Agent: Test author; file: facts/${id}.md
Why: Correct fact ${id} <script>alert(1)</script>
Before: Old value.
After: New value.
Source: source.md
[Full change and prior text](${origin}/monitor/changes/${id}?brain_id=${owner})
Files: facts/${id}.md
`;

test('history filters before pagination, preserves legacy receipts, escapes content and scopes reader links',()=>{
 const content=Array.from({length:30},(_,i)=>receipt('rev-'+i)).join('\n')+receipt('user','User-directed knowledge update')+'\n## [2026-10-01] LINT | Historical maintenance\nFiles: LOG.md\n';
 const page=params=>changeLogPage(content,brain,issuer,changeLogOptions(new URLSearchParams(params)));
 const first=page('');assert.match(first,/30 matching entries/);assert.match(first,/Open diff/);assert.match(first,/Older/);assert.doesNotMatch(first,/facts\/rev-25.md|facts\/user.md|<script>/);assert.match(first,/&lt;script&gt;/);
 const second=page('offset=25');assert.match(second,/Showing 26–30/);assert.match(second,/Newer/);assert.doesNotMatch(second,/>Older</);
 const filtered=page('q=rev-29');assert.match(filtered,/1 matching entry/);assert.match(filtered,/facts\/rev-29.md/);
 assert.match(page('kind=all&q=Historical'),/Historical entry · no linked before\/after record/);
 assert.match(page('kind=all&q=Historical'),/01 Oct 2026/);assert.doesNotMatch(page('kind=all&q=Historical'),/00:00/);
 assert.match(page('kind=all&q=user'),/facts\/user.md/);
 assert.match(page('q=nothing'),/No matching entries/);
 for(const raw of [receipt('bad','Automatic source-backed update','https://attacker.example'),receipt('bad','Automatic source-backed update',issuer,'other-brain')]) {
  const html=changeLogPage(raw,brain,issuer,changeLogOptions(new URLSearchParams()));assert.doesNotMatch(html,/href="[^\"]*\/changes\/bad/);
 }
 for(const params of ['offset=-1','offset=NaN','offset=1000001','kind=unknown','q='+ 'a'.repeat(201)]) assert.throws(()=>changeLogOptions(new URLSearchParams(params)),/invalid_change_filter/);
});

test('unified diff retains context, exact whitespace, line numbers and newline markers; large edits fall back to snapshots',()=>{
 const html=changeDiff('Start\nOld\nEnd\n','Start\nNew<script>\nEnd\n','fact.md');
 assert.match(html,/\+1 added/);assert.match(html,/−1 removed/);assert.match(html,/diff-context/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);assert.match(html,/class="line-number">2</);
 const newline=changeDiff('Alpha','Alpha\n','fact.md');assert.match(newline,/No newline at end of file/);
 assert.match(changeDiff(' a\n','a\n','fact.md'),/−1 removed/);
 assert.match(changeDiff('same','same','fact.md'),/No text changes/);
 assert.match(changeDiff('a'.repeat(500001),'b','fact.md'),/too large/);
 assert.match(changeDiff('a\n'.repeat(20001),'b','fact.md'),/too large/);
});

test('history HTTP uses the selected Brain only, rechecks revoked roles and refuses anonymous/cross-origin requests before reading',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'history-http-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const previous=process.env.BRAIN_PLATFORM_CONFIG;process.env.BRAIN_PLATFORM_CONFIG=path.join(root,'registry.json');
 t.after(()=>{if(previous===undefined)delete process.env.BRAIN_PLATFORM_CONFIG;else process.env.BRAIN_PLATFORM_CONFIG=previous;});
 await writeFile(process.env.BRAIN_PLATFORM_CONFIG,JSON.stringify({version:1,brains:[{id:brain,type:'personal',template_used:'personal',integration_mode:'vertical',storage_backend:'filesystem',storage_config:{brain_dir:root}}]}));
 const config={issuer,authorizationEndpoint:issuer+'/authorize',resourceUri:issuer+'/mcp',identityProviders:['github'],scopes:['mcp:tools'],signingSecret:'history-fixture',accessTokenTtlSec:3600,refreshTokenTtlSec:3600};
 const state=makeFileStateProvider(root);let role='reader',reads=0,fail=false;
 const routes=new MonitoringRoutes(config,state,async()=>({}),async()=>role?{[brain]:role}:{},()=>({readFile:async(id,file)=>{reads++;assert.equal(id,brain);assert.equal(file,'LOG.md');if(fail)throw Error('PRIVATE secret');return receipt('one');},readChange:async()=>'{"before":"old","after":"new"}'}));
 const login=await routes.sessions.begin(),params=new URL(login.location).searchParams;
 await state.put('auth_codes','fixture-code',{client_id:routes.sessions.clientId,redirect_uri:routes.sessions.callback,code_challenge:params.get('code_challenge'),code_challenge_method:'S256',resource:config.resourceUri,scope:'mcp:tools',provider:'github',provider_user_id:'fixture',expires_at:Date.now()/1000+60});
 const cookies=await routes.sessions.complete(new URLSearchParams({code:'fixture-code',state:params.get('state')}),login.cookie.split(';')[0]),cookie=cookies[0].split(';')[0];
 const server=http.createServer((req,res)=>void routes.handle(req,res,new URL(req.url,issuer)));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
 const base='http://127.0.0.1:'+server.address().port;
 const call=(query='brain_id='+brain,headers={cookie})=>fetch(base+'/monitor/changes?'+query,{headers});
 let response=await call(undefined,{});assert.equal(response.status,401);assert.doesNotMatch(await response.text(),/Correct fact/);assert.equal(reads,0);
 assert.equal((await call('brain_id=other')).status,403);assert.equal((await call(undefined,{cookie,Origin:'https://attacker.example'})).status,403);assert.equal(reads,0);
 assert.equal((await call('brain_id='+brain+'&offset=-1')).status,400);assert.equal(reads,0);
 response=await call();assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.match(response.headers.get('content-security-policy'),/frame-ancestors 'none'/);assert.match(await response.text(),/Correct fact/);
 role=null;assert.equal((await call()).status,403);assert.equal(reads,1);
 role='reader';fail=true;response=await call();assert.equal(response.status,503);assert.doesNotMatch(await response.text(),/PRIVATE|secret|Correct fact/);
});
