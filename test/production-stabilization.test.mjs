import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { MemoryRevisionStore, LocalSyncAgent } from '../dist/sync/index.js';
import { RevisionBrainStore } from '../dist/services/revision-brain-store.js';
import { mutateLocalFile, inspectLocalRecovery } from '../dist/sync/recoverable-file.js';
import { contentHash } from '../dist/sync/hash.js';

async function fixture(fn) {
 const root=await fs.mkdtemp('/tmp/brain-stabilization-test-');
 try { await fn(root); } finally { await fs.rm(root,{recursive:true,force:true}); }
}
const B='test-brain';
async function seeded(root) {
 const store=new MemoryRevisionStore();const agent=new LocalSyncAgent({brainId:B,brainDir:root,stateFile:path.join(root,'.state.json'),store});
 const first=await store.proposeRevision({brainId:B,filename:'topic.md',baseRevisionId:null,content:'base',origin:'hosted_mcp'});
 await agent.pullHostedChanges();return {store,agent,first};
}

test('late save immediately before displacement survives replacement and deletion',async()=>{
 for(const content of ['remote',null]) await fixture(async root=>{
  const target=path.join(root,'topic.md');await fs.writeFile(target,'base');
  const rename=fs.rename;let injected=false;
  fs.rename=async function(a,b){if(a===target&&!injected){injected=true;await fs.writeFile(target,'manual');}return rename(a,b);};
  let result;try{result=await mutateLocalFile(root,'topic.md',content,contentHash('base'));}finally{fs.rename=rename;}
  assert.equal(result.ok,false);assert.equal(await fs.readFile(target,'utf8'),'manual');
  assert.equal(await fs.readFile(result.recoveryPath,'utf8'),'manual');
 });
});

test('an open descriptor can save after completion without losing its bytes',()=>fixture(async root=>{
 const target=path.join(root,'topic.md');await fs.writeFile(target,'base');
 const fd=await fs.open(target,'r+');
 try{
  const result=await mutateLocalFile(root,'topic.md','remote',contentHash('base'));
  assert.equal(result.ok,true);await fd.truncate(0);await fd.write('late manual',0,'utf8');await fd.sync();
  assert.equal(await fs.readFile(result.recoveryPath,'utf8'),'late manual');
  const observations=await inspectLocalRecovery(root);
  assert.equal(observations[0].contentHash,contentHash('late manual'));
  assert.equal(await fs.readFile(target,'utf8'),'remote');
 }finally{await fd.close();}
}));

test('new pathname created after displacement is never replaced',()=>fixture(async root=>{
 const target=path.join(root,'topic.md');await fs.writeFile(target,'base');const link=fs.link;
 fs.link=async function(a,b){if(b===target)await fs.writeFile(target,'new manual',{flag:'wx'});return link(a,b);};
 let result;try{result=await mutateLocalFile(root,'topic.md','remote',contentHash('base'));}finally{fs.link=link;}
 assert.equal(result.ok,false);assert.equal(await fs.readFile(target,'utf8'),'new manual');
 assert.equal(await fs.readFile(result.recoveryPath,'utf8'),'base');
}));

test('interruption after displacement restores only an absent destination',async()=>{
 for(const saved of [false,true])await fixture(async root=>{
  const target=path.join(root,'topic.md');await fs.writeFile(target,'base');const rename=fs.rename;
  fs.rename=async function(a,b){await rename(a,b);if(a===target)throw new Error('simulated process interruption');};
  try{await assert.rejects(mutateLocalFile(root,'topic.md','remote',contentHash('base')),/interruption/);}finally{fs.rename=rename;}
  if(saved)await fs.writeFile(target,'new save');
  await inspectLocalRecovery(root);assert.equal(await fs.readFile(target,'utf8'),saved?'new save':'base');
 });
});

test('stale reviewed replacement refuses without changing the head',async()=>{
 const revisions=new MemoryRevisionStore();const store=new RevisionBrainStore(revisions);
 await store.writeFile(B,'topic.md','base','replace');const a=await store.readFileSnapshot(B,'topic.md');const b=await store.readFileSnapshot(B,'topic.md');
 await store.writeFile(B,'topic.md','A','replace',undefined,undefined,undefined,a.revisionId);
 await assert.rejects(store.writeFile(B,'topic.md','B','replace',undefined,undefined,undefined,b.revisionId),/Stale/);
 await assert.rejects(store.writeFile(B,'topic.md','unsafe','replace'),/expected_revision/);
 assert.equal(await store.readFile(B,'topic.md'),'A');
});

test('reviewed resolutions converge, but later local saves stay protected',async()=>{
 for(const content of ['local','remote','merged'])for(const late of [false,true])await fixture(async root=>{
  const {store,agent,first}=await seeded(root);await fs.writeFile(path.join(root,'topic.md'),'local');
  const remote=await store.proposeRevision({brainId:B,filename:'topic.md',content:'remote',baseRevisionId:first.head.revisionId,origin:'hosted_mcp'});
  const conflict=(await agent.syncOnce()).conflicts[0];
  await store.resolveConflict({brainId:B,conflictId:conflict.conflictId,content,expectedRevisionId:remote.head.revisionId});
  if(late)await fs.writeFile(path.join(root,'topic.md'),'later manual');
  const report=await agent.syncOnce();assert.equal(await fs.readFile(path.join(root,'topic.md'),'utf8'),late?'later manual':content);
  assert.equal(report.conflicts.length>0,late);
 });
});

test('stale conflict review remains open and preserves a newer head',()=>fixture(async root=>{
 const {store,agent,first}=await seeded(root);await fs.writeFile(path.join(root,'topic.md'),'local');
 const remote=await store.proposeRevision({brainId:B,filename:'topic.md',content:'remote',baseRevisionId:first.head.revisionId,origin:'hosted_mcp'});
 const conflict=(await agent.syncOnce()).conflicts[0];
 const newer=await store.proposeRevision({brainId:B,filename:'topic.md',content:'newer',baseRevisionId:remote.head.revisionId,origin:'hosted_mcp'});
 await assert.rejects(store.resolveConflict({brainId:B,conflictId:conflict.conflictId,content:'old merge',expectedRevisionId:remote.head.revisionId}),/Stale/);
 assert.equal((await store.getHead(B,'topic.md')).revisionId,newer.head.revisionId);
 assert.equal((await store.listConflicts(B,'open')).length,1);
}));

test('incomplete inventories reset pending deletions and create no tombstones',()=>fixture(async root=>{
 const {store,agent}=await seeded(root);await fs.mkdir(path.join(root,'small'));await fs.writeFile(path.join(root,'small','kept.md'),'keep');await agent.syncOnce();
 const readdir=fs.readdir;fs.readdir=async function(p,...args){if(p===path.join(root,'small'))throw Object.assign(new Error('unreadable'),{code:'EACCES'});return readdir(p,...args);};
 try{for(let i=0;i<2;i++){const r=await agent.syncOnce();assert.match(r.guardTripped,/incomplete_scan/);}}finally{fs.readdir=readdir;}
 assert.equal((await store.getHead(B,'small/kept.md')).deleted,false);
 assert.deepEqual((await agent.loadState()).pendingDeletions,[]);
}));

test('pull reads the exact listed revision despite a concurrent newer head',()=>fixture(async root=>{
 const {store,agent,first}=await seeded(root);
 const second=await store.proposeRevision({brainId:B,filename:'topic.md',content:'v2',baseRevisionId:first.head.revisionId,origin:'hosted_mcp'});
 const read=store.readRevision.bind(store);let changed=false;
 store.readRevision=async(...args)=>{if(!changed){changed=true;await store.proposeRevision({brainId:B,filename:'topic.md',content:'v3',baseRevisionId:second.head.revisionId,origin:'hosted_mcp'});}return read(...args);};
 await agent.pullHostedChanges();const state=await agent.loadState();const bytes=await fs.readFile(path.join(root,'topic.md'),'utf8');
 assert.equal(bytes,'v2');assert.equal(state.files['topic.md'].localHash,contentHash(bytes));
 await agent.pullHostedChanges();assert.equal(await fs.readFile(path.join(root,'topic.md'),'utf8'),'v3');
}));


test('recovery capacity fails before displacing a file',()=>fixture(async root=>{
 const target=path.join(root,'topic.md');await fs.writeFile(target,'manual');
 const previous=process.env.BRAIN_SYNC_RECOVERY_MAX_BYTES;process.env.BRAIN_SYNC_RECOVERY_MAX_BYTES='1';
 try{await assert.rejects(mutateLocalFile(root,'topic.md','remote',contentHash('manual')),/local_recovery_capacity/);}
 finally{if(previous===undefined)delete process.env.BRAIN_SYNC_RECOVERY_MAX_BYTES;else process.env.BRAIN_SYNC_RECOVERY_MAX_BYTES=previous;}
 assert.equal(await fs.readFile(target,'utf8'),'manual');
}));

test('unsupported no-replace filesystem fails before touching user bytes',()=>fixture(async root=>{
 const target=path.join(root,'topic.md');await fs.writeFile(target,'manual');const link=fs.link;
 fs.link=async()=>{throw Object.assign(new Error('unsupported'),{code:'ENOTSUP'});};
 try{await assert.rejects(mutateLocalFile(root,'topic.md','remote',contentHash('manual')),/unsupported/);}
 finally{fs.link=link;}
 assert.equal(await fs.readFile(target,'utf8'),'manual');
}));
