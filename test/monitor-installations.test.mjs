import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import http from 'node:http';
import {MonitorInstallations,parseMonitorPolicy,monitorOperator,installationReport} from '../dist/monitor/installations.js';
import {InstallationRoutes} from '../dist/monitor/installation-routes.js';
import {issueAccessToken} from '../dist/oauth/jwt.js';
import {installationsPage} from '../dist/monitor/installations-page.js';
import {monitorOrigin,installationId,reportInstallation} from '../scripts/lib/monitor-client.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const principal={provider:'entra',providerTenantId:'tenant-one',providerUserId:'user-one'};
const policy={version:1,brain_id:'test-brain',operators:[{provider:'entra',provider_tenant_id:'tenant-one',provider_user_id:'user-one',person_id:'fixture-person',update_mode:'developer'}]};
const report=()=>({installation_id:randomUUID(),app_version:'1.13.3',build:'17',source_revision:'a'.repeat(40),platform:'darwin',arch:'arm64',update_mode:'developer',update_state:'unknown'});
const config={issuer:'https://brain.example',resourceUri:'https://brain.example/mcp',scopes:['mcp:tools'],identityProviders:['entra'],signingSecret:'fixture-not-production',accessTokenTtlSec:3600,entra:{tenantId:'tenant-one'}};
const token=(options={})=>issueAccessToken(config,{sub:'user-one',clientId:'fixture-client',scope:'mcp:tools',provider:'entra',providerTenantId:'tenant-one',providerUserId:'user-one',...options}).token;

test('operator policy is exact, Brain-bound, explicit and preserves all device exclusions',()=>{
  assert.equal(parseMonitorPolicy(policy,'test-brain'),policy);
  for(const role of ['owner','admin','member'])assert.equal(monitorOperator(policy,principal,role).update_mode,'developer');
  for(const role of ['reader',undefined])assert.equal(monitorOperator(policy,principal,role),null);
  for(const change of [{providerUserId:'breakglass'},{providerUserId:'agent'},{providerTenantId:'foreign'},{provider:'github'}])assert.equal(monitorOperator(policy,{...principal,...change},'owner'),null);
  assert.throws(()=>parseMonitorPolicy(policy,'other-brain'),/invalid/);
  assert.throws(()=>parseMonitorPolicy({...policy,operators:[...policy.operators,...policy.operators]},'test-brain'),/duplicate/);
  assert.throws(()=>parseMonitorPolicy({...policy,operators:[{...policy.operators[0],update_mode:'any'}]},'test-brain'),/invalid/);
});
test('installation payload is bounded metadata, rejects identity claims and unsafe values',()=>{
  assert.ok(installationReport(report()));
  for(const value of [{...report(),brain_id:'foreign'},{...report(),provider_user_id:'victim'}, {...report(),hostname:'private'}, {...report(),token:'secret'}, {...report(),build:'<script>'}, {...report(),installation_id:'not-a-uuid'}, {...report(),source_revision:'main'}, {...report(),update_state:'secret diagnostic text'}, {...report(),arch:'x86'}, {...report(),app_version:'x'.repeat(100)}]) assert.throws(()=>installationReport(value),/invalid/);
});
test('authenticated report supplies all SQL identity fields and cannot bypass developer mode',async()=>{
  const queries=[];const inventory=new MonitorInstallations({query:async q=>{queries.push(q);return {rows:[{last_seen_at:new Date()}]};}},policy);
  const value=report();assert.equal((await inventory.report(principal,'member',value)).recorded,true);
  assert.deepEqual(queries[0].values.slice(0,5),['test-brain','entra','tenant-one','user-one',value.installation_id]);
  assert.doesNotMatch(queries[0].text,/fixture-person/);
  await assert.rejects(inventory.report(principal,'owner',{...value,update_mode:'automatic'}),/policy_mismatch/);
  await assert.rejects(inventory.report(principal,'reader',value),/operator_required/);
  await assert.rejects(inventory.report({...principal,providerUserId:'agent'},'owner',value),/operator_required/);
  assert.equal(queries.length,1);
});
test('inventory reads are deployment bound, bounded and distinguish missing observations',async()=>{
  let query;const inventory=new MonitorInstallations({query:async q=>{query=q;return {rows:Array.from({length:501},()=>({build:'1'}))};}},policy);
  const result=await inventory.list();assert.equal(result.installations.length,500);assert.equal(result.truncated,true);assert.deepEqual(query.values,['test-brain']);assert.match(query.text,/limit 501/);
  const html=installationsPage('brain', {...result,installations:[]});assert.match(html,/Installation unverified/);assert.doesNotMatch(html,/Installed successfully/);
  assert.match(installationsPage('<script>',{...result,operators:[],installations:[]}),/&lt;script&gt;/);
});
test('device exceptions apply to one observed installation without removing developer protection from another device',async()=>{
  const value=report();const devicePolicy={...policy,operators:[{...policy.operators[0],devices:[{installation_id:value.installation_id.toUpperCase(),update_mode:'automatic'}]}]};
  parseMonitorPolicy(devicePolicy,'test-brain');
  const inventory=new MonitorInstallations({query:async()=>({rows:[{last_seen_at:new Date()}]})},devicePolicy);
  assert.equal((await inventory.report(principal,'member',{...value,update_mode:'automatic'})).update_mode,'automatic');
  await assert.rejects(inventory.report(principal,'member',{...value,installation_id:randomUUID(),update_mode:'automatic'}),/policy_mismatch/);
  assert.equal((await inventory.report(principal,'member',{...value,installation_id:randomUUID()})).update_mode,'developer');
});
test('inventory reporting enforces bearer, tenant, current grant, scope, origin and admission',async t=>{
  let role='member',fail=false,count=0;
  const inventory=new MonitorInstallations({query:async()=>{if(fail)throw Error('postgres://SECRET');count++;return {rows:[{last_seen_at:new Date()}]};}},policy);
  const routes=new InstallationRoutes(config,inventory,async()=>({'test-brain':role}));
  const server=http.createServer((req,res)=>void routes.handle(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const url='http://127.0.0.1:'+server.address().port;
  const call=(body=report(),extra={})=>fetch(url,{method:'POST',headers:{'content-type':'application/json',Authorization:'Bearer '+token(),...extra},body:typeof body==='string'?body:JSON.stringify(body)});
  assert.equal((await call()).status,200);
  assert.equal((await call(report(),{Authorization:''})).status,401);
  assert.equal((await call(report(),{Authorization:'Bearer '+token({scope:'other'})})).status,401);
  assert.equal((await call(report(),{Authorization:'Bearer '+token({providerTenantId:'foreign'})})).status,403);
  assert.equal((await call(report(),{Origin:'https://attacker.example'})).status,403);
  role='reader';assert.equal((await call()).status,403);role=undefined;assert.equal((await call()).status,403);role='member';
  assert.equal((await call({...report(),brain_id:'other'})).status,400);
  assert.equal((await call('{')).status,400);
  assert.equal((await call(' '.repeat(4097))).status,413);
  fail=true;const failed=await call();assert.equal(failed.status,503);assert.doesNotMatch(await failed.text(),/SECRET|postgres/);fail=false;
  while(routes.admissions.get(JSON.stringify(['entra','tenant-one','user-one'])).length<12)await call();
  assert.equal((await call()).status,429);assert.ok(count>=1);
});
test('native reporter refuses URL redirection and unsafe origins, persists a random installation id',async t=>{
  for(const url of ['http://brain.example','https://name:secret@brain.example','https://brain.example/path','https://brain.example/?token=x'])assert.throws(()=>monitorOrigin(url));
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'monitor-id-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const id=await installationId(dir);assert.equal(await installationId(dir),id);assert.equal((await fs.stat(path.join(dir,'installation-id'))).mode&0o777,0o600);
  await assert.rejects(reportInstallation('https://brain.example',{read:async()=>null},report()),/sign_in_required/);
});
