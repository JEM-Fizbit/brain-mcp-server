import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import {HostedIngestion,validateSessionManifest,sessionOwner,hostedIngestionAvailable,sourceObjectKey} from '../dist/ingestion/hosted.js';
import {IngestionJobs} from '../dist/ingestion/jobs.js';
import {sha256} from '../dist/ingestion/local.js';
import {SupabaseIngestionAdapter} from '../dist/ingestion/supabase.js';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {registerSourceIngestionTools} from '../dist/tools/source-ingestion.js';
import {describeCapabilities} from '../dist/services/capabilities.js';

const context=(brainId,role='owner')=>({brainId,brain:{id:brainId,storage_backend:'postgres',source_categories:['writing_samples']},role,principal:{provider:'entra',providerTenantId:randomUUID(),providerUserId:randomUUID()}});
const evidence=(brainId)=>({operation_id:randomUUID(),kind:'user_directed',reason:'Owner selected this published essay for durable retention.',evidence:[{brain_id:brainId,reference:'current user request',observed_at:new Date().toISOString(),method:'user_instruction',verification:'agent_observed',excerpt:'Ingest this selected published essay and curate its supported backlinks.'}]});
const manifest=(id,bytes,ext='docx')=>({schema:'brain.source-reference/v1',brainId:id,sourceId:randomUUID(),label:'Published synthetic essay',category:'writing_samples',status:'pending',evidenceTier:'primary',provenanceNote:'Explicit session selection; fixture only.',companionPath:`sources/writing_samples/2026-11-03_essay-${randomUUID()}.md`,artifacts:[{id:randomUUID(),kind:'original',label:'Original',provider:'session',providerId:randomUUID(),rootAlias:'session_upload',relativePath:`essay.${ext}`,contentSha256:sha256(bytes),byteSize:bytes.length,mimeType:ext==='md'?'text/markdown':'application/octet-stream'}],brainLinks:[{filename:'publications.md',relation:'context'}]});

test('direct source discovery is explicit, per Brain and independent of current role',()=>{
 const ctx=context('ai-brain-jem');const env={BRAIN_REVISION_STORE:'postgres',BRAIN_HOSTED_INGESTION_BRAINS:ctx.brainId,BRAIN_ID:ctx.brainId,BRAIN_REVISION_DATABASE_URL:'fixture',BRAIN_EXPECTED_SUPABASE_PROJECT_REF:'fixture',BRAIN_SUPABASE_URL:'fixture',BRAIN_SUPABASE_SERVICE_ROLE_KEY:'fixture'};
 assert.equal(hostedIngestionAvailable(ctx.brain,env),true);
 assert.equal(hostedIngestionAvailable({...ctx.brain,id:'ers-brain'},env),false);
 assert.equal(hostedIngestionAvailable(ctx.brain,{}),false);
 assert.equal(describeCapabilities(ctx.brain,'reader',{revisions:true}).operations.brain_source_prepare.authorization.role_allowed,false);
 const bytes=Buffer.from('fixture');const m=manifest(ctx.brainId,bytes);
 assert.equal(validateSessionManifest(ctx,m).sourceId,m.sourceId);
 for(const bad of [{...m,brainId:'ers-brain'},{...m,category:'../bad'},{...m,companionPath:'sources/writing_samples/../TASKS.md'},{...m,brainLinks:[{filename:'sources/secret.md',relation:'context'}]}])assert.throws(()=>validateSessionManifest(ctx,bad));
 assert.notEqual(sessionOwner(ctx),sessionOwner({...ctx,principal:{...ctx.principal,providerTenantId:randomUUID()}}));
});

test('scoped original upload grants never request replacement or reveal a Storage administration key',async()=>{
 const prior=globalThis.fetch;let request;
 globalThis.fetch=async(input,init)=>{request={url:String(input),init};return new Response(JSON.stringify({url:'/object/upload/sign/brain-artifacts/brain/sources/source/original/hash?token=fixture-grant'}),{status:200,headers:{'Content-Type':'application/json'}});};
 try{
  const adapter=new SupabaseIngestionAdapter('https://fixture.supabase.co','fixture-secret');
  const url=await adapter.uploadGrant('brain/sources/source/original/hash');
  assert.match(url,/object\/upload\/sign/);assert.ok(!url.includes('fixture-secret'));
  assert.equal(new Headers(request.init.headers).get('x-upsert'),null);
  assert.deepEqual(JSON.parse(request.init.body),{});
 }finally{globalThis.fetch=prior;}
});

test('session ingestion completes directly for both isolated Brains, retains policy and refuses stale/cross-owner work',async t=>{
 const url=process.env.BRAIN_POSTGRES_TEST_DATABASE_URL;if(!url)return t.skip('requires disposable local Postgres');
 assert.equal(new URL(url).hostname,'127.0.0.1');assert.equal(new URL(url).username,'brain_acceptance');
 const pool=new pg.Pool({connectionString:url,max:4,options:'-c role=brain_runtime'});
 const admin=new pg.Pool({connectionString:url,max:1});
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'session-ingestion-test-'));
 const ids=['test-jem-'+randomUUID(),'test-ers-'+randomUUID()];
 const prior={BRAIN_WRITE_POLICY_CONFIG:process.env.BRAIN_WRITE_POLICY_CONFIG,BRAIN_PLATFORM_CONFIG:process.env.BRAIN_PLATFORM_CONFIG};
 const policy={version:1,mode:'enforce',intake:'retired',capture_route:'capture-personal',task_paths:['TASKS.md','capture-queue.md']};
 await fs.writeFile(path.join(root,'registry.json'),JSON.stringify({version:1,brains:ids.map(id=>({id,type:'personal',template_used:'personal',integration_mode:'vertical',storage_backend:'postgres',storage_config:{},source_categories:['writing_samples']}))}));
 await fs.writeFile(path.join(root,'policy.json'),JSON.stringify({version:1,brains:ids.map((id,index)=>({id,write_policy:{...policy,...(index?{intake:'brain_scoped',capture_route:'capture-ers'}:{})}}))}));
 process.env.BRAIN_PLATFORM_CONFIG=path.join(root,'registry.json');process.env.BRAIN_WRITE_POLICY_CONFIG=path.join(root,'policy.json');
 try{
  for(const id of ids){
   await admin.query("insert into brain.brains(id,type,template_used,integration_mode) values($1,'personal','personal','vertical')",[id]);
   const ctx=context(id),jobs=new IngestionJobs(pool,sessionOwner(ctx),id,{provider:'entra',id:ctx.principal.providerUserId});
   const objects=new Map();let grants=0;const adapter={bucket:'fixture',read:async k=>objects.get(k)||null,put:async(k,b)=>{if(objects.has(k))throw Error('immutable');objects.set(k,Buffer.from(b));},uploadGrant:async k=>{grants++;return 'https://fixture.example/upload/'+k;}};
   const service=new HostedIngestion(ctx,jobs,adapter),auth=evidence(id),bytes=Buffer.from('Synthetic opaque Office bytes.'),m=manifest(id,bytes);
   await t.test(id+': reserve, upload verification, exact review, atomic apply and readable receipt',async()=>{
    const prepared=await service.prepare(m,auth);assert.equal(prepared.original_verified,false);assert.equal(grants,1);assert.equal(prepared.upload.method,'PUT');
    const reserved=await jobs.get(prepared.job_id);assert.equal((await service.prepare(m,auth)).job_id,reserved.id);
    await assert.rejects(service.prepare({...m,sourceId:randomUUID(),artifacts:[{...m.artifacts[0],id:randomUUID(),providerId:randomUUID()}]},auth),/companion_owned/);
    const foreign=new HostedIngestion({...ctx,principal:{...ctx.principal,providerUserId:randomUUID()}},new IngestionJobs(pool,'different-owner',id,{provider:'entra',id:'other'}),adapter);
    await assert.rejects(foreign.review(reserved.id,'Reviewed text',[],auth),/wrong_owner/);
    objects.set(sourceObjectKey(reserved),Buffer.from('wrong upload'));
    await assert.rejects(service.review(reserved.id,'Reviewed text',[],auth),/verification_failed/);
    objects.set(sourceObjectKey(reserved),bytes);
    await assert.rejects(service.review(reserved.id,'Reviewed text',[{filename:'TASKS.md',expectedRevision:'new',content:'- [ ] Dump transient work'}],auth),/general_intake_retired|brain_scope_required/);
    const doc='# Reviewed published essay\n'+('Meaningful published argument. '.repeat(1000));
    const reviewed=await service.review(reserved.id,doc,[{filename:'publications.md',expectedRevision:'new',content:'# Publications\nSelected essay [source](../'+m.companionPath+')'}],auth);
    assert.equal(reviewed.review.changes.length,3);assert.ok(reviewed.review.changes.some(c=>c.previousContent===null));
    await assert.rejects(service.apply(reserved.id,'0'.repeat(64),auth),/digest_mismatch/);
    const accepted=await service.apply(reserved.id,reviewed.review_digest,auth);assert.equal(accepted.stage,'complete');assert.equal(accepted.receipt.original.sha256,sha256(bytes));
    assert.match((await jobs.revisions.readFile(id,m.companionPath)).content,/Reviewed published essay/);
    assert.match((await jobs.revisions.readFile(id,'LOG.md')).content,/Source ingestion/);
    assert.deepEqual((await service.apply(reserved.id,reviewed.review_digest,auth)).receipt,accepted.receipt);
    assert.equal(accepted.local_inbox,'unobserved; no cleanup performed');
   });
   await t.test(id+': real MCP discovery and same-session text ingestion require no Capture',async()=>{
    const server=new McpServer({name:'fixture-brain',version:'1'});
    registerSourceIngestionTools(server,resolved=>new HostedIngestion(resolved,new IngestionJobs(pool,sessionOwner(resolved),resolved.brainId,{provider:'stdio',id:resolved.principal.providerUserId}),adapter));
    const client=new Client({name:'fixture-session',version:'1'});
    const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b);
    try{
     const names=(await client.listTools()).tools.map(x=>x.name);
     for(const name of ['brain_source_prepare','brain_source_review','brain_source_apply','brain_source_status'])assert.ok(names.includes(name));
     const call=async(name,args)=>{const result=await client.callTool({name,arguments:{brain_id:id,...args}});assert.notEqual(result.isError,true,JSON.stringify(result));return result.structuredContent;};
     const text='A selected source submitted through actual MCP '+id,mm=manifest(id,Buffer.from(text),'md');
     const prepared=await call('brain_source_prepare',{manifest:mm,original_text:text,write_context:auth});
     const reviewed=await call('brain_source_review',{job_id:prepared.job_id,content:text,changes:[],write_context:auth});
     const applied=await call('brain_source_apply',{job_id:prepared.job_id,review_digest:reviewed.review_digest,write_context:auth});
     assert.equal(applied.stage,'complete');
     const status=await call('brain_source_status',{job_id:prepared.job_id});assert.match(status.companion_baseline.content,/actual MCP/);
     assert.equal(status.companion_baseline.revision_id,applied.receipt.revisions.find(x=>x.filename===mm.companionPath).revisionId);
    }finally{await client.close();await server.close();}
   });
   await t.test(id+': inline long essay and stale replacement preserve originals and require fresh review',async()=>{
    const text='Published content. '.repeat(1600),raw=Buffer.from(text),m2=manifest(id,raw,'md');
    const prep=await service.prepare(m2,auth,text);assert.equal(prep.stage,'review');assert.equal(prep.original_verified,true);
    const head=await jobs.revisions.getHead(id,'publications.md');
    const review=await service.review(prep.job_id,text,[{filename:'publications.md',expectedRevision:head.revisionId,content:'Reviewed replacement'}],auth);
    await jobs.revisions.proposeRevision({brainId:id,filename:'publications.md',baseRevisionId:head.revisionId,content:'Concurrent sourced correction',origin:'hosted_mcp',writeContext:evidence(id)});
    await assert.rejects(service.apply(prep.job_id,review.review_digest,auth),/stale_review/);
    assert.equal((await jobs.get(prep.job_id)).original.verified,true);
    // A candidate previously approved before interruption can still be explicitly re-reviewed.
    await jobs.approve(prep.job_id,review.review_digest);
    const fresh=await service.review(prep.job_id,text,[],evidence(id));assert.equal(fresh.stage,'review');
    ctx.role='reader';await assert.rejects(service.apply(prep.job_id,review.review_digest,auth),/access denied/);ctx.role='member';
    await assert.rejects(service.review(prep.job_id,text,[{filename:'00_loader.md',expectedRevision:'new',content:'Replacement'}],auth),/admin|structural/);ctx.role='owner';
   });
  }
 }finally{
  for(const id of ids)await admin.query('delete from brain.brains where id=$1',[id]);
  for(const [key,value]of Object.entries(prior)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
  await pool.end();await admin.end();await fs.rm(root,{recursive:true,force:true});
 }
});
