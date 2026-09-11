import pg from 'pg';
import { postgresPoolOptions } from '../sync/postgres-revision-store.js';
import { attachPoolErrorLogger } from '../services/pg-pool.js';
import { SERVER_VERSION } from '../constants.js';
import type { BrainRole } from '../services/registry.js';

export class MonitoringStatus {
  private active = 0;
  constructor(readonly pool: pg.Pool) {}
  async read(brainId: string, role: BrainRole) {
    if (this.active >= 4) throw new Error('monitor_busy');
    this.active++;
    try {
      const data = await this.pool.query({text: `select
        (select last_seen_at from brain.sync_heartbeats where brain_id=$1) as sync_at,
        (select count(*)::int from brain.sync_conflicts where brain_id=$1 and status='open') as conflicts`, values:[brainId]});
      const row = data.rows[0];
      const observed = new Date().toISOString();
      const syncAt = row.sync_at ? new Date(row.sync_at).toISOString() : null;
      const age = syncAt ? Date.now()-Date.parse(syncAt) : null;
      const detailed = role === 'admin' || role === 'owner';
      let diagnostics;
      if (detailed) {
        const result = await this.pool.query({text: `with recent as (
          select event_type,duration_ms,metadata->>'ok' as ok from brain.sync_events
          where brain_id=$1 and created_at>now()-interval '24 hours'
            and event_type in ('hosted_mcp_latency','hosted_mcp_auth')
          order by created_at desc limit 1000
        ) select count(*) filter(where event_type='hosted_mcp_latency')::int as operations,
          count(*) filter(where event_type='hosted_mcp_latency' and ok='false')::int as failed_operations,
          count(*) filter(where event_type='hosted_mcp_auth')::int as auth_events,
          percentile_cont(0.95) within group(order by duration_ms) filter(where event_type='hosted_mcp_latency' and ok='true') as p95_ms
        from recent`,values:[brainId]});
        const values = result.rows[0];
        diagnostics = {window:'latest 1000 matching events within 24 hours',operations:Number(values.operations),failed_operations:Number(values.failed_operations),auth_events:Number(values.auth_events),p95_ms:values.p95_ms === null ? null : Math.round(Number(values.p95_ms)),open_conflicts:Number(row.conflicts)};
      }
      return {brain_id:brainId,role:role === 'member' ? 'curator' : role,server_version:SERVER_VERSION,
        observed_at:observed,service:'available',attention_required:Number(row.conflicts)>0,
        sync:{state:age===null?'unknown':age<0?'unknown':age>300_000?'stale':'recent',observed_at:syncAt,source:'hosted per-Brain heartbeat',description:'Activity from the configured sync operator; not a check of every colleague device.'},
        local_inbox:{state:'unobserved',surface:'local operator workspace',description:'Manual inbox access is independent of this monitoring page.'},
        ...(diagnostics ? {diagnostics} : {})};
    } finally { this.active--; }
  }
}

export function createMonitoringStatus(databaseUrl:string) {
  return new MonitoringStatus(attachPoolErrorLogger(new pg.Pool({...postgresPoolOptions(databaseUrl),max:2,query_timeout:5000,statement_timeout:5000}), 'monitoring'));
}
