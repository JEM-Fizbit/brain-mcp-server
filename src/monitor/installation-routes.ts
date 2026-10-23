import type { IncomingMessage, ServerResponse } from 'node:http';
import type { OauthConfig } from '../oauth/config.js';
import { resolveAuth } from '../http/mcp-auth.js';
import { currentRolesForPrincipal } from '../services/access-grants.js';
import { principalFromAuthInfo } from '../services/registry.js';
import { MonitorInstallations, principalKey } from './installations.js';

export class InstallationRoutes {
  private admissions = new Map<string,number[]>();
  private active = 0;
  constructor(readonly config: OauthConfig, readonly inventory: MonitorInstallations,
    readonly roles = currentRolesForPrincipal) {}
  async handle(req: IncomingMessage,res: ServerResponse) {
    const send = (status:number,value:unknown) => {res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
    if (req.method !== 'POST') {send(405,{error:'method_not_allowed'});return;}
    if (req.headers.origin && req.headers.origin !== new URL(this.config.issuer).origin) {send(403,{error:'origin_refused'});return;}
    const auth = resolveAuth(req.headers.authorization,this.config);
    if (!auth.ok || !auth.authInfo.scopes.includes('mcp:tools')) {send(401,{error:'sign_in_required'});return;}
    const principal = principalFromAuthInfo(auth.authInfo);
    if (principal.provider === 'entra' && principal.providerTenantId?.toLowerCase() !== this.config.entra?.tenantId.toLowerCase()) {send(403,{error:'access_denied'});return;}
    const key = principalKey(principal), now = Date.now();
    for (const [k,v] of this.admissions) if (!v.some(t=>t>now-900_000)) this.admissions.delete(k);
    const times = (this.admissions.get(key) || []).filter(t=>t>now-900_000);
    if (times.length>=12 || this.admissions.size>=256 && !this.admissions.has(key) || this.active>=4) {send(429,{error:'try_later'});return;}
    this.admissions.set(key,[...times,now]);
    if (String(req.headers['content-type']).split(';')[0] !== 'application/json') {send(415,{error:'application_json_required'});return;}
    this.active++;
    try {
      const roles = await this.roles(principal);
      const chunks: Buffer[] = []; let size=0;
      const timer=setTimeout(()=>req.destroy(),10_000);timer.unref();
      try {
        for await (const chunk of req) {
          const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);
          size+=bytes.length;if(size>4096) {send(413,{error:'report_too_large'});return;}
          chunks.push(bytes);
        }
      } finally {clearTimeout(timer);}
      let body;try {body=JSON.parse(Buffer.concat(chunks).toString('utf8'));} catch {send(400,{error:'invalid_installation_report'});return;}
      send(200,await this.inventory.report(principal,roles[this.inventory.policy.brain_id],body));
    } catch (error) {
      const code=error instanceof Error?error.message:'';
      if (code==='monitor_operator_required') send(403,{error:code});
      else if (code==='monitor_device_limit') send(429,{error:code});
      else if (['invalid_installation_report','monitor_update_policy_mismatch'].includes(code)) send(400,{error:code});
      else send(503,{error:'inventory_unavailable'});
    } finally {this.active--;}
  }
}
