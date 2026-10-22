import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {randomUUID} from "node:crypto";
import pg from "pg";
import {PostgresRevisionStore} from "../dist/sync/postgres-revision-store.js";
import {RevisionBrainStore} from "../dist/services/revision-brain-store.js";
import {internalWriteContext} from "../dist/services/write-policy.js";

test("Postgres: runtime queue fence, atomic audit, concurrent replay and source isolation",async t=>{
 const url=process.env.BRAIN_POSTGRES_TEST_DATABASE_URL;if(!url)return t.skip("requires disposable loopback PostgreSQL");
 assert.equal(new URL(url).hostname,"127.0.0.1");assert.equal(new URL(url).username,"brain_acceptance");
 const admin=new pg.Pool({connectionString:url,max:2}),runtime=new pg.Pool({connectionString:url,max:4,options:"-c role=brain_runtime"});
 await admin.query(await fs.readFile(new URL("../db/migrations/2026-10-22_001_brain_write_admission.sql",import.meta.url),"utf8"));
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"brain-admission-pg-"));const brain="test-admission-"+randomUUID(),other="test-other-"+randomUUID();
 t.after(async()=>{await runtime.end();await admin.query("delete from brain.write_policies where brain_id=any($1)",[[brain,other]]);await admin.query("delete from brain.brains where id=any($1)",[[brain,other]]);await admin.end();await fs.rm(root,{recursive:true,force:true});});
 const policy={version:1,mode:"enforce",intake:"retired",capture_route:"capture-personal",task_paths:["TASKS.md","capture-queue.md"],review_base_url:"https://brain.example"};
 const config=path.join(root,"registry.json");
 process.env.BRAIN_PLATFORM_CONFIG=config;process.env.BRAIN_MONITOR_CONFIG_FILE="";
 await fs.writeFile(config,JSON.stringify({version:1,brains:[brain,other].map(id=>({id,type:"personal",template_used:"personal",integration_mode:"vertical",storage_backend:"postgres",storage_config:{},write_policy:policy}))}));
 for(const id of [brain,other])await admin.query("insert into brain.brains(id,type,template_used,integration_mode) values($1,'personal','personal','vertical')",[id]);
 const store=new PostgresRevisionStore(runtime),surface=new RevisionBrainStore(store);
 const seed=async(name,body,id=brain)=>store.proposeRevision({brainId:id,filename:name,baseRevisionId:(await store.getHead(id,name))?.revisionId||null,content:body,origin:"system",writeContext:internalWriteContext("synthetic fixture")});
 const text="Canonical location is https://project.example/new .\n",src=await seed("SOURCE.md",text);
 await seed("TASKS.md","# TASKS\n\n- Transferred: preserved history\n");
 await seed("CONTEXT.md","Old URL.\n");
 await seed("PRIVATE.md","Other domain source.\n",other);
 const context=()=>({operation_id:randomUUID(),kind:"source_backed",reason:"Correct from the current canonical source.",evidence:[{brain_id:brain,reference:"SOURCE.md",observed_at:new Date().toISOString(),method:"hosted_source",verification:"agent_observed",revision:src.head.revisionId,excerpt:text.trim()}]});
 await admin.query("insert into brain.write_policies(brain_id,version,intake,task_paths) values($1,1,'retired',$2)",[brain,policy.task_paths]);
 await t.test("only runtime SELECT can access policy, client roles cannot",async()=>{
  assert.equal((await runtime.query("select current_user n")).rows[0].n,"brain_runtime");
  assert.equal((await runtime.query("select * from brain.write_policies where brain_id=$1",[brain])).rowCount,1);
  await assert.rejects(runtime.query("update brain.write_policies set intake='legacy' where brain_id=$1",[brain]),/permission denied/);
  const result=await admin.query("select has_table_privilege('anon','brain.write_policies','select') anon,has_table_privilege('authenticated','brain.write_policies','select') auth,relrowsecurity rls from pg_class where oid='brain.write_policies'::regclass");
  assert.deepEqual(result.rows[0],{anon:false,auth:false,rls:true});
 });
 await t.test("raw old-client inserts and direct head substitution cannot add queue records",async()=>{
  const initial=(await runtime.query("select count(*)::int n from brain.brain_file_revisions where brain_id=$1",[brain])).rows[0].n;
  for(const name of ["TASKS.md","tasks.md","capture-queue.md"])for(const body of ["# New heading\n\n- [ ] Pending work\n","# New queue\n\nA new task without a checkbox.\n","# TASKS\n\n- Transferred: preserved history\n- [ ] Adjacent capture\n","# TASKS\n\n- Transferred: preserved history\n  - [ ] Nested capture\n"]) {
   await assert.rejects(runtime.query("insert into brain.brain_file_revisions(brain_id,filename,content,content_sha256,origin) values($1,$2,$3,'fixture','local_agent')",[brain,name,body]),/general_intake_retired/);
  }
  const head=await store.getHead(brain,"TASKS.md"),revision=await store.readFile(brain,"TASKS.md");
  await assert.rejects(runtime.query("update brain.brain_file_revisions set content=$2 where id=$1",[head.revisionId,revision.content+"\n- [ ] Added after insert\n"]),/general_intake_retired/);
  const fact=await store.getHead(brain,"CONTEXT.md");
  await assert.rejects(runtime.query("update brain.brain_files set current_revision_id=$2 where brain_id=$1 and filename='TASKS.md'",[brain,fact.revisionId]),/revision_head_identity_mismatch/);
  // Duplicate copies and changed nested details are new records, even if counts or headings look unchanged.
  assert.equal((await runtime.query("select count(*)::int n from brain.brain_file_revisions where brain_id=$1",[brain])).rows[0].n,initial);
 });
 await t.test("automatic changes publish one human-readable log and exact read-back, with no review gate",async()=>{
  for(const body of ["Canonical URL.\n","Current canonical URL.\n"]) {
   const head=await store.getHead(brain,"CONTEXT.md");
   assert.match(await surface.writeFile(brain,"CONTEXT.md",body,"replace",undefined,{provider:"fixture",id:"agent"},"member",head.revisionId,context()),/verified/);
  }
  assert.equal((await runtime.query("select count(*)::int n from brain.brain_file_revisions where brain_id=$1 and metadata->'writeContext' is not null",[brain])).rows[0].n,2);
  const log=(await store.readFile(brain,"LOG.md")).content;assert.equal((log.match(/Automatic source-backed update/g)||[]).length,2);assert.match(log,/Before: Old URL/);assert.match(log,/Manual review is optional/);
 });
 await t.test("concurrent exact replay returns original effect and rejects changed payload",async()=>{
  const head=await store.getHead(brain,"CONTEXT.md"),ctx=context();
  const proposal={brainId:brain,filename:"CONTEXT.md",baseRevisionId:head.revisionId,content:"One replayed correction.\n",origin:"hosted_mcp",writeContext:ctx};
  const results=await Promise.all([store.proposeRevision(structuredClone(proposal)),store.proposeRevision(structuredClone(proposal))]);
  assert.ok(results.every(r=>r.ok));assert.equal(results[0].head.revisionId,results[1].head.revisionId);
  const rows=await runtime.query("select count(*)::int n from brain.brain_file_revisions where brain_id=$1 and metadata->'writeContext'->>'operation_id'=$2",[brain,ctx.operation_id]);assert.equal(rows.rows[0].n,1);
  await assert.rejects(store.proposeRevision({...proposal,content:"Changed replay"}),/operation_identity_conflict/);
 });
 await t.test("audit failure leaves both knowledge and LOG heads unchanged",async()=>{
  const oldFact=await store.readFile(brain,"CONTEXT.md"),oldLog=await store.readFile(brain,"LOG.md");
  await admin.query("create or replace function brain.fixture_fail_admission_log() returns trigger language plpgsql as $$ begin if new.brain_id="+ "'"+brain+"'"+" and new.filename='LOG.md' then raise exception 'fixture audit failure'; end if; return new; end $$");
  await admin.query("create trigger fixture_fail_admission_log before insert on brain.brain_file_revisions for each row execute function brain.fixture_fail_admission_log()");
  try {
   await assert.rejects(surface.writeFile(brain,"CONTEXT.md","Must not publish.\n","replace",undefined,undefined,"member",oldFact.revisionId,context()),/audit_record_failed/);
   assert.equal((await store.readFile(brain,"CONTEXT.md")).revisionId,oldFact.revisionId);
   assert.equal((await store.readFile(brain,"LOG.md")).revisionId,oldLog.revisionId);
  } finally {await admin.query("drop trigger fixture_fail_admission_log on brain.brain_file_revisions");await admin.query("drop function brain.fixture_fail_admission_log()");}
 });
 await t.test("applied read-back failure is recorded without replaying the write",async()=>{
  const head=await store.getHead(brain,"CONTEXT.md"),ctx=context(),read=surface.readFile.bind(surface);
  surface.readFile=async()=>{throw Error("synthetic read-back unavailable");};
  try {assert.match(await surface.writeFile(brain,"CONTEXT.md","Applied despite read-back outage.\n","replace",undefined,undefined,"member",head.revisionId,ctx),/applied, read-back/);}
  finally {surface.readFile=read;}
  const revision=await store.findWriteOperation(brain,ctx.operation_id);assert.equal(revision.writeContext.verification,"verification_failed");
  assert.equal((await store.readFile(brain,"CONTEXT.md")).content,"Applied despite read-back outage.\n");
 });
 await t.test("wrong-domain source and changed passage refuse without writes",async()=>{
  const head=await store.getHead(brain,"CONTEXT.md"),wrong=context();wrong.evidence[0].brain_id=other;
  await assert.rejects(surface.writeFile(brain,"CONTEXT.md","Bad","replace",undefined,undefined,"member",head.revisionId,wrong),/source_domain_mismatch/);
  const passage=context();passage.evidence[0].excerpt="A quotation that was never present.";
  await assert.rejects(surface.writeFile(brain,"CONTEXT.md","Bad","replace",undefined,undefined,"member",head.revisionId,passage),/stale_write_context/);
  assert.equal((await store.getHead(brain,"CONTEXT.md")).revisionId,head.revisionId);
 });
});
