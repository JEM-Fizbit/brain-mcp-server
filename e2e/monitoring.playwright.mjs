import {test,expect} from '@playwright/test';
import http from 'node:http';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {MonitoringRoutes} from '../dist/monitor/routes.js';
import {MonitoringStatus} from '../dist/monitor/status.js';
import {makeFileStateProvider} from '../dist/oauth/state.js';

test('hosted monitoring is usable in both themes and sizes and clears revoked or unavailable diagnostics',async({page,context},testInfo)=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'brain-monitor-ui-'));const prior=process.env.BRAIN_PLATFORM_CONFIG;
 process.env.BRAIN_PLATFORM_CONFIG=path.join(root,'registry.json');
 await writeFile(process.env.BRAIN_PLATFORM_CONFIG,JSON.stringify({version:1,brains:[{id:'test-monitor',type:'shared',template_used:'shared',integration_mode:'vertical',storage_backend:'postgres',storage_config:{}}]}));
 let routes,role='owner',failed=false;
 const server=http.createServer((req,res)=>void routes.handle(req,res,new URL(req.url,'http://127.0.0.1')));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 const config={issuer:base,authorizationEndpoint:base+'/authorize',resourceUri:base+'/mcp',identityProviders:['github'],scopes:['mcp:tools'],signingSecret:'ui-test-only',accessTokenTtlSec:3600,refreshTokenTtlSec:3600};
 const state=makeFileStateProvider(root);
 const status=new MonitoringStatus({query:async query=>{if(failed)throw new Error('private error');return{rows:[query.text.startsWith('with')?{operations:250,failed_operations:0,auth_events:1,p95_ms:780}:{sync_at:new Date(),conflicts:0}]};}});
 routes=new MonitoringRoutes(config,state,(id,role)=>status.read(id,role),async()=>role?{'test-monitor':role}:{});
 const login=await routes.sessions.begin(),params=new URL(login.location).searchParams;
 await state.put('auth_codes','ui-code',{client_id:routes.sessions.clientId,redirect_uri:routes.sessions.callback,code_challenge:params.get('code_challenge'),code_challenge_method:'S256',resource:config.resourceUri,scope:'mcp:tools',provider:'github',provider_user_id:'fixture',expires_at:Date.now()/1000+60});
 const cookies=await routes.sessions.complete(new URLSearchParams({code:'ui-code',state:params.get('state')}),login.cookie.split(';')[0]);
 const session=cookies[0].split(';')[0].split('=');await context.addCookies([{name:session[0],value:session[1],url:base,httpOnly:true,sameSite:'Lax'}]);
 try{
  for(const colorScheme of ['light','dark'])for(const width of [1280,390]){
   await page.emulateMedia({colorScheme});await page.setViewportSize({width,height:900});await page.goto(base+'/monitor?brain_id=test-monitor');
   await expect(page.locator('#service')).toHaveText('Available');await expect(page.locator('#diagnostics')).toBeVisible();
   await expect(page.locator('#version')).toContainText('Deployed v');await expect(page.locator('#sync')).toHaveText('Recent activity');
   await expect(page.locator('body')).toHaveJSProperty('scrollWidth',width);
   await page.screenshot({path:testInfo.outputPath(`monitor-${colorScheme}-${width}.png`),fullPage:true});
  }
  role='reader';await page.getByRole('button',{name:'Refresh',exact:true}).click();await expect(page.locator('#role')).toHaveText('Your role: reader');await expect(page.locator('#diagnostics')).toBeHidden();
  role=null;await page.getByRole('button',{name:'Refresh',exact:true}).click();await expect(page.locator('#dashboard')).toBeHidden();await expect(page.locator('#access-title')).toHaveText('This account has no current access');
  role='owner';failed=true;await page.reload();await expect(page.locator('#access-title')).toHaveText('Status is unavailable');await expect(page.locator('#dashboard')).toBeHidden();
 }finally{await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});await rm(root,{recursive:true,force:true});if(prior===undefined)delete process.env.BRAIN_PLATFORM_CONFIG;else process.env.BRAIN_PLATFORM_CONFIG=prior;}
});
