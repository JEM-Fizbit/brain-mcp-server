import {monitorUpdateMode,type MonitorOperator} from './installations.js';
const escape=(v:unknown)=>String(v ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
export function installationsPage(brainId:string,data:{installations:Record<string,any>[];operators:MonitorOperator[];truncated:boolean;observed_at:string;evidence:string}) {
  const rows=data.operators.flatMap(op=>{
    const reports=data.installations.filter(r=>r.provider===op.provider && r.provider_tenant_id.toLowerCase()===op.provider_tenant_id.toLowerCase() && r.provider_user_id===op.provider_user_id);
    return (reports.length?reports:[null]).map(r=>{
      const mode=r?monitorUpdateMode(op,r.installation_id):op.update_mode;
      const date=r?new Date(r.last_seen_at):null;
      const observed=Date.parse(data.observed_at);
      const contact=date && Number.isFinite(date.getTime())?date.toISOString().slice(0,19).replace('T',' ')+' UTC · '+(observed-date.getTime()<86400000?'recent':'stale / offline'):'Unobserved';
      return '<tr>'+[op.person_id,r?r.app_version+' ('+r.build+') · '+r.source_revision.slice(0,12):'Installation unverified',r?r.installation_id:'No authenticated report',contact,mode+(mode!==op.update_mode?' · default '+op.update_mode:''),r?r.update_state+(r.update_mode!==mode?' · reported '+r.update_mode:''):'unknown'].map(v=>'<td>'+escape(v)+'</td>').join('')+'</tr>';
    });
  }).join('');
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Installed Monitors</title><link rel="stylesheet" href="/monitor/style.css"></head><body><main><h1>'+escape(brainId)+' · Installed Monitors</h1><p><a class="button" href="/monitor">Back to Brain status</a></p><p>'+escape(data.evidence)+'. Last contact is not proof of uninstall. Developer exclusions remain in force.</p><p>Observed '+escape(data.observed_at)+(data.truncated?' · First 500 records; truncated.':'')+'</p><div class="inventory-scroll"><table class="inventory-table" aria-label="Installed Monitors"><thead><tr><th>Person</th><th>Build / source</th><th>Installation</th><th>Last contact</th><th>Policy</th><th>Update state</th></tr></thead><tbody>'+rows+'</tbody></table></div></main></body></html>';
}

export const installationInventoryCss = `.inventory-scroll{max-width:100%;overflow-x:auto;border:1px solid var(--border);border-radius:8px;background:var(--card)}.inventory-table{width:100%;min-width:760px;border-collapse:collapse;font-size:14px}.inventory-table th,.inventory-table td{padding:12px;text-align:left;vertical-align:top;border-bottom:1px solid var(--border)}.inventory-table th{background:var(--bg)}.inventory-table td:nth-child(3){font-family:ui-monospace,monospace}`;
