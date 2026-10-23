import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
const random=()=>randomBytes(32).toString('base64url');
export function monitorOrigin(input) {
  const url=new URL(input);
  if(url.protocol!=='https:' || url.username || url.password || url.pathname!=='/' || url.search || url.hash) throw Error('invalid_monitor_origin');
  return url.origin;
}
export async function jsonRequest(url,options={}) {
  const response=await fetch(url,{...options,redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok) throw Object.assign(Error('monitor_http_'+response.status),{status:response.status});
  const raw=await response.text();if(raw.length>65536)throw Error('monitor_response_too_large');
  return JSON.parse(raw);
}
export async function installationId(directory) {
  await fs.mkdir(directory,{recursive:true,mode:0o700});
  const filename=path.join(directory,'installation-id');
  try {await fs.writeFile(filename,randomUUID(),{flag:'wx',mode:0o600});} catch(error) {if(error.code!=='EEXIST')throw error;}
  const id=(await fs.readFile(filename,'utf8')).trim();
  if(!/^[0-9a-f-]{36}$/.test(id))throw Error('invalid_installation_id');
  return id;
}
export async function login(origin,store,open=async url=>exec('/usr/bin/open',[url])) {
  origin=monitorOrigin(origin);
  const state=random(),verifier=random(),callbackPath='/callback/'+random();
  let complete;const result=new Promise(resolve=>complete=resolve);
  const server=http.createServer((req,res)=>{
    const url=new URL(req.url,'http://127.0.0.1');
    if(req.method!=='GET' || url.pathname!==callbackPath || url.searchParams.get('state')!==state || !url.searchParams.get('code')){res.writeHead(400);res.end('Invalid sign-in callback.');return;}
    res.writeHead(200,{'Content-Type':'text/plain','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'"});
    res.end('Monitor sign-in complete. Return to Brain Monitor.');complete(url.searchParams.get('code'));
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const redirect='http://127.0.0.1:'+server.address().port+callbackPath;
  let timer;
  try {
    const client=await jsonRequest(origin+'/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_name:'Brain Monitor installation',redirect_uris:[redirect],grant_types:['authorization_code','refresh_token'],response_types:['code'],token_endpoint_auth_method:'none',scope:'mcp:tools'})});
    const url=new URL(origin+'/authorize');url.search=new URLSearchParams({response_type:'code',client_id:client.client_id,redirect_uri:redirect,resource:origin+'/mcp',scope:'mcp:tools',state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'}).toString();
    await open(url.href);
    const code=await Promise.race([result,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('monitor_login_timed_out')),300000);})]);
    const tokens=await jsonRequest(origin+'/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:client.client_id,code,redirect_uri:redirect,code_verifier:verifier,resource:origin+'/mcp'})});
    const saved={...tokens,client_id:client.client_id,origin,expires_at:Date.now()+tokens.expires_in*1000};
    await store.write(saved);return saved;
  } finally {clearTimeout(timer);server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
export async function accessToken(origin,store) {
  origin=monitorOrigin(origin);const saved=await store.read();
  if(!saved || saved.origin!==origin)throw Error('monitor_sign_in_required');
  if(saved.expires_at>Date.now()+60000)return saved.access_token;
  if(!saved.refresh_token)throw Error('monitor_sign_in_required');
  const tokens=await jsonRequest(origin+'/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',client_id:saved.client_id,refresh_token:saved.refresh_token,resource:origin+'/mcp'})});
  await store.write({...saved,...tokens,expires_at:Date.now()+tokens.expires_in*1000});return tokens.access_token;
}
export async function reportInstallation(origin,store,report) {
  origin=monitorOrigin(origin);
  return jsonRequest(origin+'/monitor/api/installations',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+await accessToken(origin,store)},body:JSON.stringify(report)});
}
