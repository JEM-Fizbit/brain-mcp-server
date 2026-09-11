import type { IncomingMessage, ServerResponse } from 'node:http';
import type { OauthConfig } from '../oauth/config.js';
import type { StateProvider } from '../oauth/state.js';
import { currentRolesForPrincipal } from '../services/access-grants.js';
import { loadRegistry, type BrainPrincipal, type BrainRole } from '../services/registry.js';
import { runtimeBrainId } from '../services/runtime-env.js';
import { MonitorSessions } from './session.js';
import { monitoringPage, monitoringCss, monitoringJs } from './page.js';

const headers = {'Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",'Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'};
export class MonitoringRoutes {
  readonly sessions: MonitorSessions;
  constructor(readonly config: OauthConfig, state: StateProvider,
    readonly read: (brainId:string,role:BrainRole)=>Promise<unknown>,
    readonly roles: (principal:BrainPrincipal)=>Promise<Record<string,BrainRole>> = currentRolesForPrincipal) {
    this.sessions = new MonitorSessions(config,state);
  }
  async handle(req:IncomingMessage,res:ServerResponse,url:URL) {
    const send = (status:number,body:string,type='application/json',extra:Record<string,string|string[]>={}) => {res.writeHead(status,{...headers,'Content-Type':type,...extra});res.end(body);};
    const redirect = (location:string,cookies:string[])=>send(303,'','text/plain',{'Location':location,'Set-Cookie':cookies});
    try {
      if (req.headers.origin && req.headers.origin !== new URL(this.config.issuer).origin) {send(403,'{"error":"origin_refused"}');return;}
      if (req.method==='POST' && url.pathname==='/monitor/logout') {
        if (req.headers.origin !== new URL(this.config.issuer).origin) {send(403,'{"error":"origin_required"}');return;}
        redirect('/monitor',await this.sessions.logout(req.headers.cookie));return;
      }
      if (req.method!=='GET') {send(405,'{"error":"method_not_allowed"}','application/json',{Allow:'GET'});return;}
      if (url.pathname==='/monitor' || url.pathname==='/monitor/') {send(200,monitoringPage,'text/html; charset=utf-8');return;}
      if (url.pathname==='/monitor/style.css') {send(200,monitoringCss,'text/css');return;}
      if (url.pathname==='/monitor/app.js') {send(200,monitoringJs,'text/javascript');return;}
      if (url.pathname==='/monitor/login') {
        const result=await this.sessions.begin(req.headers.cookie);redirect(result.location,[result.cookie]);return;
      }
      if (url.pathname==='/monitor/callback') {
        redirect('/monitor',await this.sessions.complete(url.searchParams,req.headers.cookie));return;
      }
      if (url.pathname!=='/monitor/api/status') {send(404,'{"error":"not_found"}');return;}
      const session=await this.sessions.get(req.headers.cookie);
      if (!session) {send(401,'{"error":"sign_in_required"}');return;}
      const brainId=url.searchParams.get('brain_id') || runtimeBrainId();
      const role=(await this.roles(session.principal))[brainId];
      const registered=(await loadRegistry()).brains.some(brain=>brain.id===brainId);
      if (!registered || !['reader','member','admin','owner'].includes(role)) {send(403,'{"error":"access_denied"}');return;}
      send(200,JSON.stringify(await this.read(brainId,role)));
    } catch(error) {
      const reason=error instanceof Error?error.message:'';
      if (reason==='monitor_login_rate_limited') send(429,'{"error":"try_later"}','application/json',{'Retry-After':'60'});
      else if (/^monitor_login_(invalid|expired|refused)$/.test(reason)) send(400,'Sign-in did not complete. Return to /monitor and start again.','text/plain');
      else send(503,'{"error":"status_unavailable"}','application/json',{'Retry-After':'5'});
    }
  }
}
