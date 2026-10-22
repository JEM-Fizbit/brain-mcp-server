import {test,expect} from "@playwright/test";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {MonitoringRoutes} from "../dist/monitor/routes.js";
import {makeFileStateProvider} from "../dist/oauth/state.js";
import {FileRevisionStore} from "../dist/sync/file-revision-store.js";
import {RevisionBrainStore} from "../dist/services/revision-brain-store.js";
import {internalWriteContext} from "../dist/services/write-policy.js";

test("actual authenticated change reader works on desktop/mobile, escapes source text and rechecks roles",async({page,context},info)=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"brain-change-ui-"));
 const keys=["BRAIN_PLATFORM_CONFIG","BRAIN_EXPERIMENTAL_REVISION_STORE_FILE","BRAIN_REVISION_STORE","BRAIN_WRITE_POLICY_CONFIG"];
 const prior=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 process.env.BRAIN_PLATFORM_CONFIG=path.join(root,"registry.json");process.env.BRAIN_EXPERIMENTAL_REVISION_STORE_FILE=path.join(root,"revisions.json");
 delete process.env.BRAIN_REVISION_STORE;delete process.env.BRAIN_WRITE_POLICY_CONFIG;
 const brain="test-change-ui";let routes,role="owner";
 const server=http.createServer((req,res)=>void routes.handle(req,res,new URL(req.url,"http://127.0.0.1")));
 await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));const base="http://127.0.0.1:"+server.address().port;
 await fs.writeFile(process.env.BRAIN_PLATFORM_CONFIG,JSON.stringify({version:1,brains:[{id:brain,type:"personal",template_used:"personal",integration_mode:"vertical",storage_backend:"filesystem",storage_config:{brain_dir:root},write_policy:{version:1,mode:"enforce",intake:"retired",capture_route:"capture-personal",review_base_url:"https://brain.example"}}]}));
 const revisions=new FileRevisionStore(process.env.BRAIN_EXPERIMENTAL_REVISION_STORE_FILE),store=new RevisionBrainStore(revisions);
 const source="Owner confirms the canonical project URL.";
 const src=await revisions.proposeRevision({brainId:brain,filename:"SOURCE.md",content:source,baseRevisionId:null,origin:"system",writeContext:internalWriteContext("fixture")});
 const original=await revisions.proposeRevision({brainId:brain,filename:"FACT.md",content:"Old project link.\n",baseRevisionId:null,origin:"system",writeContext:internalWriteContext("fixture")});
 await store.writeFile(brain,"FACT.md","Canonical project link. <script>window.injected=true</script>\n","replace",undefined,{provider:"fixture",id:"agent"},"member",original.head.revisionId,{operation_id:"ui-correction-001",kind:"source_backed",reason:"Correct the project link from its owner.",evidence:[{brain_id:brain,reference:"SOURCE.md",observed_at:new Date().toISOString(),revision:src.head.revisionId,excerpt:source,method:"hosted_source",verification:"agent_observed"}]});
 const revision=await revisions.getHead(brain,"FACT.md"),url=base+"/monitor/changes/"+revision.revisionId+"?brain_id="+brain+"&return_to="+encodeURIComponent(base+"/");
 const config={issuer:base,authorizationEndpoint:base+"/authorize",resourceUri:base+"/mcp",identityProviders:["github"],scopes:["mcp:tools"],signingSecret:"change-ui-only",accessTokenTtlSec:3600,refreshTokenTtlSec:3600};
 const state=makeFileStateProvider(path.join(root,"oauth"));
 routes=new MonitoringRoutes(config,state,async()=>({}),async()=>role?{[brain]:role}:{},()=>({readFile:async(...args)=>(await store.readFile(...args)).replaceAll("https://brain.example",base),readChange:(...args)=>store.readChange(...args)}));
 try {
  await page.goto(url);await expect(page.getByRole("link",{name:"Sign in",exact:true})).toBeVisible();
  const login=await routes.sessions.begin(),params=new URL(login.location).searchParams;
  await state.put("auth_codes","change-code",{client_id:routes.sessions.clientId,redirect_uri:routes.sessions.callback,code_challenge:params.get("code_challenge"),code_challenge_method:"S256",resource:config.resourceUri,scope:"mcp:tools",provider:"github",provider_user_id:"fixture",expires_at:Date.now()/1000+60});
  const cookies=await routes.sessions.complete(new URLSearchParams({code:"change-code",state:params.get("state")}),login.cookie.split(";")[0]),session=cookies[0].split(";")[0].split("=");
  await context.addCookies([{name:session[0],value:session[1],url:base,httpOnly:true,sameSite:"Lax"}]);
  for(const colorScheme of ["light","dark"])for(const width of [1280,390]) {
   await page.emulateMedia({colorScheme});await page.setViewportSize({width,height:900});await page.goto(url);
   await expect(page.getByRole("heading",{name:"FACT.md"})).toBeVisible();
   await expect(page.getByRole("link",{name:"← Back to cockpit",exact:true})).toHaveAttribute("href",base+"/");
   await expect(page.getByText("Result: verified. Manual review is optional.",{exact:true})).toBeVisible();
   await expect(page.getByRole("table",{name:"Line-by-line changes"})).toBeVisible();
   await expect(page.locator('.diff-removed')).toContainText('Old project link.');
   await expect(page.locator('.diff-added')).toContainText('Canonical project link.');
   await page.getByText("Full before and after text",{exact:true}).click();
   await expect(page.getByRole("heading",{name:"Before",exact:true})).toBeVisible();await expect(page.getByRole("heading",{name:"After",exact:true})).toBeVisible();
   expect(await page.evaluate(()=>window.injected)).toBeUndefined();
   await expect(page.locator("body")).toHaveJSProperty("scrollWidth",width);
   await page.screenshot({path:info.outputPath("change-"+colorScheme+"-"+width+".png"),fullPage:true});
  }
  const listUrl=base+"/monitor/changes?brain_id="+brain+"&return_to="+encodeURIComponent(base+"/");
  for(const colorScheme of ["light","dark"])for(const width of [1280,390]) {
   await page.emulateMedia({colorScheme});await page.setViewportSize({width,height:900});await page.goto(listUrl);
   await expect(page.getByRole("heading",{name:"Change log",exact:true})).toBeVisible();
   await expect(page.getByRole("link",{name:"← Back to cockpit",exact:true})).toHaveAttribute("href",base+"/");
   await expect(page.locator("article")).toHaveCount(1);
   await expect(page.locator("article").first()).toContainText("agent");
   await expect(page.locator("body")).toHaveJSProperty("scrollWidth",width);
   await page.screenshot({path:info.outputPath("history-"+colorScheme+"-"+width+".png"),fullPage:true});
   await page.getByRole("link",{name:/Open diff/}).click();
   await expect(page.getByRole("table",{name:"Line-by-line changes"})).toBeVisible();
   await page.getByRole("link",{name:"← Change log",exact:true}).click();
   await page.getByRole("searchbox").fill("no matching phrase");await page.getByRole("button",{name:"Apply filters"}).click();
   await expect(page.getByRole("heading",{name:"No matching entries"})).toBeVisible();
   await expect(page.getByRole("link",{name:"← Back to cockpit",exact:true})).toHaveAttribute("href",base+"/");
  }
  role="reader";expect((await page.goto(listUrl)).status()).toBe(200);expect((await page.goto(url)).status()).toBe(200);
  role=null;expect((await page.goto(listUrl)).status()).toBe(403);await expect(page.locator("body")).not.toContainText("Correct the project link");
  role=null;expect((await page.goto(url)).status()).toBe(403);await expect(page.locator("body")).not.toContainText("Canonical project link");
 } finally {
  await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});await fs.rm(root,{recursive:true,force:true});
  for(const key of keys)if(prior[key]===undefined)delete process.env[key];else process.env[key]=prior[key];
 }
});
