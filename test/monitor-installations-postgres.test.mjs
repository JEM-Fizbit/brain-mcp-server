import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {MonitorInstallations} from '../dist/monitor/installations.js';
test('private inventory persists across processes and runtime privileges preserve the schema fence',async t=>{
  const url=process.env.BRAIN_MONITOR_TEST_DATABASE_URL;
  if(!url)return t.skip('requires explicitly disposable Monitor PostgreSQL fixture');
  const parsed=new URL(url);assert.equal(parsed.hostname,'127.0.0.1');assert.equal(parsed.username,'monitor_runtime');
  const pool=new pg.Pool({connectionString:url,max:2});t.after(()=>pool.end());
  const principal={provider:'entra',providerTenantId:'tenant-fixture',providerUserId:randomUUID()};
  const policy={version:1,brain_id:'test-brain',operators:[{provider:'entra',provider_tenant_id:principal.providerTenantId,provider_user_id:principal.providerUserId,person_id:'fixture',update_mode:'developer'}]};
  const report={installation_id:randomUUID(),app_version:'1.13.3',build:'21',source_revision:'b'.repeat(40),platform:'darwin',arch:'arm64',update_mode:'developer',update_state:'unknown'};
  const first=new MonitorInstallations(pool,policy);assert.equal((await first.report(principal,'member',report)).recorded,true);
  const restored=new MonitorInstallations(pool,policy);let result=await restored.list();
  let rows=result.installations.filter(row=>row.provider_user_id===principal.providerUserId);assert.equal(rows.length,1);assert.equal(rows[0].build,'21');
  assert.equal((await restored.report(principal,'member',report)).recorded,false);
  assert.equal((await restored.report(principal,'member',{...report,build:'22'})).recorded,true);
  assert.equal((await restored.list()).installations.find(row=>row.provider_user_id===principal.providerUserId).build,'22');
  const foreign=new MonitorInstallations(pool,{...policy,brain_id:'foreign-brain'});assert.equal((await foreign.list()).installations.some(row=>row.installation_id===report.installation_id),false);
  for(let i=0;i<9;i++)await restored.report(principal,'member',{...report,installation_id:randomUUID()});
  await assert.rejects(restored.report(principal,'member',{...report,installation_id:randomUUID()}),/device_limit/);
  const gate=(await pool.query(`select c.relrowsecurity,
    has_table_privilege('anon','brain.monitor_installations','select') as anon_select,
    has_table_privilege('authenticated','brain.monitor_installations','insert') as client_insert,
    has_table_privilege(current_user,'brain.monitor_installations','delete') as runtime_delete
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='brain' and c.relname='monitor_installations'`)).rows[0];
  assert.equal(gate.relrowsecurity,true);assert.equal(gate.anon_select,false);assert.equal(gate.client_insert,false);assert.equal(gate.runtime_delete,false);
  await assert.rejects(pool.query('delete from brain.monitor_installations'),/permission denied/);
  await assert.rejects(pool.query('alter table brain.monitor_installations disable row level security'),/must be owner/);
});
