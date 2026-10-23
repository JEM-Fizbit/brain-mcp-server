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
// Generate from the new archive only: Sparkle refuses mixing archives whose
// embedded feed URLs differ (canary -> normal). Retain reviewed old archives
// afterwards as recovery assets, without changing their bytes or old directory.
if(env.BRAIN_MONITOR_PREVIOUS_RELEASES) {
  const previous=await fs.realpath(path.resolve(env.BRAIN_MONITOR_PREVIOUS_RELEASES));
  const prior=JSON.parse(await fs.readFile(path.join(previous,'manifest.json'),'utf8'));
  if(prior.brain_id!==receipt.release.brain_id || prior.origin!==origin || !Array.isArray(prior.files) || prior.files.length>50)throw Error('Previous release owner binding mismatch');
  for(const file of prior.files) {
    if(!/^Brain-Monitor-[1-9][0-9]{0,15}-(arm64|x64)\.zip$/.test(file.filename))continue;
    const source=await fs.realpath(path.join(previous,file.filename));if(path.dirname(source)!==previous)throw Error('Previous archive escaped release directory');
    const bytes=await fs.readFile(source);
    if(bytes.length!==file.bytes || createHash('sha256').update(bytes).digest('hex')!==file.sha256)throw Error('Previous archive digest mismatch');
    if(file.filename===name) {if(file.sha256!==receipt.archive_sha256)throw Error('Immutable archive differs');continue;}
    await fs.writeFile(path.join(output,file.filename),bytes,{flag:'wx'});
  }
}
if(env.BRAIN_MONITOR_PROMOTE_CANARY==='1') {
  if(feedName!=='appcast.xml')throw Error('Canary promotion requires the normal release feed');
  // Feed signatures cover XML bytes, not the URL. Retained canary clients can
  // install the standard-channel app without changing their Keychain identity.
  await fs.copyFile(path.join(output,feedName),path.join(output,'canary.xml'));
  await exec(path.join(tools,'sign_update'),['--account',account,'--verify',path.join(output,'canary.xml')]);
}
const manifest={brain_id:receipt.release.brain_id,origin,prepared_at:new Date().toISOString(),release:receipt.release,files:[]};
for(const file of await fs.readdir(output)) {
  if(['appcast.xml','canary.xml'].includes(file) || /^Brain-Monitor-[1-9][0-9]{0,15}-(arm64|x64)\.zip$/.test(file)) {
    const bytes=await fs.readFile(path.join(output,file));manifest.files.push({filename:file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
  }
}
await fs.writeFile(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({prepared:true,published:false,output,brain_id:manifest.brain_id,files:manifest.files}));
