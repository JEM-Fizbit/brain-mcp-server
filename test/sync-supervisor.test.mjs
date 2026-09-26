import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {FileRevisionStore} from '../dist/sync/file-revision-store.js';
import {wakeGraceUntil} from '../dist/sync/supervisor.js';

const url = name => new URL(`../dist/sync/${name}.js`, import.meta.url).href;
async function waitFor(fn, ms=12000) {
  const end=Date.now()+ms; while(Date.now()<end) { const value=await fn(); if(value)return value; await new Promise(r=>setTimeout(r,30)); }
  throw Error('condition timed out');
}
async function json(file) {try{return JSON.parse(await fs.readFile(file,'utf8'));}catch{return null;}}
async function fixture(t,mode) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'sync-supervisor-')); const brainDir=path.join(root,'brain');
  await fs.mkdir(brainDir);await fs.writeFile(path.join(brainDir,'NOW.md'),'Local work survives\n');
  await fs.writeFile(path.join(brainDir,'00_loader.md'),'Loader\n');
  const state=path.join(root,'state.json'),health=state+'.health.json',marker=path.join(root,'starts.json');
  const storeFile=path.join(root,'store.json');const store=new FileRevisionStore(storeFile);
  await store.proposeRevision({brainId:'fixture',filename:'remote.md',baseRevisionId:null,content:'Remote change\n',origin:'hosted_mcp'});
  const preload=path.join(root,'preload.mjs');
  await fs.writeFile(preload,`import fs from 'node:fs';import {LocalSyncAgent} from ${JSON.stringify(url('local-sync-agent'))};
    const marker=${JSON.stringify(marker)}; let a=[];try{a=JSON.parse(fs.readFileSync(marker));}catch{};
    a.push(process.pid);fs.writeFileSync(marker,JSON.stringify(a));
    if(${JSON.stringify(mode)}==='once') {
      const original=LocalSyncAgent.prototype.syncOnce; let calls=0;
      LocalSyncAgent.prototype.syncOnce=async function(){if(calls++)while(true){};return original.call(this);};
    } else if(${JSON.stringify(mode)}==='exhaust'||(${JSON.stringify(mode)}!=='healthy'&&a.length===1)){
      if(${JSON.stringify(mode)}==='freeze') LocalSyncAgent.prototype.syncOnce=async()=>{while(true){}};
      else LocalSyncAgent.prototype.syncOnce=async()=>{throw Error('Synthetic database interruption');};
    }`);
  const harness=path.join(root,'supervisor.mjs');
  await fs.writeFile(harness,`import {runSupervisor} from ${JSON.stringify(url('supervisor'))};
    await runSupervisor(${JSON.stringify({brainId:'fixture',healthFile:health,lockFile:state+'.lock',
      worker:['--import',preload,new URL('../dist/sync/cli.js',import.meta.url).pathname,'watch'],
      tickMs:25,deadlineMs:1500,stopGraceMs:100,wakeGraceMs:1500,stableMs:200,retryDelays:[60,120]})});`);
  const env={...process.env,BRAIN_ID:'fixture',BRAIN_DIR:brainDir,BRAIN_SYNC_STATE_FILE:state,
    BRAIN_SYNC_HEALTH_FILE:health,BRAIN_SYNC_STORE_FILE:storeFile,BRAIN_REVISION_STORE:'file',
    BRAIN_REVISION_DATABASE_URL:'',BRAIN_SYNC_LOAD_LOCAL_ENV:'0',BRAIN_MONITOR_CONFIG_FILE:'',
    BRAIN_SYNC_INTERVAL_MS:'250',BRAIN_SYNC_CYCLE_TIMEOUT_MS:'10000'};
  let child; const start=()=>{child=spawn(process.execPath,[harness],{env,stdio:'ignore'});return child;};start();
  t.after(async()=>{if(child.exitCode===null){const ended=once(child,'exit');child.kill('SIGTERM');await ended;}await fs.rm(root,{recursive:true,force:true});});
  return {root,brainDir,health,marker,start,get child(){return child;},report:()=>json(health+'.supervision.json')};
}
for(const mode of ['freeze','database'])test(`independent supervisor recovers ${mode}, waits for old exit and converges without losing local work`,async t=>{
 const f=await fixture(t,mode);
 const done=await waitFor(async()=>{const d=await f.report();return d?.state==='running'&&d.attempts===0&&d.history.some(e=>e.kind==='recovered')&&d;});
 const pids=await json(f.marker);assert.equal(pids.length,2);assert.equal(done.workerPid,pids[1]);
 assert.throws(()=>process.kill(pids[0],0),{code:'ESRCH'});
 assert.equal(await fs.readFile(path.join(f.brainDir,'NOW.md'),'utf8'),'Local work survives\n');
 assert.equal(await fs.readFile(path.join(f.brainDir,'remote.md'),'utf8'),'Remote change\n');
 assert.equal((await json(f.health)).report.conflicts,0);
 if(mode==='freeze')assert.ok(done.history.some(e=>e.kind==='stop_requested'));
});
test('repeated failure exhausts budget, survives supervisor restart, and retries only on explicit request',async t=>{
 const f=await fixture(t,'exhaust'); const d=await waitFor(async()=>{const d=await f.report();return d?.state==='needs_attention'&&d;});
 assert.equal(d.attempts,2);assert.equal((await json(f.marker)).length,3);assert.equal(d.workerPid,null);
 const ended=once(f.child,'exit');f.child.kill('SIGTERM');await ended;f.start();
 await new Promise(r=>setTimeout(r,350));assert.equal((await f.report()).state,'needs_attention');assert.equal((await json(f.marker)).length,3);
 f.child.kill('SIGUSR1');
 await waitFor(async()=> (await json(f.marker))?.length===6);
 assert.equal((await waitFor(async()=>{const x=await f.report();return x?.state==='needs_attention'&&x;})).attempts,2);
});
test('wake grace accommodates scheduling gaps without treating stale health as progress',()=>{
 assert.equal(wakeGraceUntil(1000,61000,1000,120000,0),181000);
 assert.equal(wakeGraceUntil(61000,62000,1000,120000,181000),181000);
 assert.equal(wakeGraceUntil(1000,900,1000,120000,0),120900);
});

test('one successful cycle followed by a freeze cannot reset the retry budget',async t=>{
 const f=await fixture(t,'once');
 const d=await waitFor(async()=>{const d=await f.report();return d?.state==='needs_attention'&&d;});
 assert.equal(d.attempts,2);assert.equal((await json(f.marker)).length,3);
 assert.ok(d.history.some(e=>e.kind==='progress_restored'));
 assert.ok(!d.history.some(e=>e.kind==='recovered'));
});

test('sleep/wake grace lets a suspended worker resume without a false restart',async t=>{
 const f=await fixture(t,'healthy');
 const d=await waitFor(async()=>{const d=await f.report();return d?.state==='running'&&d;});
 process.kill(d.workerPid,'SIGSTOP');
 await new Promise(r=>setTimeout(r,700));f.child.kill('SIGUSR2');
 await new Promise(r=>setTimeout(r,900));
 assert.equal((await json(f.marker)).length,1);
 assert.equal((await f.report()).workerPid,d.workerPid);
 process.kill(d.workerPid,'SIGCONT');
 await waitFor(async()=>Date.parse((await json(f.health))?.checkedAt)>Date.parse(d.lastSuccessAt));
 assert.equal((await json(f.marker)).length,1);
});
