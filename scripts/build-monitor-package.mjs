import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {monitorOrigin} from './lib/monitor-client.mjs';
const exec=promisify(execFile),root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const fixture=process.argv.includes('--fixture');
const env=process.env;
const origin=monitorOrigin(env.BRAIN_MONITOR_ORIGIN);
const brainId=env.BRAIN_MONITOR_BRAIN_ID;
const bundleId=env.BRAIN_MONITOR_BUNDLE_ID;
const mode=env.BRAIN_MONITOR_UPDATE_MODE || 'developer';
const build=env.BRAIN_MONITOR_BUILD;
if(!/^[a-z][a-z0-9-]{1,62}$/.test(brainId || '') || !/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+){2,}$/.test(bundleId || '') || !['automatic','mdm','developer'].includes(mode) || !/^[1-9]\d{0,15}$/.test(build || '')) throw Error('Explicit Brain, bundle ID, positive build number and update mode required');
const identity=env.BRAIN_MONITOR_SIGN_IDENTITY;
const notary=env.BRAIN_MONITOR_NOTARY_PROFILE;
if(!fixture && (!identity?.startsWith('Developer ID Application:') || !notary)) throw Error('Distribution requires owner-held Developer ID and notarisation credentials; no ad-hoc release is permitted');
const source=(await exec('git',['rev-parse','HEAD'],{cwd:root})).stdout.trim();
if(!fixture && (await exec('git',['status','--porcelain'],{cwd:root})).stdout.trim())throw Error('Distribution requires a clean committed checkout');
const pkg=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
const output=path.resolve(env.BRAIN_MONITOR_OUTPUT || path.join(root,'monitor-package'));
// Never overwrite an installed app or a previous release directory.
await fs.mkdir(output,{recursive:false});
const app=path.join(output,'Brain Monitor.app'),contents=path.join(app,'Contents'),resources=path.join(contents,'Resources');
const node=env.BRAIN_MONITOR_NODE || process.execPath;
const nodeVersion=(await exec(node,['--version'],{env:{PATH:'/usr/bin:/bin'}})).stdout.trim();
if(!/^v22\./.test(nodeVersion))throw Error('Bundled runtime must be Node 22');
const arch=(await exec(node,['-p','process.arch'],{env:{PATH:'/usr/bin:/bin'}})).stdout.trim();
if(!['arm64','x64'].includes(arch))throw Error('Supported macOS architecture required');
const release={bundle_id:bundleId,origin,brain_id:brainId,app_version:pkg.version,build,source_revision:source,update_mode:mode,arch};
const esc=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
let updater='';
const framework=env.BRAIN_MONITOR_SPARKLE_FRAMEWORK;
if(mode==='automatic') {
  if(!framework)throw Error('Pinned Sparkle 2.10 framework required');
  const metadata=(await exec('/usr/libexec/PlistBuddy',['-c','Print :CFBundleShortVersionString',path.join(framework,'Resources','Info.plist')])).stdout.trim();
  if(metadata!=='2.10.0')throw Error('Expected reviewed Sparkle 2.10.0');
  const feed=env.BRAIN_MONITOR_FEED_URL,key=env.BRAIN_MONITOR_PUBLIC_ED_KEY;
  const feedUrl=new URL(feed);
  if(feedUrl.origin!==origin || feedUrl.username || feedUrl.password || feedUrl.hash || feedUrl.search || !key || !/^[A-Za-z0-9+/]{43}=$/.test(key) || Buffer.from(key,'base64').length!==32)throw Error('Owner-scoped HTTPS feed and Ed25519 public key required');
  updater=`<key>SUFeedURL</key><string>${esc(feed)}</string><key>SUPublicEDKey</key><string>${esc(key)}</string>
  <key>SUEnableAutomaticChecks</key><true/><key>SUAutomaticallyUpdate</key><true/>
  <key>SUAllowsAutomaticUpdates</key><true/><key>SUScheduledCheckInterval</key><integer>86400</integer>
  <key>SUVerifyUpdateBeforeExtraction</key><true/><key>SURequireSignedFeed</key><true/>
  <key>SUSignedFeedFailureExpirationInterval</key><integer>0</integer>
  <key>SUEnableSystemProfiling</key><false/><key>SUEnableJavaScript</key><false/>`;
}
await fs.mkdir(path.join(contents,'MacOS'),{recursive:true});
await fs.mkdir(path.join(resources,'scripts','lib'),{recursive:true});
await fs.mkdir(path.join(resources,'runtime'),{recursive:true});
await fs.copyFile(node,path.join(resources,'runtime','node'));
await fs.chmod(path.join(resources,'runtime','node'),0o755);
// Homebrew Node links to external libraries and cannot be used in a portable app.
const links=(await exec('/usr/bin/otool',['-L',path.join(resources,'runtime','node')])).stdout;
if(!fixture && /\/(opt\/homebrew|usr\/local|Users)\//.test(links))throw Error('Use the official self-contained Node 22 binary, not a Homebrew runtime');
for(const name of ['monitor-client.mjs','lib/monitor-client.mjs'])await fs.copyFile(path.join(root,'scripts',name),path.join(resources,'scripts',name));
await fs.writeFile(path.join(resources,'monitor-release.json'),JSON.stringify(release,null,2)+'\n');
await fs.writeFile(path.join(contents,'Info.plist'),`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>Brain Monitor</string><key>CFBundleName</key><string>Brain Monitor</string>
<key>CFBundleIdentifier</key><string>${esc(bundleId)}</string><key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>${esc(pkg.version)}</string><key>CFBundleVersion</key><string>${esc(build)}</string>
<key>LSMinimumSystemVersion</key><string>12.0</string><key>LSUIElement</key><true/>${updater}</dict></plist>`);
const compile=['-fobjc-arc','-O2','-Wall','-Wextra','-arch',arch==='x64'?'x86_64':'arm64','-mmacosx-version-min=12.0','-framework','Cocoa','-framework','Security','-framework','LocalAuthentication'];
if(mode==='automatic') {
  await fs.mkdir(path.join(contents,'Frameworks'),{recursive:true});
  await exec('/usr/bin/ditto',[framework,path.join(contents,'Frameworks','Sparkle.framework')]);
  compile.push('-DMONITOR_SPARKLE=1','-F'+path.dirname(framework),'-framework','Sparkle','-Wl,-rpath,@loader_path/../Frameworks');
}
await exec('/usr/bin/cc',[...compile,'-o',path.join(contents,'MacOS','Brain Monitor'),path.join(root,'scripts','monitor-app.m')]);
if(fixture) {
  await exec('/usr/bin/codesign',['--force','--deep','--sign','-',app]);
  console.log(JSON.stringify({fixture:true,distributable:false,app,release}));
} else {
  const entitlements=path.join(output,'node-entitlements.plist');
  await fs.writeFile(entitlements,'<?xml version="1.0"?><plist version="1.0"><dict><key>com.apple.security.cs.allow-jit</key><true/></dict></plist>');
  const sign=async (target,extra=[])=>exec('/usr/bin/codesign',['--force','--options','runtime','--timestamp','--sign',identity,...extra,target]);
  await sign(path.join(resources,'runtime','node'),['--entitlements',entitlements]);
  if(mode==='automatic') {
    const bundled=path.join(contents,'Frameworks','Sparkle.framework');
    for(const child of ['Versions/B/XPCServices/Downloader.xpc','Versions/B/XPCServices/Installer.xpc','Versions/B/Updater.app','Versions/B/Autoupdate']) {
      await sign(path.join(bundled,child));
    }
    await sign(bundled);
  }
  await sign(app);
  await exec('/usr/bin/codesign',['--verify','--deep','--strict',app]);
  const archive=path.join(output,'Brain-Monitor-'+build+'-'+arch+'.zip');
  await exec('/usr/bin/ditto',['-c','-k','--sequesterRsrc','--keepParent',app,archive]);
  await exec('/usr/bin/xcrun',['notarytool','submit',archive,'--keychain-profile',notary,'--wait'],{maxBuffer:1024*1024});
  await exec('/usr/bin/xcrun',['stapler','staple',app]);
  await exec('/usr/sbin/spctl',['--assess','--type','execute',app]);
  await fs.rm(archive);
  await exec('/usr/bin/ditto',['-c','-k','--sequesterRsrc','--keepParent',app,archive]);
  const archiveSha256=createHash('sha256').update(await fs.readFile(archive)).digest('hex');
  const receipt={fixture:false,distributable:true,app,archive,archive_sha256:archiveSha256,release,published:false};
  await fs.writeFile(path.join(output,'release-receipt.json'),JSON.stringify(receipt,null,2)+'\n');
  console.log(JSON.stringify(receipt));
}
