import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {helperPath, privateExec} from './lib/fly-credentials.mjs';
if (process.platform !== 'darwin') throw new Error('macOS Keychain is required');
await fs.mkdir(path.dirname(helperPath), {recursive:true, mode:0o700});
const source = fileURLToPath(new URL('./native/fly-keychain.m', import.meta.url));
const hash=crypto.createHash('sha256').update(await fs.readFile(source)).digest('hex');
let installed=false;try{await fs.access(helperPath);installed=true;}catch{}
if(installed){
  const previous=await fs.readFile(helperPath+'.source-sha256','utf8').catch(()=>null);
  if(previous?.trim()===hash){console.log('Keychain helper is current; existing access preserved.');process.exit(0);}
  throw new Error('Existing Keychain helper differs or lacks a source record. Preserve it and review Keychain access migration before replacement.');
}
await privateExec('/usr/bin/clang', ['-Wno-deprecated-declarations','-framework','Foundation','-framework','Security',source,'-o',helperPath+'.tmp']);
await privateExec('/usr/bin/codesign', ['--force','--sign','-','--identifier','com.jem.brain.fly-keychain',helperPath+'.tmp']);
await fs.chmod(helperPath+'.tmp', 0o700);
await fs.rename(helperPath+'.tmp', helperPath);
await fs.writeFile(helperPath+'.source-sha256',hash+'\n',{mode:0o600});
console.log('Installed the Brain Fly Keychain helper. No credentials changed.');
