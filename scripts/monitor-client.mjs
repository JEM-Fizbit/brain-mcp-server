import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {installationId,login,reportInstallation} from './lib/monitor-client.mjs';

// Fixed release metadata, never a user-supplied profile or repository .env.
const resources=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const release=JSON.parse(await fs.readFile(path.join(resources,'monitor-release.json'),'utf8'));
const directory=path.join(os.homedir(),'Library','Application Support','Brain MCP',release.bundle_id);
// Private IPC with the signed native host; no public credential-export command.
let credentials=null;
try {
  const chunks=[];let size=0;
  for await(const chunk of process.stdin){size+=chunk.length;if(size>65536)throw Error('monitor_ipc_too_large');chunks.push(chunk);}
  const raw=Buffer.concat(chunks).toString('utf8');
  credentials=JSON.parse(raw).credentials || null;
} catch { /* A missing credential requires an explicit sign-in. */ }
const store={read:async()=>credentials,write:async value=>{credentials=value;}};
try {
  if(process.argv[2]==='login')await login(release.origin,store);
  const report={installation_id:await installationId(directory),app_version:release.app_version,build:release.build,
    source_revision:release.source_revision,platform:process.platform,arch:process.arch,
    update_mode:release.update_mode,update_state:['current','checking','available','downloaded','deferred','failed','unknown'].includes(process.argv[3])?process.argv[3]:'unknown'};
  const receipt=await reportInstallation(release.origin,store,report);
  console.log(JSON.stringify({ok:true,...receipt,credentials}));
} catch(error) {
  // Never print an exception object, HTTP body, tokens or native process arguments.
  const code=/^monitor_[a-z_0-9]+$/.test(error.message)?error.message:'monitor_report_failed';
  console.log(JSON.stringify({ok:false,code,credentials}));process.exitCode=1;
}
