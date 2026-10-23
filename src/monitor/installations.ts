import fs from 'node:fs/promises';
import type pg from 'pg';
import type { BrainPrincipal, BrainRole } from '../services/registry.js';

export type UpdateMode = 'automatic' | 'mdm' | 'developer';
export interface MonitorOperator {
  provider: string; provider_tenant_id: string; provider_user_id: string;
  person_id: string; update_mode: UpdateMode;
  devices?: {installation_id:string;update_mode:UpdateMode}[];
}
export interface MonitorPolicy { version: 1; brain_id: string; operators: MonitorOperator[] }
const modes = ['automatic','mdm','developer'];
const text = (v: unknown, re: RegExp, max: number): v is string => typeof v === 'string' && v.length <= max && re.test(v);
export function parseMonitorPolicy(input: unknown, brainId: string): MonitorPolicy {
  const p = input as MonitorPolicy;
  if (!p || p.version !== 1 || p.brain_id !== brainId || !Array.isArray(p.operators) || p.operators.length > 100) throw Error('invalid_monitor_policy');
  const seen = new Set();
  for (const op of p.operators) {
    if (!op || !['github','entra'].includes(op.provider) ||
      !text(op.provider_user_id,/^[A-Za-z0-9_-]+$/,160) ||
      !text(op.provider_tenant_id,/^[A-Za-z0-9_-]*$/,160) ||
      (op.provider === 'entra' && !op.provider_tenant_id) ||
      !text(op.person_id,/^[A-Za-z0-9_-]+$/,80) || !modes.includes(op.update_mode)) throw Error('invalid_monitor_policy');
    const key = principalKey({provider:op.provider,providerTenantId:op.provider_tenant_id,providerUserId:op.provider_user_id});
    if (seen.has(key)) throw Error('duplicate_monitor_operator');
    seen.add(key);
    if(op.devices!==undefined) {
      if(!Array.isArray(op.devices) || op.devices.length>20)throw Error('invalid_monitor_devices');
      const ids=new Set();
      for(const device of op.devices) {
        if(!device || !text(device.installation_id,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,36) || !modes.includes(device.update_mode) || ids.has(device.installation_id.toLowerCase()))throw Error('invalid_monitor_devices');
        ids.add(device.installation_id.toLowerCase());
      }
    }
  }
  return p;
}
export async function loadMonitorPolicy(filename: string, brainId: string) {
  return parseMonitorPolicy(JSON.parse(await fs.readFile(filename,'utf8')),brainId);
}
export function principalKey(p: BrainPrincipal): string {
  return JSON.stringify([p.provider,(p.providerTenantId || '').toLowerCase(),p.providerUserId]);
}
export function monitorOperator(policy: MonitorPolicy, p: BrainPrincipal, role: BrainRole | undefined) {
  if (!['owner','admin','member'].includes(role || '')) return null;
  return policy.operators.find(op => principalKey({provider:op.provider,providerTenantId:op.provider_tenant_id,providerUserId:op.provider_user_id}) === principalKey(p)) || null;
}
export interface InstallationReport {
  installation_id: string; app_version: string; build: string; source_revision: string;
  platform: 'darwin'; arch: 'arm64' | 'x64'; update_mode: UpdateMode;
  update_state: 'current' | 'checking' | 'available' | 'downloaded' | 'deferred' | 'failed' | 'unknown';
}
export function monitorUpdateMode(operator:MonitorOperator,installationId:string):UpdateMode {
  return operator.devices?.find(device=>device.installation_id.toLowerCase()===installationId.toLowerCase())?.update_mode || operator.update_mode;
}
export function installationReport(body: unknown): InstallationReport {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw Error('invalid_installation_report');
  const p = body as Record<string,unknown>;
  const keys = ['installation_id','app_version','build','source_revision','platform','arch','update_mode','update_state'];
  if (Object.keys(p).some(key => !keys.includes(key)) || Object.keys(p).length !== keys.length ||
    !text(p.installation_id,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,36) ||
    !text(p.app_version,/^\d+\.\d+\.\d+(?:[.-][A-Za-z0-9.-]+)?$/,60) ||
    !text(p.build,/^\d{1,16}$/,16) || !text(p.source_revision,/^[0-9a-f]{40}$/,40) ||
    p.platform !== 'darwin' || !['arm64','x64'].includes(String(p.arch)) ||
    !modes.includes(String(p.update_mode)) ||
    !['current','checking','available','downloaded','deferred','failed','unknown'].includes(String(p.update_state))) throw Error('invalid_installation_report');
  return p as unknown as InstallationReport;
}

export class MonitorInstallations {
  private active = 0;
  constructor(readonly pool: Pick<pg.Pool,'query'>, readonly policy: MonitorPolicy) {}
  async report(p: BrainPrincipal, role: BrainRole | undefined, body: unknown) {
    const operator = monitorOperator(this.policy,p,role);
    if (!operator) throw Error('monitor_operator_required');
    const report = installationReport(body);
    // A device cannot opt itself out of a developer or IT exclusion.
    const mode=monitorUpdateMode(operator,report.installation_id);
    if (report.update_mode !== mode) throw Error('monitor_update_policy_mismatch');
    if (this.active >= 4) throw Error('monitor_inventory_busy');
    this.active++;
    try {
      const result = await this.pool.query({text:`insert into brain.monitor_installations
        (brain_id,provider,provider_tenant_id,provider_user_id,installation_id,app_version,build,source_revision,platform,arch,update_mode,update_state)
        select $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12
        where exists(select 1 from brain.monitor_installations where brain_id=$1 and provider=$2 and provider_tenant_id=$3 and provider_user_id=$4 and installation_id=$5)
          or (select count(*) from brain.monitor_installations where brain_id=$1 and provider=$2 and provider_tenant_id=$3 and provider_user_id=$4)<10
        on conflict(brain_id,provider,provider_tenant_id,provider_user_id,installation_id)
        do update set app_version=excluded.app_version,build=excluded.build,source_revision=excluded.source_revision,
          platform=excluded.platform,arch=excluded.arch,update_mode=excluded.update_mode,update_state=excluded.update_state,last_seen_at=now()
        where brain.monitor_installations.last_seen_at <= now()-interval '5 minutes'
        returning last_seen_at`,values:[this.policy.brain_id,p.provider,(p.providerTenantId || '').toLowerCase(),p.providerUserId,
          report.installation_id,report.app_version,report.build,report.source_revision,report.platform,report.arch,report.update_mode,report.update_state]});
      if (!result.rows.length) {
        const existing=await this.pool.query({text:'select 1 from brain.monitor_installations where brain_id=$1 and provider=$2 and provider_tenant_id=$3 and provider_user_id=$4 and installation_id=$5',values:[this.policy.brain_id,p.provider,(p.providerTenantId || '').toLowerCase(),p.providerUserId,report.installation_id]});
        if (!existing.rows.length) throw Error('monitor_device_limit');
      }
      return {accepted:true,recorded:result.rows.length > 0,update_mode:mode};
    } finally {this.active--;}
  }
  async list() {
    if (this.active >= 4) throw Error('monitor_inventory_busy');
    this.active++;
    try {
      const result = await this.pool.query({text:`select provider,provider_tenant_id,provider_user_id,installation_id,
        app_version,build,source_revision,platform,arch,update_mode,update_state,first_seen_at,last_seen_at
        from brain.monitor_installations where brain_id=$1 order by last_seen_at desc limit 501`,values:[this.policy.brain_id]});
      return {installations:result.rows.slice(0,500),truncated:result.rows.length>500,operators:this.policy.operators,
        observed_at:new Date().toISOString(),evidence:'Authenticated, self-reported installation; not remote attestation'};
    } finally {this.active--;}
  }
}
