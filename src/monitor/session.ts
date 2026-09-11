import { createHash, randomBytes } from 'node:crypto';
import type { OauthConfig } from '../oauth/config.js';
import { isIdentityProviderEnabled } from '../oauth/config.js';
import type { StateProvider } from '../oauth/state.js';
import { handleToken } from '../oauth/token.js';
import { hashRefreshToken } from '../oauth/jwt.js';
import { resolveAuth } from '../http/mcp-auth.js';
import { principalFromAuthInfo, type BrainPrincipal } from '../services/registry.js';

const random = () => randomBytes(32).toString('base64url');
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const SESSION = 'brain_monitor_session';
const LOGIN = 'brain_monitor_login';
export interface MonitorSession { principal: BrainPrincipal; expires_at: number; issuer: string; kind: 'monitor_session' }

export class MonitorSessions {
  readonly callback: string;
  readonly clientId: string;
  private admissions: number[] = [];
  constructor(readonly config: OauthConfig, readonly state: StateProvider) {
    this.callback = new URL('/monitor/callback', config.issuer).href;
    this.clientId = `brain-monitor-${digest(config.issuer).slice(0, 24)}`;
  }
  cookie(name: string, value: string, maxAge: number): string {
    const secure = this.config.issuer.startsWith('https:');
    return `${secure ? '__Host-' : ''}${name}=${value}; Path=${secure ? '/' : '/monitor'}; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
  }
  readCookie(header: string | undefined, name: string): string | null {
    if (this.config.issuer.startsWith('https:')) name = '__Host-'+name;
    const values = (header || '').split(';').map(x=>x.trim()).filter(x=>x.startsWith(name+'='));
    if (values.length !== 1) return null;
    const value = values[0].slice(name.length+1);
    return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
  }
  async begin(cookieHeader?: string): Promise<{ location: string; cookie: string }> {
    const now = Date.now();
    this.admissions = this.admissions.filter(time=>time>now-60_000);
    if (this.admissions.length >= 30) throw new Error('monitor_login_rate_limited');
    this.admissions.push(now);
    const client = {client_id: this.clientId, client_name: 'Brain monitoring', redirect_uris: [this.callback], token_endpoint_auth_method: 'none', grant_types: ['authorization_code'], response_types: ['code'], client_id_issued_at: 0};
    const existing = await this.state.get('clients', this.clientId);
    if (existing && (existing.client_name !== client.client_name || existing.token_endpoint_auth_method !== 'none' || JSON.stringify(existing.redirect_uris) !== JSON.stringify(client.redirect_uris))) throw new Error('monitor_client_mismatch');
    if (!existing) await this.state.put('clients', this.clientId, client);
    const old = this.readCookie(cookieHeader, LOGIN);
    if (old) await this.state.del('oauth_states', 'monitor-login:'+digest(old));
    const token = random(), verifier = random();
    await this.state.put('oauth_states', 'monitor-login:'+digest(token), {kind: 'monitor_login', verifier, issuer: this.config.issuer, expires_at: Math.floor(now/1000)+600});
    const url = new URL(this.config.authorizationEndpoint);
    url.search = new URLSearchParams({response_type:'code', client_id:this.clientId, redirect_uri:this.callback, scope:'mcp:tools', state:token, code_challenge:createHash('sha256').update(verifier).digest('base64url'), code_challenge_method:'S256', resource:this.config.resourceUri}).toString();
    return {location:url.href, cookie:this.cookie(LOGIN,token,600)};
  }
  async complete(params: URLSearchParams, cookieHeader?: string): Promise<string[]> {
    const token = this.readCookie(cookieHeader, LOGIN);
    if (!token || params.get('state') !== token || !params.get('code')) throw new Error('monitor_login_invalid');
    const pending = await this.state.consumeOnce('oauth_states', 'monitor-login:'+digest(token));
    if (pending?.kind !== 'monitor_login' || pending.issuer !== this.config.issuer || pending.expires_at <= Date.now()/1000) throw new Error('monitor_login_expired');
    const result = await handleToken(new URLSearchParams({grant_type:'authorization_code',client_id:this.clientId,redirect_uri:this.callback,code:params.get('code')!,code_verifier:pending.verifier,resource:this.config.resourceUri}), undefined, this.config, this.state);
    if (result.status !== 200) throw new Error('monitor_login_refused');
    // The browser receives only an opaque monitor session, never an MCP token.
    if (result.body.refresh_token) await this.state.del('refresh_tokens',hashRefreshToken(result.body.refresh_token));
    const auth = resolveAuth('Bearer '+result.body.access_token,this.config);
    if (!auth.ok) throw new Error('monitor_login_refused');
    const previous = this.readCookie(cookieHeader, SESSION);
    if (previous) await this.state.del('oauth_states','monitor-session:'+digest(previous));
    const session = random();
    await this.state.put('oauth_states','monitor-session:'+digest(session), {kind:'monitor_session',principal:principalFromAuthInfo(auth.authInfo),issuer:this.config.issuer,expires_at:Math.floor(Date.now()/1000)+3600} satisfies MonitorSession);
    return [this.cookie(SESSION,session,3600),this.cookie(LOGIN,'',0)];
  }
  async get(cookieHeader?: string): Promise<MonitorSession | null> {
    const token = this.readCookie(cookieHeader,SESSION);
    if (!token) return null;
    const session = await this.state.get('oauth_states','monitor-session:'+digest(token));
    if (session?.kind !== 'monitor_session' || session.issuer !== this.config.issuer || !(session.expires_at>Date.now()/1000) || !isIdentityProviderEnabled(this.config,session.principal?.provider)) return null;
    if (session.principal.provider === 'entra' && session.principal.providerTenantId?.toLowerCase() !== this.config.entra?.tenantId.toLowerCase()) return null;
    return session;
  }
  async logout(cookieHeader?: string): Promise<string[]> {
    for (const [cookie,prefix] of [[SESSION,'monitor-session:'],[LOGIN,'monitor-login:']]) {
      const token = this.readCookie(cookieHeader,cookie);
      if (token) await this.state.del('oauth_states',prefix+digest(token));
    }
    return [this.cookie(SESSION,'',0),this.cookie(LOGIN,'',0)];
  }
}
