import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';

export const credentialHome = path.join(os.homedir(), 'Library', 'Application Support', 'Brain MCP');
export const helperPath = path.join(credentialHome, 'bin', 'brain-fly-keychain');
export const registryPath = env => env.BRAIN_FLY_CREDENTIALS_FILE || path.join(credentialHome, 'fly-credentials.json');
export function cleanFlyEnv(env = process.env) {
  return Object.fromEntries(Object.entries(env).filter(([k]) => !/^FLY_(API_TOKEN|ACCESS_TOKEN|CONFIG_DIR)$/.test(k)));
}
// Never propagate a subprocess error object: it may contain secret stdout.
export function privateExec(command, args, {env = process.env, input, timeout = 20000} = {}) {
  return new Promise((resolve, reject) => {
    const p = execFile(command, args, {env, timeout, maxBuffer: 1024 * 1024}, (error, stdout) => {
      if (error) reject(new Error(`Credential operation failed: ${path.basename(command)} (exit ${error.code || 'unknown'})`));
      else resolve(stdout.trim());
    });
    p.stdin.on('error', () => {});
    p.stdin.end(input);
  });
}
export async function readRegistry(env = process.env) {
  const file = registryPath(env);
  try {
    const stat = await fs.stat(file);
    if ((stat.mode & 0o077) || (process.getuid && stat.uid !== process.getuid())) throw new Error('Fly credential metadata must be owner-only');
    const data = JSON.parse(await fs.readFile(file, 'utf8'));
    if (data.version !== 1 || !Array.isArray(data.profiles)) throw new Error('Invalid Fly credential metadata');
    return data;
  } catch (e) { if (e.code === 'ENOENT') return {version: 1, profiles: []}; throw e; }
}
export function selectCredential(data, {app, brainId, purpose = 'deploy'}) {
  const matches = data.profiles.filter(p => p.app === app);
  if (matches.length !== 1) throw new Error('Exactly one managed Fly credential profile is required for this app');
  const p = matches[0];
  if (brainId && brainId !== p.brainId) throw new Error('Fly credential Brain/app mismatch');
  const c = p[purpose];
  if (!c || !/^brain-fly-[a-z0-9-]+$/.test(c.account) || !Number.isFinite(Date.parse(c.expiresAt))) throw new Error('Invalid Fly credential reference');
  return {profile: p, credential: c};
}
export function credentialStatus(profile, now = Date.now()) {
  const seconds = Math.min(...['deploy','monitor'].map(k => (Date.parse(profile[k]?.expiresAt) - now) / 1000));
  if (!Number.isFinite(seconds)) return {status:'warn', state:'invalid_metadata'};
  const daysRemaining = Math.floor(seconds / 86400);
  return {status:daysRemaining <= 30 ? 'warn' : 'pass',
    state:seconds <= 0 ? 'expired' : daysRemaining <= 30 ? 'renewal_due' : 'current',
    daysRemaining, expiresAt: profile.deploy.expiresAt, app:profile.app, brainId:profile.brainId,
    message:seconds <= 0 ? 'Fly automation credential expired; hosted service and sync are checked separately.' : daysRemaining <= 30 ? 'Renew this app credential before expiry.' : 'Managed Fly credentials are current.'};
}
export async function managedFlyEnv({app, brainId, purpose = 'deploy', env = process.env, readSecret} = {}) {
  if (env.BRAIN_FLY_AUTH_MODE === 'external') {
    const token = env.FLY_ACCESS_TOKEN || env.FLY_API_TOKEN;
    if (!token) throw new Error('External Fly auth requires an explicitly supplied token');
    return {...cleanFlyEnv(env), FLY_API_TOKEN:token, FLY_NO_UPDATE_CHECK:'1'};
  }
  const data = await readRegistry(env);
  const {profile, credential} = selectCredential(data, {app, brainId, purpose});
  if (Date.parse(credential.expiresAt) <= Date.now()) throw new Error('Managed Fly credential expired; renew it before this operation');
  const token = await (readSecret || (account => privateExec(helperPath, ['get', account])))(credential.account);
  if (!/^(?:FlyV1 )?fm[12]_\S+$/.test(token)) throw new Error('Managed Fly credential is unavailable or invalid');
  const configDir = path.join(path.dirname(registryPath(env)), 'fly-automation', app);
  await fs.mkdir(configDir, {recursive:true, mode:0o700});
  return {...cleanFlyEnv(env), FLY_CONFIG_DIR:configDir, FLY_API_TOKEN:token, FLY_NO_UPDATE_CHECK:'1', BRAIN_FLY_CREDENTIAL_ACCOUNT:credential.account};
}
export async function writeRegistry(data, env = process.env) {
  const file = registryPath(env);
  await fs.mkdir(path.dirname(file), {recursive:true, mode:0o700});
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2)+'\n', {mode:0o600});
  await fs.rename(tmp, file);
}
