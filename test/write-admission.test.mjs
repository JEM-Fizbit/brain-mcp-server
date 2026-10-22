import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {MemoryRevisionStore} from "../dist/sync/memory-revision-store.js";
import {FileRevisionStore} from "../dist/sync/file-revision-store.js";
import {RevisionBrainStore} from "../dist/services/revision-brain-store.js";
import {FilesystemBrainStore} from "../dist/services/brain-store.js";
import {LocalSyncAgent} from "../dist/sync/local-sync-agent.js";
import {contentHash} from "../dist/sync/hash.js";
import {internalWriteContext,activeQueueBlocks} from "../dist/services/write-policy.js";
import {changePage} from "../dist/monitor/change-page.js";

const brain="test-write-policy",other="test-other-policy";
const policy={version:1,mode:"enforce",intake:"retired",capture_route:"capture-personal",task_paths:["TASKS.md","capture-queue.md"],review_base_url:"https://brain.example",max_receipt_chars:2000};
async function fixture(t) {
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"brain-admission-"));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const config=path.join(root,"registry.json"),dir=path.join(root,"brain");await fs.mkdir(dir);
 process.env.BRAIN_PLATFORM_CONFIG=config;process.env.BRAIN_MONITOR_CONFIG_FILE="";
 delete process.env.BRAIN_REQUIRED_WRITE_POLICY;delete process.env.BRAIN_WRITE_POLICY_CONFIG;
 await fs.writeFile(config,JSON.stringify({version:1,default_brain_id:brain,brains:[brain,other].map(id=>({id,type:"personal",template_used:"personal",integration_mode:"vertical",storage_backend:"filesystem",storage_config:{brain_dir:dir},write_policy:policy}))}));
 return {root,dir,config};
}
const source="Authoritative fixture: the canonical project URL is https://project.example/new .\n";
const ctx=(revision,overrides={})=>({operation_id:randomUUID(),kind:"source_backed",reason:"Correct the project URL from its current owner document.",evidence:[{brain_id:brain,reference:"SOURCE.md",observed_at:new Date().toISOString(),method:"hosted_source",verification:"agent_observed",revision,excerpt:source.trim()}],...overrides});
async function seed(store,filename,content,id=brain) {return store.proposeRevision({brainId:id,filename,content,baseRevisionId:(await store.getHead(id,filename))?.revisionId||null,origin:"system",writeContext:internalWriteContext("synthetic approved fixture")});}

for(const backend of ["memory","file"]) test(backend+": automatic corrections, unread logs, exact replay, evidence and routing",async t=>{
 const f=await fixture(t),store=backend==="memory"?new MemoryRevisionStore():new FileRevisionStore(path.join(f.root,"revisions.json")),brainStore=new RevisionBrainStore(store);
 const src=await seed(store,"SOURCE.md",source);
 await seed(store,"CONTEXT.md","Old URL.\n");await seed(store,"TASKS.md","# TASKS\n\n- Transferred: historical record → Capture\n");
 const first=ctx(src.head.revisionId),initial=await store.getHead(brain,"CONTEXT.md");
 const args=[brain,"CONTEXT.md","Canonical URL: https://project.example/new .\n","replace",undefined,{provider:"fixture",id:"agent"},"member",initial.revisionId,first];
 assert.match(await brainStore.writeFile(...args),/exact read-back verified/);
 // No read/acknowledgement of LOG occurs before the second automatic correction.
 const second=ctx(src.head.revisionId),head=await store.getHead(brain,"CONTEXT.md");
 assert.match(await brainStore.writeFile(brain,"CONTEXT.md","Stable owner link: https://project.example/new .\n","replace",undefined,args[5],"member",head.revisionId,second),/verified/);
 const afterSecond=(await store.listChanges(brain)).changes.length;
 assert.match(await brainStore.writeFile(...args),/Already applied/);
 assert.equal((await store.listChanges(brain)).changes.length,afterSecond);
 await assert.rejects(brainStore.writeFile(...args.map((value,i)=>i===2?"Another request":value)),/operation_identity_conflict/);
 const log=await brainStore.readFile(brain,"LOG.md");
 assert.equal((log.match(/Automatic source-backed update/g)||[]).length,2);
 assert.match(log,/Before: Old URL/);assert.match(log,/Source: SOURCE.md/);assert.match(log,/Manual review is optional/);
 assert.match(log,/https:\/\/brain.example\/monitor\/changes\//);
 const record=JSON.parse(await brainStore.readChange(brain,(await store.findWriteOperation(brain,first.operation_id)).revisionId));
 assert.equal(record.before,"Old URL.\n");assert.equal(record.context.verification,"verified");assert.equal(record.context.evidence[0].verification,"retrieved");
 assert.match(record.after,/canonical|Canonical/);
 const unchanged=await brainStore.readFile(brain,"CONTEXT.md"),current=await store.getHead(brain,"CONTEXT.md");
 for(const content of ["user: dump this chat\nassistant: copied\n","- [ ] Deploy the current draft\n"]) {
   await assert.rejects(brainStore.writeFile(brain,"CONTEXT.md",content,"replace",undefined,undefined,"member",current.revisionId,ctx(src.head.revisionId)),/transient_work_route/);
 }
 await assert.rejects(brainStore.writeFile(brain,"CONTEXT.md","A fact","replace",undefined,undefined,"member",current.revisionId),/source_evidence_required/);
 const wrong=ctx(src.head.revisionId);wrong.evidence[0].brain_id=other;
 await assert.rejects(brainStore.writeFile(brain,"CONTEXT.md","A fact","replace",undefined,undefined,"member",current.revisionId,wrong),/source_domain_mismatch/);
 await seed(store,"SOURCE.md",source+"Source changed.\n");
 await assert.rejects(brainStore.writeFile(brain,"CONTEXT.md","A fact","replace",undefined,undefined,"member",current.revisionId,ctx(src.head.revisionId)),/stale_write_context/);
 assert.equal(await brainStore.readFile(brain,"CONTEXT.md"),unchanged);
 const task=await store.getHead(brain,"TASKS.md");
 for(const [mode,body,old] of [["append","\n## Renamed heading\n\n- [ ] New work\n"],["replace","# Tasks\n\n- [ ] New work\n"],["patch","- [ ] New work","- Transferred: historical record → Capture"]]) {
  await assert.rejects(brainStore.writeFile(brain,"TASKS.md",body,mode,old,undefined,"member",task.revisionId,ctx("unused")),/general_intake_retired/);
 }
 for(const filename of ["tasks.md","capture-queue.md"]) await assert.rejects(store.proposeRevision({brainId:brain,filename,baseRevisionId:null,content:"# Queue\n\nNew pending request without a checkbox.\n",origin:"import",writeContext:internalWriteContext("forged import intent")}),/general_intake_retired/);
 await assert.rejects(brainStore.appendLog(brain,"UPDATE",["CONTEXT.md"],"x".repeat(2001)),/receipt_requires_summary/);
 assert.equal((await store.listConflicts(brain)).length,0);
});

test("complete queue blocks retain multiplicity and nested details",()=>{
 assert.deepEqual(activeQueueBlocks("# TASKS\n\n- [ ] A\n  Details: B\n"),["- [ ] A\n  Details: B"]);
 assert.deepEqual(activeQueueBlocks("# TASKS\n\n- Transferred: history\n- [ ] Adjacent capture\n"),["- [ ] Adjacent capture"]);
 assert.deepEqual(activeQueueBlocks("# TASKS\n\n- Transferred: history\n  - [ ] Nested capture\n"),["- [ ] Nested capture"]);
});

test("automatic audit failure rolls back the mutation in memory",async t=>{
 await fixture(t);const store=new MemoryRevisionStore();const src=await seed(store,"SOURCE.md",source);
 const original=store.applyRevision.bind(store);
 store.applyRevision=async input=>{if(input.filename==="LOG.md")throw Error("synthetic audit failure");return original(input);};
 await assert.rejects(store.proposeRevision({brainId:brain,filename:"FACT.md",baseRevisionId:null,content:"Canonical URL.\n",origin:"hosted_mcp",writeContext:ctx(src.head.revisionId)}),/audit failure/);
 assert.equal(await store.getHead(brain,"FACT.md"),null);assert.equal(await store.getHead(brain,"LOG.md"),null);
});

test("filesystem/stdio writes journal exact evidence, log and replay; retired rename is refused",async t=>{
 const f=await fixture(t),store=new FilesystemBrainStore();
 await fs.writeFile(path.join(f.dir,"SOURCE.md"),source);await fs.writeFile(path.join(f.dir,"FACT.md"),"Old.\n");
 const context=ctx(contentHash(source)),args=[brain,"FACT.md","Correct URL.\n","replace",undefined,{provider:"stdio",id:"fixture"},"member",contentHash("Old.\n"),context];
 assert.match(await store.writeFile(...args),/exact read-back verified/);
 assert.match(await store.writeFile(...args),/Already applied/);
 const record=JSON.parse(await store.readChange(brain,context.operation_id));assert.equal(record.before,"Old.\n");assert.equal(record.context.verification,"verified");
 assert.match(await fs.readFile(path.join(f.dir,"LOG.md"),"utf8"),/Manual review is optional/);
 await fs.writeFile(path.join(f.dir,"INCOMING.md"),"- [ ] Work\n");
 await assert.rejects(store.renameFile(brain,"INCOMING.md","TASKS.md",undefined,"admin"),/general_intake_retired/);
 assert.equal(await fs.readFile(path.join(f.dir,"INCOMING.md"),"utf8"),"- [ ] Work\n");
});

test("sync automatically applies evidenced corrections and preserves unrelated held bytes/base across remote edits",async t=>{
 const f=await fixture(t),store=new MemoryRevisionStore();
 for(const [name,body] of [["00_loader.md","# Loader\n"],["NOW.md","# Now\n"],["SOURCE.md",source],["GOOD.md","Old good.\n"],["HELD.md","Old held.\n"]])await seed(store,name,body);
 const stateFile=path.join(f.root,"state.json"),agent=new LocalSyncAgent({brainId:brain,brainDir:f.dir,stateFile,store,actor:{provider:"local",id:"fixture"}});
 await agent.pullHostedChanges();const state=await agent.loadState(),base=state.files["HELD.md"].revisionId;
 const good="Current canonical link.\n",held="Transient session status.\n";
 await fs.writeFile(path.join(f.dir,"GOOD.md"),good);await fs.writeFile(path.join(f.dir,"HELD.md"),held);
 await fs.writeFile(stateFile+".write-context.json",JSON.stringify({"GOOD.md":{base_revision:state.files["GOOD.md"].revisionId,result_hash:contentHash(good),context:ctx((await store.getHead(brain,"SOURCE.md")).revisionId)}}));
 const result=await agent.syncOnce();assert.ok(result.pushed.includes("GOOD.md"));assert.equal(result.conflicts.length,0);
 assert.equal(result.admissionHeld[0].code,"source_evidence_required");
 assert.equal((await store.readFile(brain,"GOOD.md")).content,good);assert.equal((await store.readFile(brain,"HELD.md")).content,"Old held.\n");
 await seed(store,"HELD.md","Remote correction.\n");
 const repeated=await agent.syncOnce();assert.equal(repeated.conflicts.length,0);
 assert.equal(await fs.readFile(path.join(f.dir,"HELD.md"),"utf8"),held);
 assert.equal((await agent.loadState()).files["HELD.md"].revisionId,base);
 assert.equal((await store.listConflicts(brain)).length,0);
});


test("Brain-scoped TASKS requires actual maintenance target evidence while ordinary corrections remain automatic",async t=>{
 const f=await fixture(t);const config=JSON.parse(await fs.readFile(f.config,"utf8"));
 config.brains[0].write_policy={...policy,intake:"brain_scoped",capture_route:"capture-ers"};await fs.writeFile(f.config,JSON.stringify(config));
 const store=new MemoryRevisionStore(),surface=new RevisionBrainStore(store),src=await seed(store,"SOURCE.md",source);
 await seed(store,"TASKS.md","# Brain maintenance\n");
 const head=await store.getHead(brain,"TASKS.md"),content="# Brain maintenance\n\n- [ ] Repair the source link in SOURCE.md\n";
 await assert.rejects(surface.writeFile(brain,"TASKS.md",content,"replace",undefined,undefined,"member",head.revisionId,ctx(src.head.revisionId)),/brain_scope_required/);
 const context=ctx(src.head.revisionId,{maintenance:{kind:"link_repair",brain_target:"SOURCE.md"}});
 assert.match(await surface.writeFile(brain,"TASKS.md",content,"replace",undefined,undefined,"member",head.revisionId,context),/verified/);
 const absent=ctx(src.head.revisionId,{maintenance:{kind:"content_gap",brain_target:"ABSENT.md"}});
 await assert.rejects(surface.writeFile(brain,"TASKS.md",content+"\nAnother item\n","replace",undefined,undefined,"member",(await store.getHead(brain,"TASKS.md")).revisionId,absent),/brain_scope_required/);
});

test("retired queue blocks nested changes, duplicate records, restore and rename without losing history",async t=>{
 const f=await fixture(t),config=JSON.parse(await fs.readFile(f.config,"utf8"));
 config.brains[0].write_policy.mode="observe";config.brains[0].write_policy.intake="legacy";await fs.writeFile(f.config,JSON.stringify(config));
 const store=new MemoryRevisionStore(),surface=new RevisionBrainStore(store);
 const original="# TASKS\n\n- [ ] Existing historical intake\n  Details: original\n";
 await seed(store,"TASKS.md",original);
 const live=await store.getHead(brain,"TASKS.md");
 await store.proposeDeletion({brainId:brain,filename:"TASKS.md",baseRevisionId:live.revisionId,origin:"system"});
 await seed(store,"INCOMING.md",original);
 config.brains[0].write_policy=policy;await fs.writeFile(f.config,JSON.stringify(config));
 await assert.rejects(surface.restoreFile(brain,"TASKS.md",undefined,"admin"),/general_intake_retired/);
 await assert.rejects(surface.renameFile(brain,"INCOMING.md","capture-queue.md",undefined,"admin"),/general_intake_retired/);
 assert.equal((await store.getHead(brain,"TASKS.md")).deleted,true);
 assert.equal((await store.readFile(brain,"INCOMING.md")).content,original);
});

test("required policy fails closed, and external observations retain their actual verification scope",async t=>{
 const f=await fixture(t),store=new MemoryRevisionStore();
 process.env.BRAIN_REQUIRED_WRITE_POLICY=brain;
 const config=JSON.parse(await fs.readFile(f.config,"utf8"));delete config.brains[0].write_policy;
 await fs.writeFile(f.config,JSON.stringify(config));
 await assert.rejects(seed(store,"FACT.md","A fact.\n"),/policy_unavailable/);
 config.brains[0].write_policy=policy;await fs.writeFile(f.config,JSON.stringify(config));
 const context=ctx("provider-revision");context.evidence[0]={...context.evidence[0],reference:"https://provider.example/project",method:"connector_read",verification:"retrieved"};
 const result=await store.proposeRevision({brainId:brain,filename:"FACT.md",baseRevisionId:null,content:"A stable fact.\n",origin:"hosted_mcp",writeContext:context});
 assert.equal(result.revision.writeContext.evidence[0].verification,"agent_observed");
 assert.match(result.revision.writeContext.policy_digest,/^[a-f0-9]{64}$/);
});

test("filesystem retries serialize; interrupted audit recovers once without replacing later content",async t=>{
 const f=await fixture(t),store=new FilesystemBrainStore();await fs.writeFile(path.join(f.dir,"SOURCE.md"),source);
 const context=ctx(contentHash(source)),args=[brain,"FACT.md","A stable fact.\n","replace",undefined,{provider:"stdio",id:"fixture"},"member",null,context];
 const results=await Promise.all([store.writeFile(...args),store.writeFile(...args)]);
 assert.ok(results.some(r=>r.includes("Already applied")));
 const journal=path.join(f.dir,".brain-write-journal",context.operation_id+".json"),record=JSON.parse(await fs.readFile(journal,"utf8"));
 record.phase="applied_audit_pending";record.result="applied; audit pending";await fs.writeFile(journal,JSON.stringify(record));
 const later="A later human edit.\n";await fs.writeFile(path.join(f.dir,"FACT.md"),later);
 assert.match(await store.writeFile(...args),/Already applied/);
 assert.equal(await fs.readFile(path.join(f.dir,"FACT.md"),"utf8"),later);
 const log=await fs.readFile(path.join(f.dir,"LOG.md"),"utf8");assert.equal((log.match(/Automatic source-backed update/g)||[]).length,1);
});


test("actual stdio MCP admits sourced corrections, records local actor and refuses both retired aliases",async t=>{
 const f=await fixture(t);await fs.writeFile(path.join(f.dir,"SOURCE.md"),source);
 const {Client}=await import("@modelcontextprotocol/sdk/client/index.js");
 const {StdioClientTransport}=await import("@modelcontextprotocol/sdk/client/stdio.js");
 const client=new Client({name:"spec023-stdio-fixture",version:"1"});
 const transport=new StdioClientTransport({command:process.execPath,args:[new URL("../dist/index.js",import.meta.url).pathname],stderr:"pipe",
   env:{...process.env,TRANSPORT:"stdio",BRAIN_DIR:f.dir,BRAIN_PLATFORM_CONFIG:f.config,BRAIN_REVISION_STORE:"",BRAIN_EXPERIMENTAL_REVISION_STORE_FILE:"",BRAIN_WRITE_POLICY_CONFIG:"",BRAIN_AUTO_SYNC:"0",BRAIN_AUTO_PUSH:"0",BRAIN_LOAD_LOCAL_ENV:"0",BRAIN_MONITOR_CONFIG_FILE:""}});
 await client.connect(transport);t.after(()=>client.close());
 for(const name of ["brain_capture_item","brain_report_item"]) {
   const result=await client.callTool({name,arguments:{brain_id:brain,kind:"follow_up",title:"General task"}});
   assert.equal(result.structuredContent.error.code,"general_intake_retired");
 }
 const read=await client.callTool({name:"brain_read_file",arguments:{brain_id:brain,filename:"SOURCE.md"}});
 const context=ctx(read.structuredContent.revision_id);
 const applied=await client.callTool({name:"brain_update_file",arguments:{brain_id:brain,filename:"FACT.md",mode:"replace",expected_revision:"new",content:"The canonical project URL.\n",write_context:context}});
 assert.notEqual(applied.isError,true,JSON.stringify(applied));assert.match(applied.content[0].text,/exact read-back verified/);
 const record=await client.callTool({name:"brain_read_change",arguments:{brain_id:brain,revision_id:context.operation_id}});
 assert.equal(JSON.parse(record.content[0].text).actor.provider,"stdio");
 await assert.rejects(fs.stat(path.join(f.dir,"TASKS.md")),/ENOENT/);
});


for(const manualNote of [false,true])test("filesystem evidence handoff to hosted sync "+(manualNote?"preserves mixed manual LOG notes":"reconciles generated LOG without a duplicate"),async t=>{
 const f=await fixture(t),hosted=new MemoryRevisionStore();
 for(const [name,body] of [["00_loader.md","# Loader\n"],["NOW.md","# Now\n"],["SOURCE.md",source],["FACT.md","Old fact.\n"]])await seed(hosted,name,body);
 const agent=new LocalSyncAgent({brainId:brain,brainDir:f.dir,stateFile:path.join(f.root,"state.json"),store:hosted,actor:{provider:"sync",id:"relay"}});
 await agent.pullHostedChanges();const local=new FilesystemBrainStore(),context=ctx(contentHash(source));
 assert.match(await local.writeFile(brain,"FACT.md","Corrected durable fact.\n","replace",undefined,{provider:"stdio",id:"author"},"member",contentHash("Old fact.\n"),context),/verified/);
 if(manualNote)await fs.appendFile(path.join(f.dir,"LOG.md"),"\nManual private session note; preserve this locally.\n");
 const report=await agent.syncOnce();assert.ok(report.pushed.includes("FACT.md"));assert.equal(report.conflicts.length,0);
 assert.equal((await hosted.readFile(brain,"FACT.md")).content,"Corrected durable fact.\n");
 const record=JSON.parse(await new RevisionBrainStore(hosted).readChange(brain,context.operation_id));
 assert.equal(record.actor.id,"author");assert.equal(record.context.evidence[0].sha256,contentHash(source));
 assert.equal((record.after),"Corrected durable fact.\n");
 const remoteLog=(await hosted.readFile(brain,"LOG.md")).content,localLog=await fs.readFile(path.join(f.dir,"LOG.md"),"utf8");
 assert.equal((remoteLog.match(/Automatic source-backed update/g)||[]).length,1);
 if(manualNote) {
   assert.ok(report.admissionHeld.some(h=>h.filename==="LOG.md"));
   assert.match(localLog,/Manual private session note/);
   assert.doesNotMatch(remoteLog,/Manual private session note/);
 } else {
   assert.deepEqual(report.admissionHeld||[],[]);assert.equal(localLog,remoteLog);
   const repeated=await agent.syncOnce();assert.equal(repeated.conflicts.length,0);
   assert.deepEqual(repeated.admissionHeld||[],[]);
 }
});


test("pull-only policy holds preserve dirty bytes and base without manufacturing conflicts",async t=>{
 const f=await fixture(t),store=new MemoryRevisionStore();
 await seed(store,"FACT.md","Base.\n");
 const stateFile=path.join(f.root,"state.json"),agent=new LocalSyncAgent({brainId:brain,brainDir:f.dir,stateFile,store});
 await agent.pullHostedChanges();const before=(await agent.loadState()).files["FACT.md"].revisionId;
 await fs.writeFile(path.join(f.dir,"FACT.md"),"Unproven local session material.\n");
 await seed(store,"FACT.md","Remote durable correction.\n");
 const report=await agent.pullHostedChanges();
 assert.equal(report.conflicts.length,0);assert.equal(report.admissionHeld[0].code,"source_evidence_required");
 assert.equal(await fs.readFile(path.join(f.dir,"FACT.md"),"utf8"),"Unproven local session material.\n");
 assert.equal((await agent.loadState()).files["FACT.md"].revisionId,before);
 assert.equal((await store.listConflicts(brain)).length,0);
});

test("LOG cannot act as a short task queue or be rewritten through the generic knowledge lane",async t=>{
 await fixture(t);const store=new MemoryRevisionStore(),surface=new RevisionBrainStore(store),src=await seed(store,"SOURCE.md",source);
 await assert.rejects(surface.appendLog(brain,"UPDATE",[],"- [ ] New pending personal work"),/transient_work_route/);
 assert.equal(await store.getHead(brain,"LOG.md"),null);
 await assert.rejects(surface.writeFile(brain,"LOG.md","An untyped log replacement.\n","replace",undefined,undefined,"member",null,ctx(src.head.revisionId)),/receipt_tool_required/);
 assert.equal(await store.getHead(brain,"LOG.md"),null);
});

test("change view escapes embedded source instructions and HTML",()=>{
 const page=changePage({filename:"FACT.md",brain_id:brain,context:{reason:"<script>injected()</script>",verification:"verified"},before:"<img src=x onerror=attack()>",after:"Safe."});
 assert.doesNotMatch(page,/<script>|<img/);assert.match(page,/&lt;script&gt;/);assert.match(page,/Manual review is optional/);
});
