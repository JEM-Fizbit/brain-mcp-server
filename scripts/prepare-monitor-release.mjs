import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {monitorOrigin} from './lib/monitor-client.mjs';
const exec=promisify(execFile),env=process.env;
const receipt=JSON.parse(await fs.readFile(env.BRAIN_MONITOR_PACKAGE_RECEIPT,'utf8'));
if(receipt.fixture || !receipt.distributable || receipt.release?.update_mode!=='automatic')throw Error('Only a verified distribution package can enter the update feed');
const origin=monitorOrigin(env.BRAIN_MONITOR_ORIGIN);
if(receipt.release.origin!==origin || receipt.release.brain_id!==env.BRAIN_MONITOR_BRAIN_ID)throw Error('Release owner binding mismatch');
const account=env.BRAIN_MONITOR_SIGNING_ACCOUNT;
if(!account || !/^[A-Za-z0-9_-]{1,80}$/.test(account))throw Error('Explicit owner-held Sparkle Keychain account required');
const feedName=env.BRAIN_MONITOR_FEED_NAME || 'appcast.xml';
if(!['appcast.xml','canary.xml'].includes(feedName))throw Error('Unexpected release feed name');
const output=path.resolve(env.BRAIN_MONITOR_RELEASE_OUTPUT);
await fs.mkdir(output,{recursive:false});
// A previous release directory is copied, never edited or pruned in place.
if(env.BRAIN_MONITOR_PREVIOUS_RELEASES)await fs.cp(path.resolve(env.BRAIN_MONITOR_PREVIOUS_RELEASES),output,{recursive:true,errorOnExist:false,force:false});
const name=path.basename(receipt.archive);
if(!/^Brain-Monitor-[1-9][0-9]{0,15}-(arm64|x64)\.zip$/.test(name))throw Error('Unexpected release archive name');
const target=path.join(output,name);
try {await fs.access(target);throw Error('Immutable release archive already exists');} catch(error){if(error.code!=='ENOENT')throw error;}
await exec('/usr/bin/codesign',['--verify','--deep','--strict',receipt.app]);
await exec('/usr/sbin/spctl',['--assess','--type','execute',receipt.app]);
const archiveBytes=await fs.readFile(receipt.archive);
if(createHash('sha256').update(archiveBytes).digest('hex')!==receipt.archive_sha256)throw Error('Release archive differs from verified notarisation receipt');
await fs.writeFile(target,archiveBytes,{flag:'wx'});
const tools=env.BRAIN_MONITOR_SPARKLE_BIN;
await exec(path.join(tools,'generate_appcast'),['--account',account,'-o',path.join(output,feedName),'--download-url-prefix',origin+'/monitor/updates/','--maximum-deltas','0','--maximum-versions','0',output],{maxBuffer:1024*1024});
await exec(path.join(tools,'sign_update'),['--account',account,'--verify',path.join(output,feedName)]);
const manifest={brain_id:receipt.release.brain_id,origin,prepared_at:new Date().toISOString(),release:receipt.release,files:[]};
for(const file of await fs.readdir(output)) {
  if(['appcast.xml','canary.xml'].includes(file) || /^Brain-Monitor-[1-9][0-9]{0,15}-(arm64|x64)\.zip$/.test(file)) {
    const bytes=await fs.readFile(path.join(output,file));manifest.files.push({filename:file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
  }
}
await fs.writeFile(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({prepared:true,published:false,output,brain_id:manifest.brain_id,files:manifest.files}));
