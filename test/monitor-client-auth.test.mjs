import test from 'node:test';
import assert from 'node:assert/strict';
import {login,accessToken,reportInstallation} from '../scripts/lib/monitor-client.mjs';
test('native login binds PKCE, state, exact owner endpoints and saves refresh rotation through private storage',async t=>{
  const original=globalThis.fetch;let saved=null;const calls=[];
  t.after(()=>{globalThis.fetch=original;});
  globalThis.fetch=async(url,options)=>{
    calls.push({url:String(url),options});assert.equal(options.redirect,'error');
    if(String(url)==='https://brain.example/register') {
      const body=JSON.parse(options.body);assert.equal(body.token_endpoint_auth_method,'none');assert.match(body.redirect_uris[0],/^http:\/\/127\.0\.0\.1:\d+\/callback\//);
      return Response.json({client_id:'fixture-client'});
    }
    if(String(url)==='https://brain.example/token') {
      assert.equal(options.body.get('resource'),'https://brain.example/mcp');
      if(options.body.get('grant_type')==='authorization_code') {assert.equal(options.body.get('code'),'fixture-code');assert.equal(options.body.get('code_verifier').length,43);}
      else {assert.equal(options.body.get('refresh_token'),'fixture-refresh');}
      return Response.json({access_token:'fixture-access',refresh_token:'fixture-refresh',expires_in:3600});
    }
    if(String(url)==='https://brain.example/monitor/api/installations') {
      assert.equal(options.headers.Authorization,'Bearer fixture-access');assert.doesNotMatch(options.body,/refresh|access_token/);return Response.json({accepted:true,update_mode:'developer'});
    }
    throw Error('Unexpected endpoint');
  };
  const store={read:async()=>saved,write:async value=>{saved=value;}};
  await login('https://brain.example',store,async href=>{
    const auth=new URL(href);assert.equal(auth.origin,'https://brain.example');assert.equal(auth.pathname,'/authorize');assert.equal(auth.searchParams.get('code_challenge_method'),'S256');
    const callback=new URL(auth.searchParams.get('redirect_uri'));callback.search=new URLSearchParams({state:'wrong-state',code:'fixture-code'}).toString();
    assert.equal((await original(callback)).status,400);
    callback.search=new URLSearchParams({state:auth.searchParams.get('state'),code:'fixture-code'}).toString();assert.equal((await original(callback)).status,200);
  });
  assert.equal(saved.origin,'https://brain.example');assert.equal(saved.client_id,'fixture-client');
  saved.expires_at=0;assert.equal(await accessToken('https://brain.example',store),'fixture-access');assert.ok(saved.expires_at>Date.now());
  await reportInstallation('https://brain.example',store,{installation_id:'fixture'});
  await assert.rejects(accessToken('https://foreign.example',store),/sign_in_required/);
  assert.equal(calls.filter(call=>call.url.endsWith('/token')).length,2);
});
