import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PostgresRevisionStore } from '../dist/sync/postgres-revision-store.js';
import { RevisionBrainStore } from '../dist/services/revision-brain-store.js';
import { PostgresStateProvider } from '../dist/oauth/postgres-state.js';
import { PostgresAccessGrantStore, assertSteadyStateOwnerRoster } from '../dist/services/access-grants.js';

const url=process.env.BRAIN_POSTGRES_TEST_DATABASE_URL;
function fixtureAvailable(t){
 if(!url){t.skip('requires a disposable local BRAIN_POSTGRES_TEST_DATABASE_URL');return false;}
 assert.ok(['127.0.0.1','localhost','[::1]'].includes(new URL(url).hostname),'stabilization fixtures never run against hosted databases');return true;
}

test('Postgres refuses stale replacements and stale conflict resolutions transactionally',async t=>{
 if(!fixtureAvailable(t))return;
 const revisions=new PostgresRevisionStore(url);const store=new RevisionBrainStore(revisions);const brainId='test-'+randomUUID();
 try{
  await revisions.pool.query("insert into brain.brains(id,type,template_used,integration_mode) values($1,'personal','personal','vertical')",[brainId]);
  await store.writeFile(brainId,'topic.md','base','replace');const read=await store.readFileSnapshot(brainId,'topic.md');
  await store.writeFile(brainId,'topic.md','A','replace',undefined,undefined,undefined,read.revisionId);
  await assert.rejects(store.writeFile(brainId,'topic.md','B','replace',undefined,undefined,undefined,read.revisionId),/Stale/);
  const a=await revisions.getHead(brainId,'topic.md');
  const stale=await revisions.proposeRevision({brainId,filename:'topic.md',baseRevisionId:read.revisionId,content:'local',origin:'local_agent'});
  assert.equal(stale.ok,false);
  await store.writeFile(brainId,'topic.md','newer','replace',undefined,undefined,undefined,a.revisionId);
  await assert.rejects(revisions.resolveConflict({brainId,conflictId:stale.conflict.conflictId,content:'old merge',expectedRevisionId:a.revisionId}),/Stale/);
  assert.equal((await revisions.listConflicts(brainId,'open')).length,1);
  assert.equal(await store.readFile(brainId,'topic.md'),'newer');
  const current=await revisions.getHead(brainId,'topic.md');
  await revisions.resolveConflict({brainId,conflictId:stale.conflict.conflictId,content:'reviewed',expectedRevisionId:current.revisionId});
  assert.equal((await revisions.listConflicts(brainId,'open')).length,0);
 }finally{await revisions.pool.query('delete from brain.brains where id=$1',[brainId]);await revisions.close();}
});

test('Postgres concurrent registration is bounded and cleanup preserves clients and live tokens',async t=>{
 if(!fixtureAvailable(t))return;
 const state=new PostgresStateProvider(url);const prefix='stabilization-'+randomUUID();
 try{
  const baseline=await state.pool.query("select count(*)::int as total,count(*) filter(where created_at>now()-interval '1 hour')::int as recent from brain.oauth_state where store='clients'");
  const limits={maximumClients:baseline.rows[0].total+3,perHour:baseline.rows[0].recent+3};
  const results=await Promise.all(Array.from({length:12},(_,i)=>state.registerClient(prefix+i,{client_id:prefix+i},limits)));
  assert.equal(results.filter(Boolean).length,3);
  const now=Math.floor(Date.now()/1000);
  await state.put('refresh_tokens',prefix+'live',{expires_at:now+3600});
  await state.put('refresh_tokens',prefix+'expired',{expires_at:now-3600});
  await state.put('oauth_states',prefix+'abandoned',{expires_at:now-3600});
  assert.ok(await state.cleanupExpired(500)>=2);
  assert.ok(await state.get('refresh_tokens',prefix+'live'));
  assert.equal(await state.get('refresh_tokens',prefix+'expired'),null);
  const count=await state.pool.query("select count(*)::int as count from brain.oauth_state where store='clients' and state_key like $1",[prefix+'%']);
  assert.equal(count.rows[0].count,3);
 }finally{await state.pool.query('delete from brain.oauth_state where state_key like $1',[prefix+'%']);await state.close();}
});

test('Postgres concurrent Owner reductions preserve the same floor enforced at startup',async t=>{
 if(!fixtureAvailable(t))return;
 const revisions=new PostgresRevisionStore(url);const grants=new PostgresAccessGrantStore(revisions.pool);
 const brainId='test-'+randomUUID();const tenant=randomUUID();
 const principals=Array.from({length:3},()=>({provider:'entra',providerTenantId:tenant,providerUserId:randomUUID()}));
 try{
  await revisions.pool.query("insert into brain.brains(id,type,template_used,integration_mode) values($1,'shared','shared','vertical')",[brainId]);
  for(const target of principals)await grants.applyMutation({brainId,target,actor:principals[0],role:'owner',status:'active',roleSource:'entra_group'});
  const outcomes=await Promise.allSettled(principals.slice(1).map(target=>grants.applyMutation({brainId,target,actor:principals[0],role:'reader',status:'active',roleSource:'entra_group'})));
  assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(await grants.countActiveOwners(brainId,'entra',tenant),2);
  await assert.doesNotReject(assertSteadyStateOwnerRoster(grants,brainId,tenant));
 }finally{await revisions.pool.query('delete from brain.access_audit_events where brain_id=$1',[brainId]);await revisions.pool.query('delete from brain.brains where id=$1',[brainId]);await revisions.pool.query('delete from brain.principals where provider_tenant_id=$1',[tenant]);await revisions.close();}
});
