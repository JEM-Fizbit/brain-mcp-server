import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
export async function verifyMonitorReleaseAssets(root,env) {
  const assetRoot=path.join(root,'config','monitor-release-assets');
  let present=false;try {present=(await fs.readdir(assetRoot)).length>0;}catch(error){if(error.code!=='ENOENT')throw error;}
  if(!env.BRAIN_MONITOR_RELEASE_DIR && !present)return;
  if(env.BRAIN_MONITOR_RELEASE_DIR && env.BRAIN_MONITOR_RELEASE_DIR!=='/app/config/monitor-release-assets')throw Error('Monitor assets must use the reviewed image directory');
  const manifest=JSON.parse(await fs.readFile(path.join(root,'config','monitor-release-manifest.json'),'utf8'));
  const origin=new URL(env.BRAIN_HOSTED_BASE_URL || env.MCP_OAUTH_PUBLIC_BASE).origin;
  if(manifest.brain_id!==env.BRAIN_ID || manifest.origin!==origin || !Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length>50)throw Error('Monitor asset owner binding mismatch');
  const directory=await fs.realpath(path.join(root,'config','monitor-release-assets'));
  const seen=new Set();let hasFeed=false;
  for(const file of manifest.files) {
    if(!/^(appcast\.xml|Brain-Monitor-[1-9][0-9]{0,15}-(arm64|x64)\.zip)$/.test(file.filename) || seen.has(file.filename) || !/^[a-f0-9]{64}$/.test(file.sha256))throw Error('Invalid Monitor asset manifest');
    seen.add(file.filename);if(file.filename==='appcast.xml')hasFeed=true;
    const filename=await fs.realpath(path.join(directory,file.filename));
    if(path.dirname(filename)!==directory)throw Error('Monitor asset escaped release directory');
    const stat=await fs.stat(filename);if(!stat.isFile() || stat.size!==file.bytes || stat.size>200*1024*1024)throw Error('Monitor asset size mismatch');
    if(createHash('sha256').update(await fs.readFile(filename)).digest('hex')!==file.sha256)throw Error('Monitor asset digest mismatch');
  }
  if(!hasFeed)throw Error('Signed Monitor feed missing');
  const actual=await fs.readdir(directory);
  if(actual.some(name=>!seen.has(name)))throw Error('Unmanifested Monitor assets refused');
}
export function monitorDeployEnv(toml,ambient={}) {
  const block=toml.match(/^\[env\]\s*$([\s\S]*?)(?=^\[|$(?![\s\S]))/m)?.[1] || '';
  const result={};
  for(const key of ['BRAIN_MONITOR_RELEASE_DIR','BRAIN_ID','BRAIN_HOSTED_BASE_URL','MCP_OAUTH_PUBLIC_BASE']) {
    const value=block.match(new RegExp('^\\s*'+key+'\\s*=\\s*"([^"\\n]+)"\\s*(?:#.*)?$','m'))?.[1];
    if(value)result[key]=value;
    else if(key!=='BRAIN_MONITOR_RELEASE_DIR' && ambient[key])result[key]=ambient[key];
  }
  return result;
}
