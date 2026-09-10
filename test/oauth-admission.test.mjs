import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { makeFileStateProvider } from '../dist/oauth/state.js';
import { handleRegister } from '../dist/oauth/register.js';

test('file provider serializes registration limits without revoking clients',async()=>{
 const root=await fs.mkdtemp('/tmp/brain-admission-');const state=makeFileStateProvider(root);
 try{
  const outcomes=await Promise.all(Array.from({length:10},(_,i)=>state.registerClient(String(i),{client_id:String(i),client_id_issued_at:Date.now()/1000},{maximumClients:3,perHour:3})));
  assert.equal(outcomes.filter(Boolean).length,3);
  await state.put('refresh_tokens','active',{expires_at:Date.now()/1000+3600});
  await state.put('refresh_tokens','expired',{expires_at:Date.now()/1000-3600});
  await state.cleanupExpired();assert.ok(await state.get('refresh_tokens','active'));assert.equal(await state.get('refresh_tokens','expired'),null);
  assert.equal(Object.keys(await state.listAll('clients')).length,3);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('registration refusal is explicit and does not fall back to unbounded put',async()=>{
 let wrote=false;
 const result=await handleRegister(JSON.stringify({redirect_uris:['https://example.com/callback']}),
 {allowedRedirectUris:['https://example.com/callback'],scopes:['mcp:tools']},
 {async registerClient(){return false;},async put(){wrote=true;}});
 assert.equal(result.status,429);assert.equal(wrote,false);
});
