import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {parseArgs} from 'node:util';
import {helperPath, registryPath, readRegistry, writeRegistry, credentialStatus, cleanFlyEnv, privateExec, managedFlyEnv} from './lib/fly-credentials.mjs';

async function main() {
  const {values:v, positionals} = parseArgs({allowPositionals:true, options:{
    'brain-id':{type:'string'}, app:{type:'string'}, owner:{type:'string'},
    'fly-config-dir':{type:'string'}, 'expiry-days':{type:'string',default:'180'}
  }});
  const command = positionals[0] || 'status';
  const data = await readRegistry();
  if (command === 'status') {
    console.log(JSON.stringify(data.profiles.map(p=>credentialStatus(p)),null,2));return;
  }
  const app=v.app, brainId=v['brain-id'];
  if (!/^[a-z0-9-]+$/.test(app || '') || !/^[a-z0-9-]+$/.test(brainId || '')) throw new Error('Explicit --app and --brain-id are required');
  if (command === 'verify') {
    for (const purpose of ['deploy','monitor']) {
      const env=await managedFlyEnv({app,brainId,purpose});
      await privateExec('flyctl',['status','--app',app,'--json'],{env});
    }
    console.log(`${brainId}: both Keychain credentials authenticate to ${app}.`);return;
  }
  if (command === 'retire-previous') {
    const p=data.profiles.find(p=>p.app===app&&p.brainId===brainId);
    if(!p?.previous) {console.log('No previous managed credential to retire.');return;}
    const proof=await fs.readFile(path.resolve('.brain-deploy/provenance.jsonl'),'utf8');
    if(!proof.trim().split('\n').map(l=>JSON.parse(l)).some(r=>r.app===app&&r.credential_account===p.deploy.account)) throw new Error('A successful guarded deployment with the replacement credential is required first');
    const lock=registryPath(process.env)+'.lock';const h=await fs.open(lock,'wx',0o600);
    try {
      if(JSON.stringify(await readRegistry())!==JSON.stringify(data))throw new Error('Credential metadata changed');
      for(const purpose of ['deploy','monitor']) await privateExec('flyctl',['status','--app',app,'--json'],{env:await managedFlyEnv({app,brainId,purpose})});
      const old=await privateExec(helperPath,['get',p.previous.deploy.account]);
      await privateExec('flyctl',['tokens','revoke','supplied'],{env:{...cleanFlyEnv(),FLY_API_TOKEN:old}});
      for(const purpose of ['deploy','monitor'])await privateExec(helperPath,['delete',p.previous[purpose].account]).catch(()=>{});
      delete p.previous;await writeRegistry(data);
      console.log('Previous managed credential revoked after replacement deployment proof.');
    } finally {await h.close();await fs.unlink(lock);}
    return;
  }
  if (command !== 'provision') throw new Error('Use status, verify, provision or retire-previous');
  const owner=v.owner, configDir=v['fly-config-dir'], days=Number(v['expiry-days']);
  if (!owner || !path.isAbsolute(configDir || '') || !Number.isInteger(days) || days<1 || days>365) throw new Error('Provision requires --owner, absolute --fly-config-dir, and expiry of 1–365 days');
  const existing=data.profiles.find(p=>p.app===app);
  if(existing?.previous)throw new Error('Retire the previous credential after verified deployment before another renewal');
  if (data.profiles.some(p=>p.brainId===brainId&&p.app!==app) || existing && (existing.brainId!==brainId||existing.owner!==owner)) throw new Error('Existing owner/app binding differs; refusing replacement');
  const loginEnv={...cleanFlyEnv(),FLY_CONFIG_DIR:configDir,FLY_NO_UPDATE_CHECK:'1'};
  const who=await privateExec('flyctl',['auth','whoami'],{env:loginEnv});
  if (who.trim().toLowerCase()!==owner.toLowerCase()) throw new Error('Fly login does not match the requested owner');
  // A lock serializes provisioning across both profiles; it is never silently
  // stolen after a crash. Existing active credentials remain untouched.
  const lock=registryPath(process.env)+'.lock';
  await fs.mkdir(path.dirname(lock),{recursive:true,mode:0o700});
  const handle=await fs.open(lock,'wx',0o600);
  let token, switched=false, transactionFile, transaction;const added=[];
  const record=async status=>{if(transactionFile){transaction.status=status;await fs.writeFile(transactionFile,JSON.stringify(transaction,null,2)+'\n',{mode:0o600});}};
  try {
    const fresh=await readRegistry();
    if(JSON.stringify(fresh)!==JSON.stringify(data)) throw new Error('Credential metadata changed; retry after reviewing current status');
    const createdAt=new Date(), expiresAt=new Date(createdAt.getTime()+days*86400000).toISOString();
    const id=crypto.randomUUID();
    const name=`brain-managed-${brainId}-${id}`;
    const transactions=path.join(path.dirname(registryPath(process.env)),'fly-credential-transactions');
    await fs.mkdir(transactions,{recursive:true,mode:0o700});
    transactionFile=path.join(transactions,id+'.json');
    transaction={brainId,app,tokenName:name,createdAt:createdAt.toISOString()};
    await record('creating');
    token=JSON.parse(await privateExec('flyctl',['tokens','create','deploy','--app',app,'--name',name,'--expiry',`${days*24}h`,'--json'],{env:loginEnv})).token;
    if (!/^(?:FlyV1 )?fm[12]_\S+$/.test(token || '')) throw new Error('Unexpected Fly token format');
    const automationDir=path.join(path.dirname(registryPath(process.env)),'fly-automation',app);
    await fs.mkdir(automationDir,{recursive:true,mode:0o700});
    const tokenEnv={...cleanFlyEnv(),FLY_CONFIG_DIR:automationDir,FLY_API_TOKEN:token,FLY_NO_UPDATE_CHECK:'1'};
    const monitor=JSON.parse(await privateExec('flyctl',['tokens','create','readonly','--from-existing','--expiry',`${days*24}h`,'--json'],{env:tokenEnv})).token;
    if (!/^(?:FlyV1 )?fm[12]_\S+$/.test(monitor || '')) throw new Error('Unexpected read-only token format');
    const profile={brainId,app,owner,createdAt:createdAt.toISOString(),tokenName:name};
    for(const [purpose,secret] of [['deploy',token],['monitor',monitor]]) {
      const account=`brain-fly-${brainId}-${purpose}-${id}`;
      await privateExec(helperPath,['add',account],{input:secret});added.push(account);
      if(await privateExec(helperPath,['get',account])!==secret)throw new Error('Keychain verification failed');
      const status=JSON.parse(await privateExec('flyctl',['status','--app',app,'--json'],{env:{...tokenEnv,FLY_API_TOKEN:secret}}));
      if((status.Name ?? status.name)!==app)throw new Error('Fly app identity verification failed');
      profile[purpose]={account,expiresAt};
    }
    // Preserve previous references until explicit retirement after deployment
    // proof. Never revoke a credential merely because provisioning succeeded.
    if(existing)profile.previous=existing;
    await writeRegistry({version:1,profiles:[...data.profiles.filter(p=>p.app!==app),profile]});
    switched=true;
    await record('activated');
    console.log(JSON.stringify({brainId,app,owner,expiresAt,status:'installed_and_verified',previousRetained:Boolean(existing)},null,2));
  } catch(e) {
    if(token&&!switched) {
      const revoked=await privateExec('flyctl',['tokens','revoke','supplied'],{env:{...loginEnv,FLY_API_TOKEN:token}}).then(()=>true,()=>false);
      await record(revoked?'candidate_revoked':'cleanup_required');
      if(!revoked) console.error('Candidate token cleanup needs owner review in Fly; the transaction metadata records its name. Active credential metadata was not changed.');
      if(revoked)for(const a of added)await privateExec(helperPath,['delete',a]).catch(()=>{});
    }
    throw e;
  } finally {await handle.close();await fs.unlink(lock);}
}
main().catch(()=>{console.error('Fly credential operation failed. Check explicit owner/app binding, owner login, Keychain access and metadata permissions; no secret output is retained.');process.exitCode=1;});
