import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
import {assertPortableNodeLinks} from '../scripts/lib/monitor-package.mjs';
test('portable-runtime validation checks dependency lines, not the build-user path header',()=>{
  assert.doesNotThrow(()=>assertPortableNodeLinks('/Users/example/Monitor.app/Contents/Resources/runtime/node:\n\t/usr/lib/libSystem.B.dylib (compatibility version 1.0.0)\n'));
  for(const dependency of ['/opt/homebrew/opt/icu/libicu.dylib','/usr/local/lib/node.dylib','@rpath/libnode.dylib','/Users/example/libnode.dylib'])assert.throws(()=>assertPortableNodeLinks('node:\n\t'+dependency+' (compatibility version 1.0.0)\n'),/self-contained/);
});
test('Monitor distribution refuses unsigned production and malformed release inputs before installation',async t=>{
  if(process.platform!=='darwin')return t.skip('native macOS packaging');
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'monitor-package-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const env={PATH:process.env.PATH,HOME:os.homedir(),BRAIN_MONITOR_ORIGIN:'https://brain.example',BRAIN_MONITOR_BRAIN_ID:'test-brain',BRAIN_MONITOR_BUNDLE_ID:'com.example.monitor',BRAIN_MONITOR_BUILD:'1',BRAIN_MONITOR_OUTPUT:path.join(root,'unsigned')};
  await assert.rejects(exec(process.execPath,['scripts/build-monitor-package.mjs'],{env}),/Developer ID/);
  await assert.rejects(fs.access(env.BRAIN_MONITOR_OUTPUT));
  await assert.rejects(exec(process.execPath,['scripts/build-monitor-package.mjs','--fixture'],{env:{...env,BRAIN_MONITOR_ORIGIN:'http://insecure.example'}}),/invalid_monitor_origin/);
  await assert.rejects(exec(process.execPath,['scripts/build-monitor-package.mjs','--fixture'],{env:{...env,BRAIN_MONITOR_UPDATE_MODE:'automatic'}}),/Sparkle/);
});
test('portable developer fixture has real build metadata, no profile or updater, and does not overwrite an existing bundle',async t=>{
  if(process.platform!=='darwin')return t.skip('native macOS packaging');
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'monitor-package-native-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const output=path.join(root,'build');
  const env={PATH:process.env.PATH,HOME:os.homedir(),BRAIN_MONITOR_ORIGIN:'https://brain.example',BRAIN_MONITOR_BRAIN_ID:'test-brain',BRAIN_MONITOR_BUNDLE_ID:'com.example.monitor',BRAIN_MONITOR_BUILD:'19',BRAIN_MONITOR_UPDATE_MODE:'developer',BRAIN_MONITOR_OUTPUT:output};
  const built=JSON.parse((await exec(process.execPath,['scripts/build-monitor-package.mjs','--fixture'],{env})).stdout);
  assert.equal(built.distributable,false);assert.equal(built.release.build,'19');
  const resources=path.join(built.app,'Contents','Resources');
  assert.deepEqual((await fs.readdir(resources)).sort(),['monitor-release.json','runtime','scripts']);
  const info=await fs.readFile(path.join(built.app,'Contents','Info.plist'),'utf8');assert.doesNotMatch(info,/SUFeedURL|SUPublicEDKey/);
  const metadata=await fs.readFile(path.join(resources,'monitor-release.json'),'utf8');assert.doesNotMatch(metadata,/DATABASE|password|\/Users\//);
  await exec('/usr/bin/codesign',['--verify','--deep','--strict',built.app]);
  await assert.rejects(exec(process.execPath,['scripts/build-monitor-package.mjs','--fixture'],{env}),/EEXIST/);
});
