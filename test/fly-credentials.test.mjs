import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {credentialStatus, selectCredential, cleanFlyEnv, managedFlyEnv, writeRegistry, readRegistry, privateExec} from '../scripts/lib/fly-credentials.mjs';
const profile = {app:'one-app',brainId:'one-brain',deploy:{account:'brain-fly-one-deploy',expiresAt:'2030-01-01T00:00:00Z'},monitor:{account:'brain-fly-one-monitor',expiresAt:'2030-01-01T00:00:00Z'}};
test('credentials reject wrong Brain, missing app, duplicate app and malformed references',()=>{
 const data={version:1,profiles:[profile]};
 assert.throws(()=>selectCredential(data,{app:'one-app',brainId:'other'}),/mismatch/);
 assert.throws(()=>selectCredential(data,{app:'other'}),/Exactly one/);
 assert.throws(()=>selectCredential({profiles:[profile,profile]},{app:'one-app'}),/Exactly one/);
 assert.throws(()=>selectCredential({profiles:[{...profile,deploy:{account:'../bad'}}]},{app:'one-app'}),/Invalid/);
});
test('expiry warns before loss of automation, separately from service health',()=>{
 assert.equal(credentialStatus(profile,Date.parse('2029-01-01')).status,'pass');
 assert.equal(credentialStatus(profile,Date.parse('2029-12-15')).state,'renewal_due');
 assert.equal(credentialStatus(profile,Date.parse('2030-01-02')).state,'expired');
 assert.equal(credentialStatus({...profile,monitor:{}},Date.now()).state,'invalid_metadata');
});
test('ambient Fly credentials cannot override app-bound credentials',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'fly-credentials-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const env={PATH:process.env.PATH,BRAIN_FLY_CREDENTIALS_FILE:path.join(root,'registry.json'),FLY_API_TOKEN:'wrong',FLY_ACCESS_TOKEN:'also-wrong',FLY_CONFIG_DIR:'/wrong/owner'};
 await writeRegistry({version:1,profiles:[profile]},env);
 let selected;
 const result=await managedFlyEnv({app:'one-app',brainId:'one-brain',purpose:'monitor',env,readSecret:async a=>{selected=a;return 'FlyV1 fm2_synthetic';}});
 assert.equal(selected,profile.monitor.account);assert.equal(result.FLY_API_TOKEN,'FlyV1 fm2_synthetic');assert.equal(result.FLY_ACCESS_TOKEN,undefined);assert.notEqual(result.FLY_CONFIG_DIR,env.FLY_CONFIG_DIR);
 assert.equal((await readRegistry(env)).profiles.length,1);
 await fs.chmod(env.BRAIN_FLY_CREDENTIALS_FILE,0o644);await assert.rejects(readRegistry(env),/owner-only/);
 assert.deepEqual(cleanFlyEnv({FLY_ACCESS_TOKEN:'x',FLY_API_TOKEN:'y',FLY_CONFIG_DIR:'z',PATH:'bin'}),{PATH:'bin'});
});
test('expired credentials are refused before Keychain access',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'fly-expired-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const env={BRAIN_FLY_CREDENTIALS_FILE:path.join(root,'registry.json')};
 await writeRegistry({version:1,profiles:[{...profile,deploy:{...profile.deploy,expiresAt:'2000-01-01'}}]},env);
 let accessed=false;await assert.rejects(managedFlyEnv({app:'one-app',env,readSecret:async()=>{accessed=true;}}),/expired/);assert.equal(accessed,false);
});
test('failed secret subprocess output is never exposed in errors',async()=>{
 await assert.rejects(privateExec(process.execPath,['-e',"process.stdout.write('SENSITIVE_TEST');process.stderr.write('SENSITIVE_TEST');process.exit(1)"]),e=>!JSON.stringify(e).includes('SENSITIVE_TEST')&&!e.message.includes('SENSITIVE_TEST'));
});
test('external automation requires an explicit credential and drops higher-precedence ambiguity',async()=>{
 await assert.rejects(managedFlyEnv({env:{BRAIN_FLY_AUTH_MODE:'external'}}),/explicitly supplied/);
 const env=await managedFlyEnv({env:{BRAIN_FLY_AUTH_MODE:'external',FLY_API_TOKEN:'a',FLY_ACCESS_TOKEN:'b',FLY_CONFIG_DIR:'/cached-login'}});
 assert.equal(env.FLY_API_TOKEN,'b');assert.equal(env.FLY_ACCESS_TOKEN,undefined);assert.equal(env.FLY_CONFIG_DIR,undefined);
});
