import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import pg from 'pg';
import {IngestionJobs} from '../dist/ingestion/jobs.js';
import {sha256} from '../dist/ingestion/local.js';

test('durable ingestion: immutable originals, fencing, atomic approval writes, recovery and isolation',async t=>{
 const url=process.env.BRAIN_POSTGRES_TEST_DATABASE_URL;if(!url)return t.skip('requires disposable local Postgres');
 assert.equal(new URL(url).hostname,'127.0.0.1');assert.equal(new URL(url).username,'brain_acceptance');
 const admin=new pg.Pool({connectionString:url,max:2});
 if(!(await admin.query("select to_regclass('brain.ingestion_jobs') as name")).rows[0].name)await admin.query(await fs.readFile(new URL('../db/migrations/20260911113912_resumable_local_ingestion.sql',import.meta.url),'utf8'));
 const pool=new pg.Pool({connectionString:url,max:4,options:'-c role=brain_runtime'});
 const brain='test-ingest-'+randomUUID(),other='test-ingest-'+randomUUID();
 const jobs=new IngestionJobs(pool,'fixture-owner',brain,{provider:'local_operator',id:'fixture'});
 const objects=new Map();let uploads=0;const adapter={bucket:'brain-artifacts',read:async key=>objects.get(key)||null,put:async(key,bytes)=>{if(objects.has(key))throw new Error('already exists');uploads++;objects.set(key,Buffer.from(bytes));}};
 const content=Buffer.from('Synthetic source text.');
 const manifest=(ext='txt')=>({schema:'brain.source-reference/v1',brainId:brain,sourceId:randomUUID(),label:'Synthetic source',category:'test',status:'pending',evidenceTier:'primary',provenanceNote:'Isolated operator fixture',companionPath:`sources/${randomUUID()}.md`,artifacts:[{id:randomUUID(),kind:'original',label:'Original',provider:'local',providerId:randomUUID(),rootAlias:'fixture',relativePath:`source.${ext}`,contentSha256:sha256(content),byteSize:content.length}],brainLinks:[{filename:'CONTEXT.md',relation:'context'}]});
 const ready=async()=>{let job=await jobs.prepare(manifest(),content);return jobs.advance(job.id,adapter,content);};
 try{
  for(const id of [brain,other])await admin.query("insert into brain.brains(id,type,template_used,integration_mode) values($1,'shared','shared','vertical')",[id]);
  await t.test('private schema retains runtime-only access',async()=>{
   const controls=await admin.query("select c.relrowsecurity,has_table_privilege('anon','brain.ingestion_jobs','select') as anon,has_table_privilege('authenticated','brain.ingestion_jobs','select') as authenticated from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='brain' and c.relname='ingestion_jobs'");assert.deepEqual(controls.rows,[{relrowsecurity:true,anon:false,authenticated:false}]);
   assert.equal((await pool.query('select current_user as name')).rows[0].name,'brain_runtime');
  });
  await t.test('duplicate and renamed source reuse job, source identity and immutable artifact',async()=>{
   const m=manifest();const job=await jobs.prepare(m,content);m.artifacts[0].relativePath='renamed.txt';assert.equal((await jobs.prepare(m,content)).id,job.id);
   await assert.rejects(jobs.prepare(m,Buffer.from('changed')),/source_changed/);
   await assert.rejects(jobs.prepare({...m,sourceId:randomUUID()},content),/reuse_existing/);
   const foreign=new IngestionJobs(pool,'other-owner',brain,{provider:'local_operator',id:'fixture'});await assert.rejects(foreign.get(job.id),/wrong_owner/);await assert.rejects(foreign.prepare(m,content),/identity_mismatch/);
   const wrongBrain=new IngestionJobs(pool,'fixture-owner',other,{provider:'local_operator',id:'fixture'});await assert.rejects(wrongBrain.prepare(m,content),/identity_required/);
   await jobs.advance(job.id,adapter,content);const n=uploads;await jobs.advance(job.id,adapter,content);assert.equal(uploads,n);
  });
  await t.test('competing and expired leases are fenced',async()=>{
   const job=await jobs.prepare(manifest(),content);const first=await jobs.claim(job.id);await assert.rejects(jobs.claim(job.id),/busy/);
   await admin.query("update brain.ingestion_jobs set lease_until=now()-interval '1 second' where id=$1",[job.id]);const second=await jobs.claim(job.id);assert.notEqual(first,second);
   await assert.rejects(jobs.leased(job.id,first,async()=>{}),/lease_lost/);
   await admin.query("update brain.ingestion_jobs set lease_until=now()-interval '1 second' where id=$1",[job.id]);assert.equal((await jobs.advance(job.id,adapter,content)).stage,'review');
  });
  await t.test('lost upload acknowledgement reuses verified bytes; unsupported extraction retains original',async()=>{
   const job=await jobs.prepare(manifest(),content);const n=uploads;
   const lost={...adapter,put:async(key,bytes,mime)=>{await adapter.put(key,bytes,mime);throw new Error('lost response');}};
   const done=await jobs.advance(job.id,lost,content);assert.equal(done.stage,'review');assert.equal(uploads,n+1);
   const unsupported=await jobs.prepare(manifest('pptx'),content);await assert.rejects(jobs.advance(unsupported.id,adapter,content),/unsupported/);
   const blocked=await jobs.get(unsupported.id);assert.equal(blocked.stage,'blocked');assert.equal(blocked.original.verified,true);assert.deepEqual(objects.get(blocked.original.key),content);
  });
  await t.test('restart after original checkpoint finishes extraction without local file or duplicate upload',async()=>{
   const job=await jobs.prepare(manifest(),content);const leased=jobs.leased.bind(jobs);let checkpoints=0;
   jobs.leased=async(...args)=>{await leased(...args);if(++checkpoints===2)throw new Error('crash after original checkpoint');};
   try{await assert.rejects(jobs.advance(job.id,adapter,content),/crash/);}finally{jobs.leased=leased;}
   const n=uploads;assert.equal((await jobs.get(job.id)).original.verified,true);
   assert.equal((await jobs.advance(job.id,adapter)).stage,'review');assert.equal(uploads,n);
  });
  await t.test('no write before exact approval; reviewed companion and metadata commit once',async()=>{
   let job=await ready();await assert.rejects(jobs.apply(job.id,adapter),/approval_required/);
   job=await jobs.review(job.id,'Reviewed synthetic content');await assert.rejects(jobs.approve(job.id,'wrong'),/approval_required/);
   await jobs.approve(job.id,job.candidate.digest);job=await jobs.apply(job.id,adapter);assert.equal(job.stage,'complete');assert.equal(job.receipt.revisions.length,1);
   const receipt=job.receipt;job=await jobs.apply(job.id,adapter);assert.deepEqual(job.receipt,receipt);
   const source=await pool.query('select retention_status,storage_path from brain.source_artifacts where id=$1',[job.artifact_id]);assert.equal(source.rows[0].retention_status,'active');assert.equal(source.rows[0].storage_path,job.original.key);
   assert.equal((await pool.query('select count(*)::int n from brain.brain_file_revisions where brain_id=$1 and filename=$2',[brain,job.manifest.companionPath])).rows[0].n,1);
  });
  await t.test('stale review refuses all writes and requires fresh approval; corrupt original refuses apply',async()=>{
   let job=await ready();job=await jobs.review(job.id,'Reviewed content',[{filename:'target.md',expectedRevision:'new',content:'candidate'}]);await jobs.approve(job.id,job.candidate.digest);
   await jobs.revisions.proposeRevision({brainId:brain,filename:'target.md',content:'Concurrent edit',baseRevisionId:null,origin:'local_agent'});
   job=await jobs.apply(job.id,adapter);assert.equal(job.stage,'needs_review');assert.equal(job.approval,null);assert.equal(await jobs.revisions.getHead(brain,job.manifest.companionPath),null);
   await assert.rejects(jobs.approve(job.id,job.candidate.digest),/approval_required/);
   job=await jobs.review(job.id,'Freshly reviewed content');await jobs.approve(job.id,job.candidate.digest);
   objects.set(job.original.key,Buffer.from('corrupt'));await assert.rejects(jobs.apply(job.id,adapter),/verification_failed/);assert.equal(await jobs.revisions.getHead(brain,job.manifest.companionPath),null);
   objects.set(job.original.key,content);assert.equal((await jobs.apply(job.id,adapter)).stage,'complete');
  });
  await t.test('interruption within writes rolls back metadata and every head; lost completion response replays receipt',async()=>{
   let job=await ready();job=await jobs.review(job.id,'Synthetic review',[{filename:'zz-second.md',expectedRevision:'new',content:'Second'}]);await jobs.approve(job.id,job.candidate.digest);
   const real=jobs.revisions.proposeRevisionInTransaction.bind(jobs.revisions);let count=0;jobs.revisions.proposeRevisionInTransaction=async(...args)=>{if(++count===2)throw new Error('simulated interruption');return real(...args);};
   await assert.rejects(jobs.apply(job.id,adapter),/interruption/);jobs.revisions.proposeRevisionInTransaction=real;
   assert.equal(await jobs.revisions.getHead(brain,job.manifest.companionPath),null);assert.equal((await pool.query('select id from brain.sources where id=$1',[job.source_id])).rowCount,0);
   const leased=jobs.leased.bind(jobs);jobs.leased=async(...args)=>{await leased(...args);throw new Error('lost completion response');};await assert.rejects(jobs.apply(job.id,adapter),/lost completion/);jobs.leased=leased;
   job=await jobs.apply(job.id,adapter);assert.equal(job.stage,'complete');assert.equal(job.receipt.revisions.length,2);assert.equal((await pool.query('select count(*)::int n from brain.brain_file_revisions where brain_id=$1 and filename=$2',[brain,job.manifest.companionPath])).rows[0].n,1);
  });
 }finally{await admin.query('delete from brain.brains where id=any($1::text[])',[[brain,other]]);await pool.end();await admin.end();}
});
