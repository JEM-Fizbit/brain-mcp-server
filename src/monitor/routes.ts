import type { IncomingMessage, ServerResponse } from 'node:http';
import type { OauthConfig } from '../oauth/config.js';
import type { StateProvider } from '../oauth/state.js';
import { currentRolesForPrincipal } from '../services/access-grants.js';
import { loadRegistry, type BrainPrincipal, type BrainRole } from '../services/registry.js';
import { runtimeBrainId } from '../services/runtime-env.js';
import { MonitorSessions } from './session.js';
import { activeBrainStore } from '../services/active-brain-store.js';
import { changePage } from './change-page.js';
import { changeLogOptions, changeLogPage } from './change-log.js';
import type { BrainStore } from '../services/brain-store.js';
import { safeCockpitUrl } from './navigation.js';
import { monitoringPage, monitoringCss, monitoringJs, changeHistoryCss } from './page.js';
import { monitorOperator, type MonitorInstallations } from './installations.js';
import { installationsPage, installationInventoryCss } from './installations-page.js';

const headers = {'Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",'Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'};
export class MonitoringRoutes {
  installations?: MonitorInstallations;
  readonly sessions: MonitorSessions;
  private historyReads=0;
  constructor(readonly config: OauthConfig, state: StateProvider,
    readonly read: (brainId:string,role:BrainRole,operator?:boolean)=>Promise<unknown>,
    readonly roles: (principal:BrainPrincipal)=>Promise<Record<string,BrainRole>> = currentRolesForPrincipal,
    readonly store: () => Pick<BrainStore,'readFile'|'readChange'> = activeBrainStore) {
    this.sessions = new MonitorSessions(config,state);
  }
  async handle(req:IncomingMessage,res:ServerResponse,url:URL) {
    const send = (status:number,body:string,type='application/json',extra:Record<string,string|string[]>={}) => {res.writeHead(status,{...headers,'Content-Type':type,...extra});res.end(body);};
    const redirect = (location:string,cookies:string[])=>send(303,'','text/plain',{'Location':location,'Set-Cookie':cookies});
    try {
      // Fly's alternate hostname must not start a login whose cookie would be
      // stranded when the upstream callback returns to the canonical issuer.
      if(req.method==='GET' && req.headers['x-forwarded-proto']==='https' && req.headers.host!==new URL(this.config.issuer).host){
        redirect(new URL(url.pathname+url.search,this.config.issuer).href,[]);return;
      }
      if (req.headers.origin && req.headers.origin !== new URL(this.config.issuer).origin) {send(403,'{"error":"origin_refused"}');return;}
      if (req.method==='POST' && url.pathname==='/monitor/logout') {
        if (req.headers.origin !== new URL(this.config.issuer).origin) {send(403,'{"error":"origin_required"}');return;}
        redirect('/monitor',await this.sessions.logout(req.headers.cookie));return;
      }
      if (req.method!=='GET') {send(405,'{"error":"method_not_allowed"}','application/json',{Allow:'GET'});return;}
      if (url.pathname==='/monitor' || url.pathname==='/monitor/') {send(200,monitoringPage,'text/html; charset=utf-8');return;}
      if (url.pathname==='/monitor/style.css') {send(200,monitoringCss + changeHistoryCss + installationInventoryCss,'text/css');return;}
      if (url.pathname==='/monitor/app.js') {send(200,monitoringJs,'text/javascript');return;}
      if (url.pathname==='/monitor/login') {
        const result=await this.sessions.begin(req.headers.cookie);redirect(result.location,[result.cookie]);return;
      }
      if (url.pathname==='/monitor/callback') {
        redirect('/monitor',await this.sessions.complete(url.searchParams,req.headers.cookie));return;
      }
      const changeMatch=/^\/monitor\/changes\/([A-Za-z0-9_-]{1,160})$/.exec(url.pathname);
      const changeLog=url.pathname==='/monitor/changes';
      const inventoryPage=url.pathname==='/monitor/installations';
      if (!changeMatch && !changeLog && !['/monitor/api/status','/monitor/api/installations','/monitor/installations'].includes(url.pathname)) {send(404,'{"error":"not_found"}');return;}
      const session=await this.sessions.get(req.headers.cookie);
      if (!session) {
        if(changeMatch || changeLog || inventoryPage) send(401,`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Brain sign-in</title><link rel="stylesheet" href="/monitor/style.css"></head><body><main><h1>Sign in to ${inventoryPage?'view installed Monitors':'read Brain changes'}</h1><p>Sign in with your Brain account, then select ${inventoryPage?'Installed Monitors':'Change log'} on Brain status.</p><a class="button" href="/monitor/login">Sign in</a></main></body></html>`,'text/html; charset=utf-8');
        else send(401,'{"error":"sign_in_required"}');
        return;
      }
      const brainId=url.searchParams.get('brain_id') || runtimeBrainId();
      const role=(await this.roles(session.principal))[brainId];
      const registered=(await loadRegistry()).brains.find(brain=>brain.id===brainId);
      if (!registered || !['reader','member','admin','owner'].includes(role)) {send(403,'{"error":"access_denied"}');return;}
      const cockpit=safeCockpitUrl(url.searchParams.get('return_to')) || safeCockpitUrl(registered.metadata?.cockpit_url);
      if (url.pathname==='/monitor/api/installations' || url.pathname==='/monitor/installations') {
        if (brainId !== runtimeBrainId() || role !== 'owner') {send(403,'{"error":"owner_required"}');return;}
        if (!this.installations) {send(503,'{"error":"inventory_not_activated"}');return;}
        const data=await this.installations.list();
        if(url.pathname==='/monitor/installations')send(200,installationsPage(brainId,data),'text/html; charset=utf-8');
        else send(200,JSON.stringify(data));return;
      }
      if(changeLog) {
        let options;
        try { options=changeLogOptions(url.searchParams); } catch {send(400,'Invalid change-log filters.','text/plain');return;}
        if(this.historyReads>=4) {send(503,'Change log is busy. Please try again.','text/plain',{'Retry-After':'5'});return;}
        this.historyReads++;
        try {
          const content=await this.store().readFile(brainId,'LOG.md');
          send(200,changeLogPage(content,brainId,this.config.issuer,options,cockpit),'text/html; charset=utf-8');
        } finally {this.historyReads--;}
        return;
      }
      if(changeMatch) {
        try {const record=JSON.parse(await this.store().readChange(brainId,changeMatch[1]));
          send(200,changePage(record,cockpit),'text/html; charset=utf-8');
        } catch {send(404,'Change is unavailable in this Brain.','text/plain');}
        return;
      }
      const operator=Boolean(this.installations && monitorOperator(this.installations.policy,session.principal,role));
      send(200,JSON.stringify({...await this.read(brainId,role,operator) as Record<string,unknown>,cockpit_url:cockpit}));
    } catch(error) {
      const reason=error instanceof Error?error.message:'';
      if (reason==='monitor_login_rate_limited') send(429,'{"error":"try_later"}','application/json',{'Retry-After':'60'});
      else if (/^monitor_login_(invalid|expired|refused)$/.test(reason)) send(400,'Sign-in did not complete. Return to /monitor and start again.','text/plain');
      else send(503,'{"error":"status_unavailable"}','application/json',{'Retry-After':'5'});
    }
  }
}
