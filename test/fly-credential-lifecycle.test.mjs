import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';

// Execute the real CLI and filesystem transaction. Only external Keychain/Fly
// subprocess boundaries are substituted; no real credentials or network used.
for (const fail of [true,false]) test(`credential replacement ${fail?'failure preserves active credentials':'success retains previous credentials until deployment proof'}`,async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'credential-lifecycle-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const file=path.join(root,'registry.json');
 const old={brainId:'fixture',app:'fixture-app',owner:'fixture@example.invalid',deploy:{account:'brain-fly-old-deploy',expiresAt:'2030-01-01'},monitor:{account:'brain-fly-old-monitor',expiresAt:'2030-01-01'}};
 const initial={version:1,profiles:[old]};await fs.writeFile(file,JSON.stringify(initial),{mode:0o600});
 const preload=path.join(root,'preload.mjs');const receipts=path.join(root,'calls.json');
 await fs.writeFile(preload,`import child from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';import {EventEmitter} from 'node:events';import fs from 'node:fs';
 const secrets=new Map();let calls=[];
 child.execFile=(cmd,args,opts,cb)=>{const stdin=new EventEmitter();stdin.end=input=>{let out='',error=null;
 if(cmd.endsWith('brain-fly-keychain')){if(args[0]==='add')secrets.set(args[1],input);if(args[0]==='get')out=secrets.get(args[1])||(args[1].includes('monitor')?'fm2_SYNTHETIC_MONITOR':'fm2_SYNTHETIC_DEPLOY');if(args[0]==='delete')secrets.delete(args[1]);}
 else if(cmd==='flyctl'){
   calls.push(args.slice(0,3).join(' '));fs.writeFileSync(${JSON.stringify(receipts)},JSON.stringify(calls));
   if(args[0]==='auth')out='fixture@example.invalid';
   if(args[0]==='tokens'&&args[1]==='create')out=JSON.stringify({token:args[2]==='deploy'?'fm2_SYNTHETIC_DEPLOY':'fm2_SYNTHETIC_MONITOR'});
   if(args[0]==='status'){out=JSON.stringify({Name:'fixture-app'});if(${fail}&&opts.env.FLY_API_TOKEN==='fm2_SYNTHETIC_MONITOR'){error=Object.assign(new Error('fm2_SYNTHETIC_MONITOR'),{code:1,stdout:'fm2_SYNTHETIC_MONITOR'});}}
 }else throw Error('Unexpected external command');
 queueMicrotask(()=>cb(error,out,''));};return {stdin};};syncBuiltinESMExports();`);
 const child=spawn(process.execPath,['--import',preload,new URL('../scripts/fly-credentials.mjs',import.meta.url).pathname,'provision','--brain-id','fixture','--app','fixture-app','--owner','fixture@example.invalid','--fly-config-dir',root],{env:{...process.env,BRAIN_FLY_CREDENTIALS_FILE:file},stdio:['ignore','pipe','pipe']});
 let output='';for(const s of [child.stdout,child.stderr])s.on('data',x=>output+=x);
 const code=await new Promise(r=>child.on('close',r));assert.equal(code,fail?1:0);assert.ok(!output.includes('fm2_SYNTHETIC'));
 const actual=JSON.parse(await fs.readFile(file));const calls=JSON.parse(await fs.readFile(receipts));
 if(fail){assert.deepEqual(actual,initial);assert.ok(calls.includes('tokens revoke supplied'));}
 else {assert.deepEqual(actual.profiles[0].previous,old);assert.notEqual(actual.profiles[0].deploy.account,old.deploy.account);assert.ok(!calls.includes('tokens revoke supplied'));}
 await assert.rejects(fs.access(file+'.lock'));
 if(!fail) {
   const retire=()=>new Promise(resolve=>{const c=spawn(process.execPath,['--import',preload,new URL('../scripts/fly-credentials.mjs',import.meta.url).pathname,'retire-previous','--brain-id','fixture','--app','fixture-app'],{cwd:root,env:{...process.env,BRAIN_FLY_CREDENTIALS_FILE:file},stdio:'ignore'});c.on('close',resolve);});
   assert.equal(await retire(),1);assert.deepEqual(JSON.parse(await fs.readFile(file)).profiles[0].previous,old);
   await fs.mkdir(path.join(root,'.brain-deploy'));await fs.writeFile(path.join(root,'.brain-deploy/provenance.jsonl'),JSON.stringify({app:'fixture-app',credential_account:actual.profiles[0].deploy.account})+'\n');
   assert.equal(await retire(),0);assert.equal(JSON.parse(await fs.readFile(file)).profiles[0].previous,undefined);
   assert.ok(JSON.parse(await fs.readFile(receipts)).includes('tokens revoke supplied'));
 }
 const records=await fs.readdir(path.join(root,'fly-credential-transactions'));assert.equal(records.length,1);
 const record=JSON.parse(await fs.readFile(path.join(root,'fly-credential-transactions',records[0])));assert.equal(record.status,fail?'candidate_revoked':'activated');
});
