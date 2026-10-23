import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {verifyMonitorReleaseAssets} from './lib/monitor-release-assets.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const prepared=path.resolve(process.env.BRAIN_MONITOR_PREPARED_RELEASE);
const manifest=JSON.parse(await fs.readFile(path.join(prepared,'manifest.json'),'utf8'));
if(manifest.brain_id!==process.env.BRAIN_ID || manifest.origin!==new URL(process.env.BRAIN_HOSTED_BASE_URL).origin || !Array.isArray(manifest.files) || manifest.files.length>50)throw Error('Release owner binding mismatch');
const target=path.join(root,'config','monitor-release-assets');await fs.mkdir(target,{recursive:true});
for(const file of manifest.files) {
  if(!/^(appcast\.xml|Brain-Monitor-[1-9][0-9]{0,15}-(arm64|x64)\.zip)$/.test(file.filename))throw Error('Unexpected release asset');
  const source=await fs.realpath(path.join(prepared,file.filename));if(path.dirname(source)!==await fs.realpath(prepared))throw Error('Release asset path escaped');
  const bytes=await fs.readFile(source);if(bytes.length!==file.bytes || createHash('sha256').update(bytes).digest('hex')!==file.sha256)throw Error('Release asset digest mismatch');
  const destination=path.join(target,file.filename);
  if(file.filename!=='appcast.xml') {
    try {const prior=await fs.readFile(destination);if(!prior.equals(bytes))throw Error('Immutable archive cannot be overwritten');continue;}catch(error){if(error.code!=='ENOENT')throw error;}
  }
  await fs.writeFile(destination,bytes);
}
await fs.writeFile(path.join(root,'config','monitor-release-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
await verifyMonitorReleaseAssets(root,{...process.env,BRAIN_MONITOR_RELEASE_DIR:'/app/config/monitor-release-assets'});
console.log(JSON.stringify({staged:true,published:false,brain_id:manifest.brain_id,files:manifest.files.length}));
