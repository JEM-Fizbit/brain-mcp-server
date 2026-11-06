import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';

const exec = promisify(execFile);

export function assertPortableNodeLinks(otoolOutput) {
  // The first line names the inspected file and can contain the build user's
  // path. Only subsequent lines describe dynamically loaded dependencies.
  const dependencies=otoolOutput.split('\n').slice(1).map(line=>line.trim().split(' (')[0]).filter(Boolean);
  if(!dependencies.length || dependencies.some(dep=>!dep.startsWith('/usr/lib/') && !dep.startsWith('/System/Library/'))) {
    throw Error('Use the official self-contained Node 22 binary, not a Homebrew or externally linked runtime');
  }
}

// The local operator app needs the same isolation as the distributed Monitor:
// copying a Homebrew executable alone retains its mutable external dylib links.
export async function installPortableNodeRuntime({nodePath, sourcePath, licensePath}) {
  if (!path.isAbsolute(nodePath) || (sourcePath && !path.isAbsolute(sourcePath)) ||
      (licensePath && !path.isAbsolute(licensePath))) {
    throw Error('Brain Monitor runtime and source paths must be absolute');
  }
  if (!sourcePath) {
    sourcePath = await fs.access(nodePath).then(() => nodePath, () => process.execPath);
  }
  const noticesPath = path.resolve(nodePath, '..', '..', 'ThirdPartyNotices', 'Node.txt');
  const licenseCandidates = licensePath ? [licensePath] : [
    path.resolve(sourcePath, '..', '..', 'LICENSE'),
    path.resolve(sourcePath, '..', '..', 'ThirdPartyNotices', 'Node.txt'),
  ];
  const runtimeDir = path.dirname(nodePath);
  await fs.mkdir(runtimeDir, {recursive: true});
  const stage = await fs.mkdtemp(path.join(runtimeDir, '.install-'));
  try {
    const candidate = path.join(stage, 'node');
    await fs.copyFile(sourcePath, candidate);
    await fs.chmod(candidate, 0o755);
    const options = {env: {PATH: '/usr/bin:/bin'}, timeout: 10_000};
    assertPortableNodeLinks((await exec('/usr/bin/otool', ['-L', candidate], options)).stdout);
    // This is the local developer app's private copy, signed like its native host.
    // Source authenticity is established when obtaining the reviewed distribution.
    await exec('/usr/bin/codesign', ['--force', '--sign', '-', candidate], options);
    await exec('/usr/bin/codesign', ['--verify', '--strict', candidate], options);
    const runtime = JSON.parse((await exec(candidate, ['-p',
      'JSON.stringify({version:process.version,arch:process.arch})'], options)).stdout);
    if (!/^v22\.\d+\.\d+$/.test(runtime.version) || runtime.arch !== process.arch) {
      throw Error('Brain Monitor requires a self-contained Node 22 binary for the current architecture');
    }
    let license;
    for (const file of licenseCandidates) {
      try { license = await fs.readFile(file); break; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    if (!license?.length) throw Error('Node distribution LICENSE is required; set BRAIN_MENUBAR_NODE_LICENSE if stored separately');
    const sha256 = createHash('sha256').update(await fs.readFile(candidate)).digest('hex');
    await fs.writeFile(path.join(stage, 'Node.txt'), license);
    await fs.mkdir(path.dirname(noticesPath), {recursive: true});
    await fs.rename(path.join(stage, 'Node.txt'), noticesPath);
    // Promote only after the staged copy loads, runs and passes dependency checks.
    await fs.rename(candidate, nodePath);
    return {...runtime, sha256, dependencies: 'system_only'};
  } catch (error) {
    throw new Error('Brain Monitor runtime installation failed. Set BRAIN_MENUBAR_NODE to an official self-contained Node 22 distribution binary. ' + error.message, {cause: error});
  } finally {
    await fs.rm(stage, {recursive: true, force: true});
  }
}
